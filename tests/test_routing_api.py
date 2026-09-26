"""Offline checks: no keys or network needed."""
import json
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from api.main import app
from api.routing import ROOT, load_demo_hazards

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
        self.client = TestClient(app)
        features = json.loads((ROOT / "data/route_check.geojson").read_text())["features"]
        # Keep route scenarios independent of Person 1's evolving demo locations.
        self.hazards = patch("api.routing.get_demo_hazards", return_value={
            "features": [{"geometry": features[2]["geometry"], "properties": {
                "id": "hz_demo_1", "confidence": 0.8, "weight": 0.7,
                "report_count": 1,
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


if __name__ == "__main__":
    unittest.main()
