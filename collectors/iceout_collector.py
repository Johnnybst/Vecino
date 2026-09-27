"""Iceout.org collector — real-time community ICE activity reports.

Iceout.org (People Over Papers) is a community reporting platform where
people submit ICE sightings with addresses, photos, and timestamps.

API details:
    Endpoint: GET https://iceout.org/api/report-feed?&since={ISO_TIMESTAMP}
    Format:   MessagePack (application/msgpack)
    Fields:   id, location (GeoJSON Point), location_description,
              category_enum (0=Critical, 1=Active, 2=Observed, 3=Other),
              incident_time, created_at, status (0=Unconfirmed, 1=Confirmed),
              approved, small_thumbnail

Authentication:
    The API uses an Altcha proof-of-work CAPTCHA that requires browser-side
    JavaScript to solve. We use Playwright (headless Chromium) to load the
    site, let the JS handle auth automatically, then intercept the API
    response when the page fetches report data.

We filter to Minneapolis/MN area reports client-side by checking
location_description and coordinates.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

import msgpack

from collectors.base import BaseCollector
from storage.models import RawReport

logger = logging.getLogger(__name__)

ICEOUT_SITE_URL = "https://iceout.org/en/"
ICEOUT_API_URL = "https://iceout.org/api/report-feed"

# Category enum to human-readable labels
CATEGORY_LABELS = {
    0: "Critical",
    1: "Observed",
    2: "Active",
    3: "Other",
}

# Status enum
STATUS_LABELS = {
    0: "Not Confirmed",
    1: "Confirmed",
}




def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in km between two lat/lon points."""
    import math
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))





def _extract_coords(report: dict) -> tuple[float | None, float | None]:
    """Extract (latitude, longitude) from GeoJSON location."""
    loc_str = report.get("location")
    if not loc_str:
        return None, None
    try:
        if isinstance(loc_str, str):
            loc = json.loads(loc_str)
        else:
            loc = loc_str
        coords = loc.get("coordinates", [])
        if len(coords) >= 2:
            return coords[1], coords[0]  # GeoJSON is [lon, lat]
    except (json.JSONDecodeError, TypeError, ValueError):
        pass
    return None, None


class IceoutCollector(BaseCollector):
    """Collects ICE activity reports from Iceout.org via headless browser.

    The Iceout.org API requires browser-based Altcha proof-of-work
    authentication that can't be replicated with plain HTTP requests.
    We use Playwright to run a headless Chromium instance that:

    1. Navigates to the site (JS handles auth automatically)
    2. Intercepts the report-feed API response (MessagePack)
    3. Parses and filters reports to Minneapolis metro area

    The browser context persists between polling cycles to maintain the
    authenticated session.
    """

    name = "iceout"
    _collect_timeout = 60.0  # Browser nav + Altcha + fetch needs more than default

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._pool = None           # set in _ensure_browser
        self._context = None
        self._page = None
        self._authenticated = False
        self._intercepted_data: list[bytes] = []
        self._polls_since_full_auth = 0  # Track polls since last full navigation
        self._polls_since_context_recycle = 0  # Track for memory management
        self._consecutive_failures = 0  # Track failures for recovery throttling
        self._last_success_time: datetime | None = None
        # Locale-aware geo filter — supports multiple centers for multi-locale
        locale = self.config.locale
        self._centers = locale.centers
        self._location_keywords = {kw.lower() for kw in locale.geo_city_names}

    def _is_locale_area(self, report: dict) -> bool:
        """Check if an Iceout report is within any configured locale radius."""
        loc_str = report.get("location")
        if loc_str:
            try:
                if isinstance(loc_str, str):
                    loc = json.loads(loc_str)
                else:
                    loc = loc_str
                coords = loc.get("coordinates", [])
                if len(coords) >= 2:
                    lon, lat = coords[0], coords[1]
                    for c_lat, c_lon, c_radius in self._centers:
                        dist = _haversine_km(lat, lon, c_lat, c_lon)
                        if dist <= c_radius:
                            return True
                    desc = report.get("location_description", "unknown")
                    logger.debug(
                        "[iceout] Rejecting report outside all locale centers: %s",
                        desc[:50],
                    )
                    return False
            except (json.JSONDecodeError, TypeError, ValueError):
                pass

        # Fallback: check location description text
        desc = (report.get("location_description") or "").lower()
        return any(kw in desc for kw in self._location_keywords)

    async def _ensure_browser(self) -> bool:
        """Obtain a browser context + page from the shared pool."""
        logger.info("[iceout] Ensuring browser is available...")

        if self._page is not None:
            try:
                # Check if page is still alive (with timeout to prevent hang)
                await asyncio.wait_for(self._page.title(), timeout=5.0)
                logger.info("[iceout] Existing browser session is alive")
                return True
            except (asyncio.TimeoutError, Exception):
                # Page died, reset everything
                logger.info("[iceout] Existing browser session died, resetting")
                await self._close_browser()

        try:
            from collectors.browser_pool import BrowserPool

            self._pool = BrowserPool.shared()

            logger.info("[iceout] Requesting context from shared pool...")
            self._context = await self._pool.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1280, "height": 720},
            )
            self._page = await self._context.new_page()

            # Set up response interception for the report-feed API
            self._page.on("response", self._on_response)

            logger.info("[iceout] Browser context ready (shared pool)")
            return True

        except asyncio.TimeoutError:
            logger.error("[iceout] Browser launch timed out after 30s")
            await self._close_browser()
            return False
        except Exception as e:
            logger.error("[iceout] Failed to launch browser: %s", e)
            await self._close_browser()
            return False

    async def _on_response(self, response) -> None:
        """Intercept API responses containing report data."""
        if "report-feed" in response.url and response.status == 200:
            try:
                body = await response.body()
                # Only keep the most recent response to prevent memory leak
                self._intercepted_data = [body]
                logger.debug(
                    "[iceout] Intercepted report-feed response (%d bytes)",
                    len(body),
                )
            except Exception as e:
                logger.debug("[iceout] Failed to read response body: %s", e)

    async def _navigate_and_fetch(self) -> bytes | None:
        """Navigate to iceout.org and capture the API response.

        The site's JavaScript automatically:
        1. Performs Altcha proof-of-work auth
        2. Fetches the report feed
        3. Renders the map

        We intercept step 2's response.
        """
        if self._page is None:
            return None

        self._intercepted_data.clear()

        now = datetime.now(timezone.utc)
        # Look back a full day so a restart (e.g. a redeploy) backfills reports; the map's own
        # rules decide how long each level shows (Observed 3 h, Moderate 6 h, Critical until 4 AM).
        since = now - timedelta(hours=24)
        since_str = since.strftime("%Y-%m-%dT%H:%M:%S.000Z")

        # Force full re-authentication every 5 polls to avoid stale sessions
        self._polls_since_full_auth += 1
        if self._polls_since_full_auth >= 5:
            logger.info("[iceout] Forcing full re-authentication (5 polls reached)")
            self._authenticated = False
            self._polls_since_full_auth = 0

        # If already authenticated, fetch the API directly via the page context
        if self._authenticated:
            logger.info("[iceout] Using cached auth, fetching API directly")
            try:
                # Use page.evaluate to make a fetch from the authenticated context
                # Add timeout to prevent indefinite hangs
                js_code = f"""
                async () => {{
                    const resp = await fetch(
                        '{ICEOUT_API_URL}?&since={since_str}',
                        {{ credentials: 'include' }}
                    );
                    if (!resp.ok) return null;
                    const buf = await resp.arrayBuffer();
                    return Array.from(new Uint8Array(buf));
                }}
                """
                result = await asyncio.wait_for(
                    self._page.evaluate(js_code),
                    timeout=30.0
                )
                if result is not None:
                    logger.info("[iceout] Direct API fetch successful (%d bytes)", len(result))
                    return bytes(result)

                # Fetch failed (maybe session expired), fall through to full nav
                logger.warning(
                    "[iceout] In-page fetch returned None (session may have expired), re-navigating..."
                )
                self._authenticated = False
            except asyncio.TimeoutError:
                logger.warning("[iceout] In-page fetch timed out after 30s, re-navigating...")
                self._authenticated = False
            except Exception as e:
                logger.warning("[iceout] In-page fetch error: %s", e)
                self._authenticated = False

        # Full navigation — let the site's JS handle auth
        logger.info("[iceout] Navigating to %s for auth", ICEOUT_SITE_URL)
        try:
            await self._page.goto(
                ICEOUT_SITE_URL,
                wait_until="domcontentloaded",
                timeout=15000,
            )
            logger.info("[iceout] Navigation complete, checking for intercepted data")

            # Wait for Altcha proof-of-work + API calls to complete
            logger.info("[iceout] Waiting for auth + API completion...")
            # Poll for intercepted data instead of fixed sleep
            for _ in range(10):  # Up to 10 seconds
                if self._intercepted_data:
                    break
                await asyncio.sleep(1)


            # Check if we intercepted the report-feed response
            if self._intercepted_data:
                self._authenticated = True
                logger.info(
                    "[iceout] Intercepted %d API response(s) during navigation, using most recent (%d bytes)",
                    len(self._intercepted_data),
                    len(self._intercepted_data[-1])
                )
                return self._intercepted_data[-1]  # Use most recent

            # The initial page load may fetch all reports without a since param.
            # Try fetching with our specific time filter now that we're authed.
            try:
                js_code = f"""
                async () => {{
                    const resp = await fetch(
                        '{ICEOUT_API_URL}?&since={since_str}',
                        {{ credentials: 'include' }}
                    );
                    if (!resp.ok) return null;
                    const buf = await resp.arrayBuffer();
                    return Array.from(new Uint8Array(buf));
                }}
                """
                result = await asyncio.wait_for(
                    self._page.evaluate(js_code),
                    timeout=10.0
                )
                if result is not None:
                    self._authenticated = True
                    logger.info("[iceout] Post-nav fetch successful (%d bytes)", len(result))
                    return bytes(result)
            except asyncio.TimeoutError:
                logger.warning("[iceout] Post-nav fetch timed out after 10s")
            except Exception as e:
                logger.warning("[iceout] Post-nav fetch error: %s", e)

            # Last resort: check intercepted data from initial page load
            if self._intercepted_data:
                self._authenticated = True
                return self._intercepted_data[-1]

            logger.warning("[iceout] No report data captured after navigation")
            return None

        except Exception as e:
            logger.warning("[iceout] Navigation failed: %s", e)
            return None

    async def _close_browser(self) -> None:
        """Release our browser context back to the shared pool."""
        try:
            if self._page:
                await asyncio.wait_for(self._page.close(), timeout=5.0)
        except Exception:
            pass

        try:
            if self._pool and self._context:
                await asyncio.wait_for(
                    self._pool.close_context(self._context), timeout=5.0
                )
        except Exception:
            pass

        self._page = None
        self._context = None
        self._authenticated = False

    def get_poll_interval(self) -> int:
        base = self.config.iceout_poll_interval
        if self._consecutive_failures >= 3:
            # Backoff via longer poll interval — NOT inside collect()
            # (sleeping inside collect() eats into base.py's 120s timeout
            #  and creates an unrecoverable death spiral)
            extra = min(self._consecutive_failures * 30, 300)
            return base + extra
        return base

    async def collect(self) -> list[RawReport]:
        logger.info("[iceout] Starting collection cycle (failures=%d)", self._consecutive_failures)

        # Wrap entire collection in a timeout to prevent indefinite hangs
        try:
            reports = await asyncio.wait_for(
                self._do_collect(),
                timeout=45.0  # 45 second max for entire collection cycle
            )
        except asyncio.TimeoutError:
            self._consecutive_failures += 1
            # Don't reset browser on every timeout — keep context alive so
            # the next cycle can try the fast direct-fetch path instead of
            # doing a full re-navigation. Only reset after 5+ failures.
            if self._consecutive_failures >= 5:
                logger.error(
                    "[iceout] Collection timed out after 45s (failure #%d), resetting browser",
                    self._consecutive_failures,
                )
                await self._close_browser()
            else:
                logger.warning(
                    "[iceout] Collection timed out after 45s (failure #%d), keeping context",
                    self._consecutive_failures,
                )
            return []

        if reports:
            if self._consecutive_failures > 0:
                logger.warning(
                    "[iceout] Recovered after %d consecutive failures, returning %d reports",
                    self._consecutive_failures,
                    len(reports),
                )
            self._consecutive_failures = 0
            self._last_success_time = datetime.now(timezone.utc)
        else:
            # Don't increment failure counter for empty results (that's normal)
            pass

        return reports

    async def _do_collect(self) -> list[RawReport]:
        """Internal collection logic with timeout wrapper."""
        # Recycle context every 20 polls (~40 min at 2-min intervals) to prevent memory growth
        self._polls_since_context_recycle += 1
        if self._polls_since_context_recycle >= 20:
            logger.info("[iceout] Recycling context to free memory (20 polls reached)")
            await self._close_browser()
            self._polls_since_context_recycle = 0

        if not await self._ensure_browser():
            logger.warning("[iceout] Browser not available, skipping cycle")
            return []

        now = datetime.now(timezone.utc)

        try:
            raw_bytes = await self._navigate_and_fetch()
            if raw_bytes is None:
                self._consecutive_failures += 1
                logger.warning(
                    "[iceout] No data received from API (auth: %s, polls_since_auth: %d, failure #%d)",
                    self._authenticated,
                    self._polls_since_full_auth,
                    self._consecutive_failures,
                )
                # After 5 consecutive failures, force a full browser reset
                if self._consecutive_failures >= 5:
                    logger.warning("[iceout] %d consecutive failures, resetting browser", self._consecutive_failures)
                    await self._close_browser()
                return []
            logger.info("[iceout] Received %d bytes from API (auth: %s)", len(raw_bytes), self._authenticated)

            data = msgpack.unpackb(raw_bytes, raw=False)

        except Exception as e:
            logger.warning("[iceout] Failed to fetch/parse reports: %s", e)
            # Reset browser on unexpected errors
            await self._close_browser()
            return []

        if not isinstance(data, list):
            # Might be JSON instead of msgpack if server sent a different format
            if isinstance(raw_bytes, bytes):
                try:
                    data = json.loads(raw_bytes)
                except (json.JSONDecodeError, ValueError):
                    pass
            if not isinstance(data, list):
                logger.warning(
                    "[iceout] Unexpected response type: %s", type(data)
                )
                return []

        reports: list[RawReport] = []
        mpls_count = 0
        skipped_stale = 0

        for item in data:
            # Filter to locale area
            if not self._is_locale_area(item):
                continue

            mpls_count += 1
            report_id = item.get("id")
            if report_id is None:
                continue

            source_id = f"iceout_{report_id}"
            # Revisit existing IDs: IceOut can change their category/status.
            # Storage refreshes metadata while retaining the original cluster.

            # Parse timestamps
            incident_time_str = item.get("incident_time")
            created_at_str = item.get("created_at")

            if incident_time_str:
                try:
                    incident_time = datetime.fromisoformat(
                        incident_time_str.replace("Z", "+00:00")
                    )
                except ValueError:
                    incident_time = now
            else:
                incident_time = now

            # Enforce 24-hour freshness (trusted source; Critical stays until the 4 AM wipe)
            age = now - incident_time
            if age > timedelta(hours=24):
                continue

            if created_at_str:
                try:
                    created_at = datetime.fromisoformat(
                        created_at_str.replace("Z", "+00:00")
                    )
                except ValueError:
                    created_at = now
            else:
                created_at = now

            lat, lon = _extract_coords(item)
            category = CATEGORY_LABELS.get(item.get("category_enum"), "Unknown")
            status = STATUS_LABELS.get(item.get("status"), "Unknown")
            location_desc = item.get("location_description", "Unknown location")

            # Build readable text from structured data
            # Format incident time in a human-readable local format
            # using Discord's timestamp markup so it renders in each
            # viewer's local timezone
            if incident_time.tzinfo is not None:
                ts_unix = int(incident_time.timestamp())
                time_display = f"<t:{ts_unix}:f>"  # Discord relative format
            else:
                time_display = incident_time_str or "unknown"

            text = (
                f"[Iceout.org {category} Report] {location_desc}\n"
                f"Status: {status}\n"
                f"Incident time: {time_display}"
            )

            # Build a report-specific URL. Iceout.org is an SPA, so
            # we include the report ID as a fragment for reference.
            report_url = f"https://iceout.org/en/#report-{report_id}"

            reports.append(RawReport(
                source_type="iceout",
                source_id=source_id,
                source_url=report_url,
                author="iceout.org",
                text=text,
                timestamp=incident_time,
                collected_at=now,
                raw_metadata={
                    "iceout_id": report_id,
                    "category": category,
                    "category_enum": item.get("category_enum"),
                    "status": status,
                    "status_enum": item.get("status"),
                    "approved": item.get("approved"),
                    "location_description": location_desc,
                    "latitude": lat,
                    "longitude": lon,
                    "thumbnail": item.get("small_thumbnail"),
                },
            ))

        if reports:
            logger.info(
                "[iceout] Fetched %d locale-area reports for insert or refresh (of %d total, %d in area)",
                len(reports),
                len(data),
                mpls_count,
            )
        else:
            logger.info(
                "[iceout] No new reports (%d total, %d in locale area)",
                len(data),
                mpls_count,
            )

        return reports

    async def cleanup(self) -> None:
        await self._close_browser()
