"""Person 4: build the State Farm road-risk grid -> data/risk/risk_grid.geojson.

Run: uv run python scripts/build_risk_grid.py            (downloads data the first time)
     uv run python scripts/build_risk_grid.py --offline  (reuses data/risk/raw/*.csv)

Score for each ~250 m square, from 0 to 1:
  70% crashes    - Miami-Dade Vision Zero, killed/seriously injured crashes 2019-2025 (fatal counts double)
  30% car theft  - Esri crime index for motor-vehicle theft, by ZIP code (100 = US average)
Only squares with at least one crash are kept, so the file stays small enough for the map.
"""

import csv
import json
import math
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
RISK_DIR = ROOT / "data" / "risk"
RAW_DIR = RISK_DIR / "raw"
CRASH_CSV = RAW_DIR / "crashes_ksi.csv"
THEFT_JSON = RAW_DIR / "theft_index_by_zip.geojson"
OUTPUT = RISK_DIR / "risk_grid.geojson"

CRASH_URL = ("https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/"
             "KSI_Crash_Events_Public/FeatureServer/0/query")
THEFT_URL = ("https://services.arcgis.com/AgwDJMQH12AGieWa/arcgis/rest/services/"
             "neMCL/FeatureServer/0/query")

# A few crash records have bad coordinates elsewhere in Florida; keep Miami-Dade only.
MIAMI_DADE_BOX = (25.1, 26.0, -80.9, -80.0)  # south, north, west, east

CELL_M = 250
CRASH_SHARE = 0.7
THEFT_SHARE = 0.3


def fetch_pages(client, url, params, page_size):
    """ArcGIS returns at most page_size rows per call, so ask page by page."""
    rows, offset = [], 0
    while True:
        page = client.get(url, params={**params, "resultOffset": offset,
                                       "resultRecordCount": page_size}).json()
        if "error" in page:
            raise RuntimeError(page["error"])
        rows += page["features"]
        if not page.get("exceededTransferLimit") and len(page["features"]) < page_size:
            return rows
        offset += page_size


def download():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=60) as client:
        crashes = fetch_pages(client, CRASH_URL, {
            "where": "1=1", "outFields": "CRASH_YEAR,S4_CRASH_SEVERITY",
            "outSR": 4326, "f": "json",
        }, 2000)
        with CRASH_CSV.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["lat", "lng", "year", "severity"])
            for c in crashes:
                if c.get("geometry"):
                    a = c["attributes"]
                    writer.writerow([round(c["geometry"]["y"], 6), round(c["geometry"]["x"], 6),
                                     a["CRASH_YEAR"], a["S4_CRASH_SEVERITY"]])
        print(f"Downloaded {len(crashes)} crashes")

        zips = fetch_pages(client, THEFT_URL, {
            "where": "f5 = 'Miami-Dade County'", "outFields": "f1,f2,f15",
            "outSR": 4326, "f": "geojson",
        }, 1000)
        THEFT_JSON.write_text(json.dumps({"type": "FeatureCollection", "features": zips}))
        print(f"Downloaded car-theft index for {len(zips)} ZIP codes")


def point_in_ring(lng, lat, ring):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > lat) != (y2 > lat) and lng < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def theft_at(lng, lat, zips):
    """Car-theft index of the ZIP code that holds this point (0 if none)."""
    for index, box, polygons in zips:
        if not (box[0] <= lng <= box[2] and box[1] <= lat <= box[3]):
            continue
        for rings in polygons:
            if point_in_ring(lng, lat, rings[0]) and not any(
                    point_in_ring(lng, lat, hole) for hole in rings[1:]):
                return index
    return 0


def load_zips():
    zips = []
    for feature in json.loads(THEFT_JSON.read_text())["features"]:
        geometry = feature["geometry"]
        if not geometry:
            continue
        polygons = geometry["coordinates"]
        if geometry["type"] == "Polygon":
            polygons = [polygons]
        points = [p for rings in polygons for p in rings[0]]
        box = (min(p[0] for p in points), min(p[1] for p in points),
               max(p[0] for p in points), max(p[1] for p in points))
        zips.append((feature["properties"]["f15"] or 0, box, polygons))
    return zips


def percentile_95(values):
    ordered = sorted(values)
    return ordered[int(0.95 * (len(ordered) - 1))] or 1


def build():
    with CRASH_CSV.open(encoding="utf-8") as f:
        crashes = [(float(r["lat"]), float(r["lng"]), r["severity"]) for r in csv.DictReader(f)]
    south, north, west, east = MIAMI_DADE_BOX
    kept = [c for c in crashes if south < c[0] < north and west < c[1] < east]
    print(f"Using {len(kept)} crashes ({len(crashes) - len(kept)} had coordinates outside Miami-Dade)")
    crashes = kept
    zips = load_zips()

    # Same simple math as the red circles: metres -> degrees.
    ref_lat = 25.76
    dlat = CELL_M / 111320
    dlng = CELL_M / (111320 * math.cos(math.radians(ref_lat)))

    cells = {}
    for lat, lng, severity in crashes:
        key = (math.floor(lat / dlat), math.floor(lng / dlng))
        cell = cells.setdefault(key, {"crashes": 0, "weighted": 0})
        cell["crashes"] += 1
        cell["weighted"] += 2 if severity == "Fatality" else 1

    for (row, col), cell in cells.items():
        cell["theft_index"] = theft_at((col + 0.5) * dlng, (row + 0.5) * dlat, zips)

    crash_top = percentile_95([c["weighted"] for c in cells.values()])
    theft_top = percentile_95([z[0] for z in zips])

    features = []
    for (row, col), cell in cells.items():
        crash_part = min(cell["weighted"] / crash_top, 1)
        theft_part = min(cell["theft_index"] / theft_top, 1)
        score = CRASH_SHARE * crash_part + THEFT_SHARE * theft_part
        west, south = col * dlng, row * dlat
        east, north = west + dlng, south + dlat
        square = [[round(x, 5), round(y, 5)] for x, y in
                  [(west, south), (east, south), (east, north), (west, north), (west, south)]]
        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [square]},
            "properties": {"score": round(score, 3), "crashes": cell["crashes"],
                           "theft_index": cell["theft_index"]},
        })

    OUTPUT.write_text(json.dumps({
        "type": "FeatureCollection",
        "properties": {"sources": [
            "Miami-Dade County Vision Zero - KSI Crashes (2019-2025)",
            "Esri Crime Index (motor vehicle theft) by ZIP code",
        ]},
        "features": features,
    }, separators=(",", ":")))

    scores = sorted(f["properties"]["score"] for f in features)
    print(f"Saved {len(features)} squares to {OUTPUT.relative_to(ROOT)} "
          f"({OUTPUT.stat().st_size / 1e6:.1f} MB)")
    print(f"Score: lowest {scores[0]}, middle {scores[len(scores) // 2]}, highest {scores[-1]}")


if __name__ == "__main__":
    if "--offline" not in sys.argv or not CRASH_CSV.exists():
        download()
    build()
