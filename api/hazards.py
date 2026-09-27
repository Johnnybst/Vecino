import math
import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED_FILE = ROOT / "data" / "seed_reports.json"

# Keep demo dates steady while the server runs, so circles can fade.
DEMO_STARTED_AT = datetime.now(timezone.utc)


# Map labels: high = Critical, medium = Moderate, low = Observed (green).
# A Miami block is about 100 m. Routing adds its own 300 m gap on top.
SEVERITY_RADIUS_M = {"high": 250, "medium": 100, "low": 100}
# Observed sightings only warn the traveler; they never cause a detour.
REROUTE = {"high": True, "medium": True, "low": False}
# How long each level stays on the map: Observed 3 h, Moderate 6 h, Critical until the morning wipe.
LIFETIME_MINUTES = {"low": 180, "medium": 360}
# IceOut starts from a clean slate around 4 AM Miami time; Critical reports stay until then.
WIPE_HOUR = 4
# Miami is on EDT (UTC-4) until Nov 1; Windows lacks the time zone database.
MIAMI_TIME = timezone(timedelta(hours=-4))
# Oldest report worth reading from the database (a Critical can be almost a day old at the wipe).
MAX_AGE_HOURS = 24


def last_wipe(now):
    """The most recent 4 AM in Miami at or before `now`."""
    local = now.astimezone(MIAMI_TIME)
    wipe = local.replace(hour=WIPE_HOUR, minute=0, second=0, microsecond=0)
    return wipe if wipe <= local else wipe - timedelta(days=1)


def still_shown(severity, reported_at, now):
    if severity == "high":
        return reported_at >= last_wipe(now)
    return (now - reported_at).total_seconds() / 60 < LIFETIME_MINUTES[severity]


# IceOut's own level for a report (category_enum): 0 Critical, 1 Active, 2 Observed (3 Other = no level).
ICEOUT_SEVERITY = {0: "high", 1: "medium", 2: "low"}


def severity_and_radius(report_count, confidence, iceout_category=None):
    # Use IceOut's own label when a report came from IceOut; otherwise judge by report count.
    if iceout_category in ICEOUT_SEVERITY:
        severity = ICEOUT_SEVERITY[iceout_category]
    elif report_count >= 4 or confidence >= 0.85:
        severity = "high"
    elif report_count >= 2:
        severity = "medium"
    else:
        severity = "low"
    return severity, SEVERITY_RADIUS_M[severity]


def parse_time(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    # Older collector timestamps without an offset are also stored in UTC.
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def load_live_reports(at=None):
    """Read recent clusters without creating or changing the collector database."""
    current_time = at if at is not None else datetime.now(timezone.utc)
    cutoff = current_time - timedelta(hours=MAX_AGE_HOURS)
    db_path = Path(os.getenv("DB_PATH", "ice_monitor.db")).expanduser()
    if not db_path.is_absolute():
        db_path = ROOT / db_path

    try:
        with closing(sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
            db.row_factory = sqlite3.Row
            has_reports = db.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'raw_reports'").fetchone()
            # The most serious IceOut label among the cluster's reports (lowest number = most serious).
            iceout = """(SELECT MIN(CAST(json_extract(r.raw_metadata, '$.category_enum') AS INTEGER))
                          FROM raw_reports r
                          WHERE r.cluster_id = clusters.id AND r.source_type = 'iceout'
                            AND json_extract(r.raw_metadata, '$.category_enum') IN (0, 1, 2))"""                 if has_reports else "NULL"
            rows = db.execute(
                f"""SELECT id, primary_location, latitude, longitude,
                          confidence_score, source_count, latest_report,
                          {iceout} AS iceout_category
                   FROM clusters
                   WHERE latitude IS NOT NULL AND longitude IS NOT NULL
                     AND latitude BETWEEN 25.13 AND 25.98
                     AND longitude BETWEEN -80.88 AND -80.11
                     AND julianday(latest_report) >= julianday(?)
                     AND julianday(latest_report) <= julianday(?)
                   ORDER BY julianday(latest_report) DESC""",
                (cutoff.isoformat(), current_time.isoformat()),
            ).fetchall()
            return [dict(row) for row in rows]
    except sqlite3.Error as exc:
        raise OSError("Live reports are unavailable. Check DB_PATH and the collector database.") from exc


def load_demo_reports():
    reports = json.loads(SEED_FILE.read_text(encoding="utf-8"))

    if not reports:
        return []

    newest = max(parse_time(report["latest_report"]) for report in reports)
    shift = DEMO_STARTED_AT - timedelta(minutes=10) - newest

    for report in reports:
        adjusted_time = parse_time(report["latest_report"]) + shift
        report["latest_report"] = adjusted_time.isoformat().replace("+00:00", "Z")

    return reports


def make_circle(latitude, longitude, radius_m=150, points=20):
    # A 150-metre radius makes a circle 300 metres across.
    latitude_offset = radius_m / 111320
    longitude_offset = radius_m / (
        111320 * math.cos(math.radians(latitude))
    )

    coordinates = []

    for index in range(points):
        angle = 2 * math.pi * index / points
        coordinates.append([
            longitude + longitude_offset * math.cos(angle),
            latitude + latitude_offset * math.sin(angle),
        ])

    # Close the outline by repeating its first point.
    coordinates.append(coordinates[0].copy())

    return {
        "type": "Polygon",
        "coordinates": [coordinates],
    }
def reports_to_hazards(reports, at=None):
    current_time = at if at is not None else datetime.now(timezone.utc)
    features = []

    for report in reports:
        reported_at = parse_time(report["latest_report"])

        # Don't show reports that haven't happened at the selected time.
        if reported_at > current_time:
            continue

        age_minutes = (current_time - reported_at).total_seconds() / 60
        if age_minutes > MAX_AGE_HOURS * 60:
            continue

        confidence = report["confidence_score"]
        weight = confidence * math.exp(-age_minutes / 90)

        count = report["source_count"]
        severity, radius_m = severity_and_radius(count, confidence, report.get("iceout_category"))

        # Observed 3 h, Moderate 6 h, Critical until the 4 AM wipe (colors still gray with age).
        if not still_shown(severity, reported_at, current_time):
            continue

        features.append({
            "type": "Feature",
            "geometry": make_circle(
                report["latitude"],
                report["longitude"],
                radius_m=radius_m,
            ),
            "properties": {
                "id": f"hz_{report['id']}",
                "summary": f"{count} reports near {report['primary_location']}",
                "reported_at": reported_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                "confidence": confidence,
                "report_count": count,
                "weight": weight,
                "severity": severity,
                "radius_m": radius_m,
                "reroute": REROUTE[severity],
            },
        })

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def get_demo_hazards(at=None):
    return reports_to_hazards(load_demo_reports(), at=at)


def get_hazards(at=None):
    """Shared source for the map and routing; live mode never uses fake data."""
    current_time = at if at is not None else datetime.now(timezone.utc)
    if os.getenv("DEMO_MODE", "false").strip().lower() == "true":
        return get_demo_hazards(at=current_time)
    return reports_to_hazards(load_live_reports(at=current_time), at=current_time)
