"""Offline checks: no keys or network needed."""
import json
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from api.main import app
from api.routing import (ROOT, load_demo_hazards, circle_ring, REPORT_RADIUS_M,
                         EXTRA_GAP_M, DEMO_ORIGIN, DEMO_DESTINATION, DEMO_PROFILE)
import math
import asyncio
from api import explain as explanation_module

TRIP = {
    "origin": {"lat": 25.757, "lng": -80.374},
    "destination": {"lat": 25.766, "lng": -80.219},
    "profile": "driving-car",
}


class RouteApiTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"DEMO_MODE": "true"})
        self.env.start()
        self.addCleanup(self.env.stop)
        explanation_module._saved.clear()
        self.gemini = patch("api.explain._ask_gemini", new_callable=AsyncMock,
                            side_effect=RuntimeError("offline test"))
        self.gemini.start()
        self.addCleanup(self.gemini.stop)
        self.client = TestClient(app)
        features = json.loads((ROOT / "data/route_check.geojson").read_text())["features"]
        # Keep route scenarios independent of Person 1's evolving demo locations.
        self.hazards = patch("api.routing.get_demo_hazards", return_value={
            "features": [{"geometry": features[2]["geometry"], "properties": {
                "id": "hz_demo_1", "confidence": 0.8, "weight": 0.7,
                "report_count": 1,
                "summary": "1 report near the demo road",
            }}]
        })
        self.hazards.start()
        self.addCleanup(self.hazards.stop)
        self.routes = [{"geometry": f["geometry"], "properties": {
            key: f["properties"][key] for key in ("duration_s", "distance_m")
        }} for f in features[:2]]

    def test_crossing_returns_detour_and_shared_fields(self):
        with patch("api.routing.get_route", new_callable=AsyncMock, side_effect=self.routes) as get:
            response = self.client.post("/route", json=TRIP)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(set(data), {"safe", "normal", "extra_minutes", "explanation", "left_out"})
        self.assertEqual(data["safe"]["hazards_avoided"], ["hz_demo_1"])
        self.assertEqual(data["normal"]["hazards_crossed"], ["hz_demo_1"])
        self.assertEqual(set(data["explanation"]), {"en", "es", "ht"})
        self.assertGreater(data["extra_minutes"], 0)
        self.assertEqual(get.await_count, 2)
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_clear_route_reuses_normal(self):
        with patch("api.routing.get_route", new_callable=AsyncMock, return_value=self.routes[1]) as get:
            data = self.client.post("/route", json=TRIP).json()
        self.assertEqual(data["safe"]["geometry"], data["normal"]["geometry"])
        self.assertEqual(data["extra_minutes"], 0)
        self.assertEqual(data["safe"]["hazards_avoided"], [])
        self.assertEqual(get.await_count, 1)

    def test_endpoint_circle_is_left_out(self):
        report = load_demo_hazards()[0]
        trip = {**TRIP, "origin": {"lat": report["latitude"], "lng": report["longitude"]}}
        with patch("api.routing.get_route", new_callable=AsyncMock, return_value=self.routes[0]) as get:
            data = self.client.post("/route", json=trip).json()
        self.assertEqual(data["left_out"], ["hz_demo_1"])
        self.assertEqual(data["safe"]["hazards_avoided"], [])
        self.assertNotIn("looks clear", data["explanation"]["en"])
        self.assertEqual(get.await_count, 1)

    def test_detour_inside_gap_is_rejected(self):
        with patch("api.routing.get_route", new_callable=AsyncMock, return_value=self.routes[0]):
            response = self.client.post("/route", json=TRIP)
        self.assertEqual(response.status_code, 503)

    def test_faded_circle_is_ignored(self):
        hazards = [{**load_demo_hazards()[0], "weight": 0.09}]
        with patch("api.main.load_demo_hazards", return_value=hazards), patch(
            "api.routing.get_route", new_callable=AsyncMock, return_value=self.routes[0]
        ) as get:
            data = self.client.post("/route", json=TRIP).json()
        self.assertEqual(data["normal"]["hazards_crossed"], [])
        self.assertEqual(get.await_count, 1)

    def test_invalid_input_never_calls_provider(self):
        with patch("api.routing.get_route", new_callable=AsyncMock) as get:
            for trip in ({**TRIP, "profile": "flying"},
                         {**TRIP, "origin": {"lat": 999, "lng": -80}}):
                response = self.client.post("/route", json=trip)
                self.assertEqual(response.status_code, 422)
                self.assertNotIn("999", response.text)
        get.assert_not_awaited()

    def test_timeout_has_plain_error(self):
        with patch("api.routing.get_route", new_callable=AsyncMock,
                   side_effect=httpx.ReadTimeout("private provider details")):
            response = self.client.post("/route", json=TRIP)
        self.assertEqual(response.status_code, 504)
        self.assertNotIn("private", response.text)

    def test_live_mode_does_not_use_fake_reports(self):
        with patch.dict(os.environ, {"DEMO_MODE": "false"}), patch(
            "api.routing.get_route", new_callable=AsyncMock
        ) as get:
            response = self.client.post("/route", json=TRIP)
        self.assertEqual(response.status_code, 503)
        get.assert_not_awaited()

    def test_retry_uses_ten_strongest_once(self):
        base = load_demo_hazards()[0]
        hazards = [{**base, "id": f"hz_{i}", "weight": 0.15 + i * 0.05}
                   for i in range(12)]
        with patch("api.main.load_demo_hazards", return_value=hazards), patch(
            "api.routing.get_route", new_callable=AsyncMock,
            side_effect=[self.routes[0], httpx.ReadTimeout("offline"), self.routes[1]],
        ) as get:
            response = self.client.post("/route", json=TRIP)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(get.await_count, 3)
        self.assertEqual(len(get.await_args_list[1].args[4]), 12)
        self.assertEqual(len(get.await_args_list[2].args[4]), 10)
        self.assertEqual(len(response.json()["safe"]["hazards_avoided"]), 12)
        self.assertEqual(response.json()["left_out"], [])

    def test_retry_selects_by_weight_and_preserves_endpoint_exclusions(self):
        base = load_demo_hazards()[0]
        hazards = [{**base, "id": f"hz_{i}", "longitude": base["longitude"] + i * 0.00001,
                    "weight": 0.15 + i * 0.05} for i in range(12)]
        hazards.append({**base, "id": "endpoint", "weight": 1,
                        "longitude": TRIP["origin"]["lng"], "latitude": TRIP["origin"]["lat"]})
        error = httpx.HTTPStatusError("refused", request=httpx.Request("POST", "https://example.test"),
                                     response=httpx.Response(400))
        with patch("api.main.load_demo_hazards", return_value=hazards), patch(
            "api.routing.get_route", new_callable=AsyncMock,
            side_effect=[self.routes[0], error, self.routes[1]],
        ) as get:
            response = self.client.post("/route", json=TRIP)
        self.assertEqual(response.status_code, 200)
        radius = (REPORT_RADIUS_M + EXTRA_GAP_M) / math.cos(math.pi / 24)
        expected = [[circle_ring([h["longitude"], h["latitude"]], radius)]
                    for h in sorted(hazards[:-1], key=lambda h: h["weight"], reverse=True)[:10]]
        self.assertEqual(get.await_args_list[2].args[4], expected)
        self.assertEqual(response.json()["left_out"], ["endpoint"])

    def test_retry_stops_after_second_failure(self):
        with patch("api.routing.get_route", new_callable=AsyncMock,
                   side_effect=[self.routes[0], httpx.ReadTimeout("one"), httpx.ReadTimeout("two")]) as get:
            response = self.client.post("/route", json=TRIP)
        self.assertEqual(response.status_code, 504)
        self.assertEqual(get.await_count, 3)

    def test_retry_result_still_needs_extra_gap(self):
        with patch("api.routing.get_route", new_callable=AsyncMock,
                   side_effect=[self.routes[0], httpx.ReadTimeout("one"), self.routes[0]]) as get:
            response = self.client.post("/route", json=TRIP)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(get.await_count, 3)

    def test_gemini_receives_only_minutes_and_report_summaries(self):
        sentences = {"en": "Adds four minutes and avoids one reported area.",
                     "es": "Añade cuatro minutos y evita una zona reportada.",
                     "ht": "Ajoute kat minit epi evite yon zòn rapòte."}
        with patch("api.explain._ask_gemini", new_callable=AsyncMock, return_value=sentences) as ask, patch(
            "api.routing.get_route", new_callable=AsyncMock, side_effect=self.routes * 2
        ):
            first = self.client.post("/route", json=TRIP)
            second = self.client.post("/route", json=TRIP)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["explanation"], sentences)
        self.assertEqual(second.json()["explanation"], sentences)
        ask.assert_awaited_once_with(first.json()["extra_minutes"], ["1 report near the demo road"])

    def test_slow_gemini_returns_template(self):
        async def slow(*args):
            await asyncio.sleep(1)
        with patch("api.explain.explain", side_effect=slow), patch(
            "api.routing.EXPLANATION_TIMEOUT_S", 0.01
        ), patch("api.routing.get_route", new_callable=AsyncMock, side_effect=self.routes):
            response = self.client.post("/route", json=TRIP)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["explanation"],
                         explanation_module.backup_sentence(response.json()["extra_minutes"], 1))

    def test_bad_gemini_output_returns_template(self):
        for result in ({"en": "missing translations"}, {lang: "word " * 26 for lang in ("en", "es", "ht")}):
            with patch("api.explain.explain", new_callable=AsyncMock, return_value=result), patch(
                "api.routing.get_route", new_callable=AsyncMock, side_effect=self.routes
            ):
                response = self.client.post("/route", json=TRIP)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["explanation"],
                             explanation_module.backup_sentence(response.json()["extra_minutes"], 1))

    def test_endpoint_warning_does_not_call_gemini(self):
        report = load_demo_hazards()[0]
        trip = {**TRIP, "origin": {"lat": report["latitude"], "lng": report["longitude"]}}
        with patch("api.explain.explain", new_callable=AsyncMock) as explain, patch(
            "api.routing.get_route", new_callable=AsyncMock, return_value=self.routes[0]
        ):
            response = self.client.post("/route", json=trip)
        self.assertEqual(response.status_code, 200)
        self.assertIn("could not be excluded", response.json()["explanation"]["en"])
        explain.assert_not_awaited()


class DemoBackupTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"DEMO_MODE": "true"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.client = TestClient(app)
        self.trip = {
            "origin": {"lng": DEMO_ORIGIN[0], "lat": DEMO_ORIGIN[1]},
            "destination": {"lng": DEMO_DESTINATION[0], "lat": DEMO_DESTINATION[1]},
            "profile": DEMO_PROFILE,
        }

    def test_offline_demo_uses_backup_without_writing(self):
        path = ROOT / "data/demo_route.json"
        before = path.read_bytes()
        with patch("api.routing.get_route", new_callable=AsyncMock,
                   side_effect=httpx.ConnectError("offline")) as get:
            response = self.client.post("/route", json=self.trip)
        self.assertEqual(response.status_code, 200)
        self.assertIn("Saved demo", response.json()["explanation"]["en"])
        self.assertEqual(response.json()["safe"]["hazards_avoided"], ["hz_1"])
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(get.await_count, 1)

    def test_backup_recomputes_faded_report_claims(self):
        with patch("api.main.load_demo_hazards", return_value=[]), patch(
            "api.routing.get_route", new_callable=AsyncMock, side_effect=httpx.ReadTimeout("offline")
        ):
            response = self.client.post("/route", json=self.trip)
        data = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["safe"]["hazards_avoided"], [])
        self.assertEqual(data["normal"]["hazards_crossed"], [])
        self.assertEqual(data["extra_minutes"], 0)
        self.assertEqual(data["safe"]["geometry"], data["normal"]["geometry"])

    def test_other_trip_or_profile_never_gets_fixed_backup(self):
        trips = [{**self.trip, "profile": "foot-walking"},
                 {**self.trip, "destination": {"lat": 25.7653, "lng": -80.208}}]
        with patch("api.routing.get_route", new_callable=AsyncMock, side_effect=httpx.ConnectError("offline")):
            for trip in trips:
                self.assertEqual(self.client.post("/route", json=trip).status_code, 503)

    def test_server_outage_gets_backup_but_bad_key_does_not(self):
        for status, expected in [(503, 200), (429, 200), (401, 502), (400, 502)]:
            error = httpx.HTTPStatusError("failed", request=httpx.Request("POST", "https://example.test"),
                                         response=httpx.Response(status))
            with patch("api.routing.get_route", new_callable=AsyncMock, side_effect=error):
                self.assertEqual(self.client.post("/route", json=self.trip).status_code, expected)

    def test_missing_backup_returns_plain_error(self):
        with patch("api.routing.BACKUP_FILE") as file, patch(
            "api.routing.get_route", new_callable=AsyncMock, side_effect=httpx.ConnectError("offline")
        ):
            file.read_text.side_effect = FileNotFoundError()
            self.assertEqual(self.client.post("/route", json=self.trip).status_code, 503)


if __name__ == "__main__":
    unittest.main()
