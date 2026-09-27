"""Per-report sizes affect crossings, endpoint exclusions, and saved routes."""
import math
import unittest
from unittest.mock import patch

from api.routing import _build_routes, load_demo_hazards, circle_ring

CENTER = [-80.22, 25.76]


def point(x, y):
    return [CENTER[0] + x / (111320 * math.cos(math.radians(CENTER[1]))),
            CENTER[1] + y / 111320]


def report(radius):
    return {"id": "hz_test", "longitude": CENTER[0], "latitude": CENTER[1],
            "radius_m": radius, "weight": 0.8, "report_count": 1, "summary": "Synthetic area"}


def route(y):
    return {"geometry": {"type": "LineString", "coordinates": [point(-1000, y), point(1000, y)]},
            "duration_s": 120 + y, "distance_m": 2000 + y}


class RoutingRadiusTests(unittest.IsolatedAsyncioTestCase):
    async def build(self, radius, normal_y=225, safe_y=600, origin=None):
        return await _build_routes(
            origin or point(-1000, normal_y), point(1000, normal_y), "driving-car",
            [report(radius)], saved={"normal": route(normal_y), "safe": route(safe_y)},
        )

    async def test_crossings_use_each_report_radius(self):
        for radius, crosses in [(150, False), (200, False), (250, True)]:
            with self.subTest(radius=radius):
                data = await self.build(radius)
                self.assertEqual(data["normal"]["hazards_crossed"], ["hz_test"] if crosses else [])
                self.assertEqual(data["safe"]["hazards_avoided"], ["hz_test"] if crosses else [])

    async def test_saved_detour_must_clear_report_radius_plus_300(self):
        # 500 m from the centre clears a 150 m report, but not a 250 m one.
        self.assertEqual((await self.build(150, normal_y=0, safe_y=500))["safe"]["hazards_avoided"], ["hz_test"])
        with self.assertRaises(ValueError):
            await self.build(250, normal_y=0, safe_y=500)

    async def test_endpoint_exclusion_uses_larger_circle_and_gap(self):
        for radius, left_out in [(150, []), (250, ["hz_test"])]:
            data = await self.build(radius, normal_y=0, origin=point(-500, 0))
            self.assertEqual(data["left_out"], left_out)
            self.assertEqual(data["endpoint_reports"]["origin"], left_out)

    async def test_invalid_radius_is_rejected(self):
        for radius in (0, -1, float("nan"), float("inf")):
            with self.subTest(radius=radius), self.assertRaises(ValueError):
                await self.build(radius)

    def test_hazards_adapter_preserves_radius(self):
        with patch("api.routing.get_hazards", return_value={"features": [{
            "geometry": {"coordinates": [circle_ring(CENTER, 250)]},
            "properties": {"id": "hz_test", "radius_m": 250, "weight": 0.8},
        }]}):
            self.assertEqual(load_demo_hazards()[0]["radius_m"], 250)
