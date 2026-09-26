import math
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

SEED_FILE = Path(__file__).resolve().parent.parent / "data" / "seed_reports.json"

# Keep demo dates steady while the server runs, so circles can fade.
DEMO_STARTED_AT = datetime.now(timezone.utc)


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


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
def get_demo_hazards(at=None):
    current_time = at if at is not None else datetime.now(timezone.utc)
    features = []

    for report in load_demo_reports():
        reported_at = parse_time(report["latest_report"])

        # Don't show reports that haven't happened at the selected time.
        if reported_at > current_time:
            continue

        age_minutes = (current_time - reported_at).total_seconds() / 60
        if age_minutes > 360:
            continue

        confidence = report["confidence_score"]
        weight = confidence * math.exp(-age_minutes / 90)

        if weight < 0.1:
            continue

        count = report["source_count"]

        features.append({
            "type": "Feature",
            "geometry": make_circle(
                report["latitude"],
                report["longitude"],
            ),
            "properties": {
                "id": f"hz_{report['id']}",
                "summary": f"{count} reports near {report['primary_location']}",
                "reported_at": report["latest_report"],
                "confidence": confidence,
                "report_count": count,
                "weight": weight,
            },
        })

    return {
        "type": "FeatureCollection",
        "features": features,
    }