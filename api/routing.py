"""Person 2, check-in 1: two real routes around one synthetic circle.

Run with ``uv run python -m api.routing``. Only the fixed public demo trip
is exported. The server uses build_routes without exporting user trips.
"""

import asyncio
import argparse
import json
import math
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from api.hazards import get_hazards

ROOT = Path(__file__).resolve().parents[1]
PROFILES = {"driving-car", "foot-walking", "cycling-regular"}
REPORT_RADIUS_M = 150
# Demo spacing preference, not a verified safe distance.
EXTRA_GAP_M = 300
DEMO_ORIGIN = [-80.230, 25.7653]
DEMO_DESTINATION = [-80.209, 25.7653]
DEMO_PROFILE = "driving-car"
BACKUP_FILE = ROOT / "data" / "demo_route.json"
# Matches explain(): Gemini's first call after a restart can take ~5 s.
EXPLANATION_TIMEOUT_S = 6


async def get_route(client, origin, destination, profile="driving-car", polygons=None, language="en"):
    """Pick the directions service. ROUTING_PROVIDER=tomtom adds live traffic; default is ORS."""
    if profile not in PROFILES:
        raise ValueError("Choose driving-car, foot-walking, or cycling-regular.")
    if os.getenv("ROUTING_PROVIDER", "ors").strip().lower() == "tomtom":
        return await get_tomtom_route(client, origin, destination, profile, polygons, language)
    return await get_ors_route(client, origin, destination, profile, polygons, language)


# Turn-by-turn text: neither service has Haitian Creole, so Kreyol users get English turns.
ORS_LANGUAGES = {"en": "en", "es": "es", "ht": "en"}
TOMTOM_LANGUAGES = {"en": "en-US", "es": "es-ES", "ht": "en-US"}


# TomTom travel modes; live traffic only matters for driving.
TOMTOM_MODES = {"driving-car": "car", "foot-walking": "pedestrian", "cycling-regular": "bicycle"}
TOMTOM_MAX_AREAS = 10


def distance_to_trip_m(center, origin, destination):
    """How far an area's centre is from the straight start-to-end line (for picking 10 areas)."""
    return clearance_m([origin, destination], center)


def avoid_rectangles(polygons, origin, destination):
    """TomTom avoids rectangles only (max 10): use the box around each circle, nearest to the trip first."""
    boxes = []
    for polygon in polygons or []:
        ring = polygon[0]
        lngs, lats = [p[0] for p in ring], [p[1] for p in ring]
        center = [sum(lngs) / len(lngs), sum(lats) / len(lats)]
        boxes.append((distance_to_trip_m(center, origin, destination), {
            "southWestCorner": {"latitude": min(lats), "longitude": min(lngs)},
            "northEastCorner": {"latitude": max(lats), "longitude": max(lngs)},
        }))
    boxes.sort(key=lambda item: item[0])
    return [box for _, box in boxes[:TOMTOM_MAX_AREAS]]


async def get_tomtom_route(client, origin, destination, profile="driving-car", polygons=None, language="en"):
    """Fastest route with live traffic, going around the report areas (as rectangles)."""
    key = os.getenv("TOMTOM_API_KEY", "").strip()
    if not key:
        raise ValueError("Add your TOMTOM_API_KEY to the root .env file.")
    points = f"{origin[1]},{origin[0]}:{destination[1]},{destination[0]}"
    rectangles = avoid_rectangles(polygons, origin, destination)
    url = f"https://api.tomtom.com/routing/1/calculateRoute/{points}/json"
    params = {"key": key, "travelMode": TOMTOM_MODES[profile], "routeType": "fastest",
              "traffic": "true" if profile == "driving-car" else "false",
              "instructionsType": "text", "language": TOMTOM_LANGUAGES.get(language, "en-US")}
    # TomTom rejects a POST with an empty body, so the plain route is a GET.
    if rectangles:
        response = await client.post(url, params=params, json={"avoidAreas": {"rectangles": rectangles}})
    else:
        response = await client.get(url, params=params)
    response.raise_for_status()
    route = response.json()["routes"][0]
    summary = route["summary"]
    coordinates = [[p["longitude"], p["latitude"]] for leg in route["legs"] for p in leg["points"]]
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coordinates},
        "properties": {
            "duration_s": summary["travelTimeInSeconds"],
            "distance_m": summary["lengthInMeters"],
            # Extra time from today's traffic, already included in duration_s.
            "traffic_delay_s": summary.get("trafficDelayInSeconds", 0),
            # Turns: "at" is the index of the point on the line where the turn happens.
            "steps": [{"instruction": i["message"], "at": i["pointIndex"]}
                      for i in route.get("guidance", {}).get("instructions", [])
                      if i.get("message") and isinstance(i.get("pointIndex"), int)],
        },
    }


async def get_ors_route(client, origin, destination, profile="driving-car", polygons=None, language="en"):
    """Request GeoJSON using [longitude, latitude] coordinates."""
    key = os.getenv("ORS_API_KEY", "").strip()
    if not key or key == "paste_your_actual_key_here":
        raise ValueError("Add your ORS_API_KEY to the root .env file.")
    body = {"coordinates": [origin, destination], "language": ORS_LANGUAGES.get(language, "en")}
    if polygons:
        body["options"] = {
            "avoid_polygons": {"type": "MultiPolygon", "coordinates": polygons}
        }
    response = await client.post(
        f"https://api.openrouteservice.org/v2/directions/{profile}/geojson",
        headers={"Authorization": key},
        json=body,
    )
    response.raise_for_status()
    feature = response.json()["features"][0]
    # Keep only route geometry and summary, excluding provider metadata.
    summary = feature["properties"]["summary"]
    return {
        "type": "Feature",
        "geometry": feature["geometry"],
        "properties": {
            "duration_s": summary["duration"],
            "distance_m": summary["distance"],
            # Turns: "at" is the index of the point on the line where the turn happens.
            "steps": [{"instruction": step["instruction"], "at": step["way_points"][0]}
                      for segment in feature["properties"].get("segments", [])
                      for step in segment.get("steps", []) if step.get("instruction")],
        },
    }


def circle_ring(center, radius_m=REPORT_RADIUS_M):
    """A closed 24-sided circle, 300 metres wide by default."""
    lng, lat = center[:2]
    ring = [
        [
            lng + radius_m * math.cos(i * math.tau / 24)
            / (111320 * math.cos(math.radians(lat))),
            lat + radius_m * math.sin(i * math.tau / 24) / 111320,
        ]
        for i in range(24)
    ]
    return ring + [ring[0][:]]


def clearance_m(coordinates, center):
    """Closest distance to any route segment, in local Miami metres."""
    lng, lat = center[:2]
    points = [
        ((p[0] - lng) * 111320 * math.cos(math.radians(lat)),
         (p[1] - lat) * 111320)
        for p in coordinates
    ]
    closest = math.inf
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        dx, dy = bx - ax, by - ay
        length_sq = dx * dx + dy * dy
        t = max(0, min(1, -(ax * dx + ay * dy) / length_sq)) if length_sq else 0
        closest = min(closest, math.hypot(ax + t * dx, ay + t * dy))
    return closest


def load_demo_hazards():
    """Load shared demo or live circles; keep this name for existing callers."""
    hazards = []
    for feature in get_hazards()["features"]:
        ring = feature["geometry"]["coordinates"][0][:-1]
        hazards.append({
            **feature["properties"],
            "longitude": sum(p[0] for p in ring) / len(ring),
            "latitude": sum(p[1] for p in ring) / len(ring),
        })
    return hazards


def template_explanation(extra_minutes, area_count, report_count, left_out):
    if area_count:
        minute_en = "minute" if extra_minutes == 1 else "minutes"
        area_en = "area" if area_count == 1 else "areas"
        report_en = "report" if report_count == 1 else "reports"
        minute_es = "minuto" if extra_minutes == 1 else "minutos"
        area_es = "zona" if area_count == 1 else "zonas"
        report_es = "reporte" if report_count == 1 else "reportes"
        return {
            "en": f"This route adds {extra_minutes} {minute_en} and avoids {area_count} reported {area_en} containing {report_count} {report_en}.",
            "es": f"Esta ruta añade {extra_minutes} {minute_es} y evita {area_count} {area_es} con {report_count} {report_es} de actividad.",
            "ht": f"Wout sa a ajoute {extra_minutes} minit epi li evite {area_count} zòn ki gen {report_count} rapò aktivite.",
        }
    if left_out:
        return {
            "en": "Some reported areas are near your start or destination and could not be excluded.",
            "es": "Algunas zonas reportadas están cerca del inicio o destino y no se pudieron excluir.",
            "ht": "Gen zòn rapòte toupre depa oswa destinasyon ou ki pa t kapab eskli.",
        }
    return {
        "en": "The usual route looks clear of the available reported activity areas.",
        "es": "La ruta habitual parece libre de las zonas de actividad reportadas disponibles.",
        "ht": "Wout nòmal la sanble pa pase nan zòn kote rapò ki disponib yo endike aktivite.",
    }


def sighting_explanation(count):
    if count == 1:
        return {
            "en": "No detour needed. Your route passes an area with an observed sighting; stay aware.",
            "es": "No hace falta desvío. Tu ruta pasa por una zona con un avistamiento observado; mantente atento.",
            "ht": "Pa bezwen detou. Wout ou pase bò yon zòn kote yo te wè aktivite; rete vijilan.",
        }
    return {
        "en": f"No detour needed. Your route passes {count} areas with observed sightings; stay aware.",
        "es": f"No hace falta desvío. Tu ruta pasa por {count} zonas con avistamientos observados; mantente atento.",
        "ht": f"Pa bezwen detou. Wout ou pase bò {count} zòn kote yo te wè aktivite; rete vijilan.",
    }


async def build_routes(origin, destination, profile, hazards, language="en"):
    """Use a saved fixed demo only on a service outage, never for other trips."""
    try:
        return await _build_routes(origin, destination, profile, hazards, language=language)
    except (httpx.RequestError, httpx.HTTPStatusError) as exc:
        if isinstance(exc, httpx.HTTPStatusError):
            if exc.response.status_code != 429 and exc.response.status_code < 500:
                raise
        if not (os.getenv("DEMO_MODE", "false").lower() == "true"
                and list(origin) == DEMO_ORIGIN and list(destination) == DEMO_DESTINATION
                and profile == DEMO_PROFILE):
            raise
        saved = json.loads(BACKUP_FILE.read_text())
        # Recalculate report IDs and check spacing against today's demo circles.
        result = await _build_routes(origin, destination, profile, hazards, saved=saved)
        result["explanation"] = {
            "en": "Saved demo route: directions service unavailable. Report comparisons use the current demo circles.",
            "es": "Ruta de demostración guardada: servicio de rutas no disponible. La comparación usa los círculos actuales de demostración.",
            "ht": "Wout demonstrasyon anrejistre: sèvis direksyon an pa disponib. Konparezon rapò yo sèvi ak sèk demonstrasyon aktyèl yo.",
        }
        return result


async def _build_routes(origin, destination, profile, hazards, saved=None, language="en"):
    """Build the team's response with a 300 m extra gap and no trip storage."""
    active, sightings = [], []
    for h in hazards:
        # The server already decides which reports are still shown (by level); only older
        # callers without a level fall back to the fade weight.
        if h["weight"] < 0.1 and "severity" not in h:
            continue
        # Older saved/demo reports omit this field and retain their 150 m size.
        radius = float(h.get("radius_m", REPORT_RADIUS_M))
        if not math.isfinite(radius) or radius <= 0:
            raise ValueError("Report radius must be a positive finite distance.")
        # Observed sightings (reroute=False) only get a notice, never a detour.
        (active if h.get("reroute", True) else sightings).append({**h, "radius_m": radius})
    left_out, usable = [], []
    endpoint_reports = {"origin": [], "destination": []}
    for hazard in active:
        center = [hazard["longitude"], hazard["latitude"]]
        avoidance_radius = hazard["radius_m"] + EXTRA_GAP_M
        # Enclose the full gap even between the polygon's vertices.
        outer_radius = avoidance_radius / math.cos(math.pi / 24)
        hazard = {**hazard, "center": center, "avoidance_radius": avoidance_radius,
                  "outer_radius": outer_radius}
        nearby_endpoints = [name for name, point in (("origin", origin), ("destination", destination))
                            if clearance_m([point, point], center) <= outer_radius]
        for name in nearby_endpoints:
            endpoint_reports[name].append(hazard["id"])
        if nearby_endpoints:
            left_out.append(hazard["id"])
        else:
            usable.append(hazard)

    async with httpx.AsyncClient(timeout=30) as client:
        async def request_route(polygons=None):
            if saved is None:
                return await get_route(client, origin, destination, profile, polygons, language=language)
            route = saved["safe" if polygons else "normal"]
            if (route["geometry"]["type"] != "LineString"
                    or len(route["geometry"]["coordinates"]) < 2):
                raise ValueError("Invalid saved demo route.")
            return {"geometry": route["geometry"], "properties": {
                "duration_s": route["duration_s"], "distance_m": route["distance_m"],
            }}

        normal = await request_route()
        line = normal["geometry"]["coordinates"]
        crossed = [h["id"] for h in active if clearance_m(
            line, [h["longitude"], h["latitude"]]) <= h["radius_m"]]
        detour = normal
        # Shared contract: keep the usual route when it crosses no report.
        needs_detour = any(h["id"] in crossed for h in usable)
        if needs_detour:
            polygons = [[circle_ring(h["center"], h["outer_radius"])] for h in usable]
            try:
                detour = await request_route(polygons)
            except (httpx.RequestError, httpx.HTTPStatusError) as exc:
                # Credentials and rate limits cannot be fixed with fewer circles.
                if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in (401, 403, 429):
                    raise
                strongest = sorted(usable, key=lambda h: h["weight"], reverse=True)[:10]
                polygons = [[circle_ring(h["center"], h["outer_radius"])] for h in strongest]
                detour = await request_route(polygons)
            if any(clearance_m(detour["geometry"]["coordinates"], h["center"]) < h["avoidance_radius"]
                   for h in usable):
                raise ValueError("No route with the requested extra gap was found.")

    avoided = [h["id"] for h in usable if h["id"] in crossed and clearance_m(
        detour["geometry"]["coordinates"], h["center"]) >= h["avoidance_radius"]]
    extra = max(0, math.ceil((detour["properties"]["duration_s"]
                             - normal["properties"]["duration_s"]) / 60))
    report_count = sum(h["report_count"] for h in usable if h["id"] in avoided)
    explanation = template_explanation(extra, len(avoided), report_count, left_out)
    if avoided and not left_out and saved is None:
        # Import here: Person 4's module imports ROOT from this module.
        from api.explain import explain, backup_sentence

        summaries = [h["summary"] for h in usable if h["id"] in avoided]
        try:
            result = await asyncio.wait_for(
                explain(extra, summaries), timeout=EXPLANATION_TIMEOUT_S,
            )
            if not isinstance(result, dict) or any(
                not isinstance(result.get(lang), str)
                or not result[lang].strip() or len(result[lang].split()) > 25
                for lang in ("en", "es", "ht")
            ):
                raise ValueError("Invalid explanation.")
            explanation = {lang: result[lang] for lang in ("en", "es", "ht")}
        except Exception:
            explanation = backup_sentence(extra, len(avoided))

    # Sightings on the route the person will actually take (the safe one).
    sightings_on_route = [h["id"] for h in sightings if clearance_m(
        detour["geometry"]["coordinates"], [h["longitude"], h["latitude"]]) <= h["radius_m"]]
    if sightings_on_route and not avoided and not left_out:
        explanation = sighting_explanation(len(sightings_on_route))
    return {
        "safe": {"geometry": detour["geometry"], **detour["properties"], "hazards_avoided": avoided},
        "normal": {"geometry": normal["geometry"], **normal["properties"], "hazards_crossed": crossed},
        "has_detour": detour["geometry"] != normal["geometry"],
        "extra_minutes": extra, "explanation": explanation, "left_out": left_out,
        "endpoint_reports": endpoint_reports,
        "sightings_on_route": sightings_on_route,
    }


async def save_demo_backup():
    """Explicitly save only this fixed public trip; API requests never write files."""
    load_dotenv(ROOT / ".env")
    result = await _build_routes(
        DEMO_ORIGIN, DEMO_DESTINATION, DEMO_PROFILE, load_demo_hazards(),
    )
    if not result["safe"]["hazards_avoided"]:
        raise ValueError("The demo trip must demonstrate a detour before saving.")
    BACKUP_FILE.write_text(json.dumps(result, indent=2) + "\n")
    print("Saved fixed Little Havana driving demo to data/demo_route.json.")
    print(f"Demo detour adds {result['extra_minutes']} minutes.")


async def demo():
    load_dotenv(ROOT / ".env")
    # Fixed FIU -> Little Havana example, never a user's trip.
    origin, destination = [-80.374, 25.757], [-80.219, 25.766]
    async with httpx.AsyncClient(timeout=30) as client:
        normal = await get_route(client, origin, destination)
        line = normal["geometry"]["coordinates"]
        center = line[len(line) // 2][:2]
        ring = circle_ring(center)
        required_radius = REPORT_RADIUS_M + EXTRA_GAP_M
        # Enclose the full 450 m radius even between the polygon's vertices.
        avoid_ring = circle_ring(center, required_radius / math.cos(math.pi / 24))
        detour = await get_route(client, origin, destination, polygons=[[avoid_ring]])

    # Conservative verification against the enclosing circle, including segments.
    clearance = clearance_m(detour["geometry"]["coordinates"], center)
    if clearance < required_radius:
        raise ValueError("The returned detour does not leave the requested gap.")
    normal["properties"].update(name="Normal demo route", stroke="#808080", synthetic=True)
    detour["properties"].update(name="Detour demo route", stroke="#16803c", synthetic=True)
    circle = {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [ring]},
        "properties": {
            "name": "Synthetic report — demo only", "synthetic": True,
            "stroke": "#bd4b4b", "fill": "#bd4b4b", "fill-opacity": 0.3,
        },
    }
    output = ROOT / "data" / "route_check.geojson"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({
        "type": "FeatureCollection", "features": [normal, detour, circle]
    }, indent=2) + "\n")
    print("PASS: normal route crosses the fake circle; detour goes around it.")
    print(f"Closest gap beyond red circle: {clearance - REPORT_RADIUS_M:.0f} metres "
          f"(requested: {EXTRA_GAP_M} metres).")
    for route in (normal, detour):
        props = route["properties"]
        print(f"{props['name']}: {props['duration_s'] / 60:.1f} minutes")
    print("Map file: data/route_check.geojson")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save-backup", action="store_true", help="Save the fixed Little Havana demo response")
    args = parser.parse_args()
    try:
        asyncio.run(save_demo_backup() if args.save_backup else demo())
    except httpx.HTTPStatusError as exc:
        raise SystemExit(f"Route service returned HTTP {exc.response.status_code}.") from None
    except httpx.RequestError:
        raise SystemExit("Could not reach the route service. Check your connection and retry.") from None
    except (ValueError, KeyError, IndexError):
        raise SystemExit("Route check failed. Check your key and the service response format.") from None
