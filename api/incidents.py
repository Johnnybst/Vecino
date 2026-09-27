"""Person 4: live road incidents (crashes, closures, stalled cars) in Miami-Dade.

Sources, checked at most every 5 minutes:
  1. TomTom Traffic Incidents (needs TOMTOM_API_KEY) - city streets and highways
  2. Florida Highway Patrol live page (no key)         - highway crashes, used as backup

Shown on the map only. Routes do NOT avoid these: they clear too fast.
Test: uv run python -m api.incidents
"""

import html
import os
import re
import time
from datetime import datetime, timedelta, timezone

import httpx

# Same box as NEWAGENTS.md section 4b.
SOUTH, NORTH, WEST, EAST = 25.13, 25.98, -80.88, -80.11

REFRESH_S = 300
FHP_MAX_AGE = timedelta(hours=2)
CLOSURE_MAX_AGE = timedelta(hours=24)
# Miami is on EDT (UTC-4) until Nov 1; Windows lacks the time zone database.
MIAMI_TIME = timezone(timedelta(hours=-4))

TOMTOM_URL = "https://api.tomtom.com/traffic/services/5/incidentDetails"
TOMTOM_FIELDS = ("{incidents{geometry{type,coordinates},properties{id,iconCategory,"
                 "startTime,from,to,delay,events{description}}}}")
# TomTom iconCategory -> our type. Jams and road works are left out on purpose.
TOMTOM_TYPES = {1: "crash", 14: "stalled_vehicle", 8: "road_closed", 7: "lane_closed"}
FHP_URL = "https://trafficincidents.flhsmv.gov/SmartWebClient/CadView.aspx"

_saved = {"at": 0.0, "data": None}


def inside_miami_dade(lat, lng):
    return SOUTH < lat < NORTH and WEST < lng < EAST


def point(incident_id, lat, lng, kind, description, started_at, source, delay_s=None):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]},
        "properties": {
            "id": incident_id, "type": kind, "description": description,
            "started_at": started_at, "delay_s": delay_s, "source": source,
        },
    }


def middle(geometry):
    """TomTom gives a line for closures; put the icon at its middle."""
    coords = geometry["coordinates"]
    if geometry["type"] == "Point":
        return coords[1], coords[0]
    lng, lat = coords[len(coords) // 2][:2]
    return lat, lng


def from_tomtom(client, now):
    key = os.getenv("TOMTOM_API_KEY", "").strip()
    if not key:
        raise ValueError("No TOMTOM_API_KEY; using FHP only.")
    response = client.get(TOMTOM_URL, params={
        "key": key, "bbox": f"{WEST},{SOUTH},{EAST},{NORTH}", "fields": TOMTOM_FIELDS,
        "language": "en-US", "timeValidityFilter": "present",
    })
    response.raise_for_status()

    features = []
    for incident in response.json().get("incidents", []):
        props = incident["properties"]
        kind = TOMTOM_TYPES.get(props.get("iconCategory"))
        if not kind or not props.get("startTime"):
            continue
        started = datetime.fromisoformat(props["startTime"].replace("Z", "+00:00"))
        # Old closures are usually long construction; only show fresh ones.
        if kind in ("road_closed", "lane_closed") and now - started > CLOSURE_MAX_AGE:
            continue
        lat, lng = middle(incident["geometry"])
        if not inside_miami_dade(lat, lng):
            continue
        where = " → ".join(p for p in (props.get("from"), props.get("to")) if p)
        what = (props.get("events") or [{}])[0].get("description", "")
        features.append(point(f"tt_{props['id']}", lat, lng, kind,
                              f"{what} · {where}" if where else what,
                              started.isoformat().replace("+00:00", "Z"), "tomtom",
                              props.get("delay")))
    return features


def fhp_type(text):
    text = text.lower()
    if "crash" in text:
        return "crash"
    if "disabled" in text or "abandoned" in text:
        return "stalled_vehicle"
    if "road closed" in text or "roadblock" in text:
        return "road_closed"
    return None


def from_fhp(client, now):
    page = client.get(FHP_URL).text
    features = []
    for number, row in re.findall(r'<tr[^>]*id="gvCAD_DXDataRow(\d+)".*?>(.*?)</tr>', page, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
                 for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) < 9 or cells[4] != "MIAMI-DADE":
            continue
        kind_text, reported, _, _, _, location, notes, lat, lng = cells[:9]
        kind = fhp_type(kind_text)
        if not kind or "CLEAR" in notes.upper():
            continue
        try:
            started = datetime.strptime(reported, "%m/%d/%Y %H:%M:%S").replace(tzinfo=MIAMI_TIME)
            lat, lng = float(lat), float(lng)
        except ValueError:
            continue
        if now - started > FHP_MAX_AGE or not inside_miami_dade(lat, lng):
            continue
        place = re.sub(r"\s+", " ", location).strip()
        features.append(point(f"fhp_{number}", lat, lng, kind, f"{kind_text} · {place}",
                              started.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                              "fhp"))
    return features


def near_same_spot(a, b):
    (lng1, lat1), (lng2, lat2) = a["geometry"]["coordinates"], b["geometry"]["coordinates"]
    return abs(lat1 - lat2) < 0.003 and abs(lng1 - lng2) < 0.003  # about 300 m


def get_incidents():
    """Live incidents as GeoJSON points. Never raises; an empty list means nothing was found."""
    if _saved["data"] is not None and time.time() - _saved["at"] < REFRESH_S:
        return _saved["data"]

    now = datetime.now(timezone.utc)
    features, sources = [], []
    with httpx.Client(timeout=15, follow_redirects=True) as client:
        for name, fetch in (("tomtom", from_tomtom), ("fhp", from_fhp)):
            try:
                found = fetch(client, now)
            except (httpx.HTTPError, ValueError, KeyError):
                continue
            sources.append(name)
            # Same kind of incident within ~300 m (both directions of a closure,
            # or FHP repeating a TomTom crash)? Keep the first one.
            for f in found:
                if not any(g["properties"]["type"] == f["properties"]["type"]
                           and near_same_spot(f, g) for g in features):
                    features.append(f)

    data = {"type": "FeatureCollection", "features": features,
            "properties": {"sources": sources, "updated_at": now.isoformat().replace("+00:00", "Z")}}
    _saved.update(at=time.time(), data=data)
    return data


if __name__ == "__main__":
    from collections import Counter
    from dotenv import load_dotenv
    from api.routing import ROOT
    load_dotenv(ROOT / ".env")

    result = get_incidents()
    feats = result["features"]
    print(f"Sources that answered: {result['properties']['sources']}")
    print(f"{len(feats)} incidents:", dict(Counter(f['properties']['type'] for f in feats)))
    for f in feats[:10]:
        p = f["properties"]
        print(f"  [{p['source']}] {p['type']}: {p['description'][:90]}")
