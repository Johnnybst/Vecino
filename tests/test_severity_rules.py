"""Critical / Moderate / Observed rules: size, rerouting, and how long each stays on the map."""
import unittest
from datetime import datetime, timedelta, timezone

from api.hazards import last_wipe, reports_to_hazards
from api.routing import _build_routes
from tests.test_routing_radius import CENTER, point, route

NOW = datetime(2026, 9, 27, 20, tzinfo=timezone.utc)  # 4 PM in Miami; today's wipe was at 4 AM


def seed(count, confidence, age_minutes):
    return {"id": 1, "primary_location": "Test", "latitude": 25.8, "longitude": -80.2,
            "source_count": count, "confidence_score": confidence,
            "latest_report": (NOW - timedelta(minutes=age_minutes)).isoformat()}


def shown(count, confidence, age_minutes):
    return reports_to_hazards([seed(count, confidence, age_minutes)], at=NOW)["features"]


class LevelTests(unittest.TestCase):
    def test_sizes_and_rerouting(self):
        for count, confidence, severity, radius, reroute in (
            (4, 0.7, "high", 250, True),     # Critical: ~2.5 blocks, reroutes
            (2, 0.7, "medium", 100, True),   # Moderate: ~1 block, reroutes
            (1, 0.7, "low", 100, False),     # Observed: ~1 block, warning only
        ):
            with self.subTest(severity=severity):
                props = shown(count, confidence, 10)[0]["properties"]
                self.assertEqual((props["severity"], props["radius_m"], props["reroute"]),
                                 (severity, radius, reroute))

    def test_how_long_each_level_stays(self):
        # Observed: 3 hours. Moderate: 6 hours.
        self.assertEqual(len(shown(1, 0.7, 170)), 1)
        self.assertEqual(shown(1, 0.7, 180), [])
        self.assertEqual(len(shown(2, 0.7, 350)), 1)
        self.assertEqual(shown(2, 0.7, 360), [])
        # Critical: grays out but stays until the 4 AM wipe (reported 6 AM -> still shown at 4 PM).
        critical = shown(4, 0.7, 600)
        self.assertEqual(len(critical), 1)
        self.assertLess(critical[0]["properties"]["weight"], 0.1)
        # Reported 3 AM, before this morning's wipe -> gone.
        self.assertEqual(shown(4, 0.7, 780), [])

    def test_last_wipe_is_the_most_recent_4_am_in_miami(self):
        self.assertEqual(last_wipe(NOW), datetime(2026, 9, 27, 8, tzinfo=timezone.utc))
        three_am = datetime(2026, 9, 27, 7, tzinfo=timezone.utc)
        self.assertEqual(last_wipe(three_am), datetime(2026, 9, 26, 8, tzinfo=timezone.utc))


def area(ident, reroute, severity, weight=0.8):
    return {"id": ident, "longitude": CENTER[0], "latitude": CENTER[1], "radius_m": 100,
            "weight": weight, "report_count": 1, "summary": "Synthetic area",
            "severity": severity, "reroute": reroute}


class SightingTests(unittest.IsolatedAsyncioTestCase):
    async def build(self, hazards, safe_y=0):
        return await _build_routes(point(-1000, 0), point(1000, 0), "driving-car", hazards,
                                   saved={"normal": route(0), "safe": route(safe_y)})

    async def test_observed_sighting_warns_without_detour(self):
        result = await self.build([area("hz_seen", False, "low")])
        self.assertFalse(result["has_detour"])
        self.assertEqual(result["normal"]["hazards_crossed"], [])
        self.assertEqual(result["sightings_on_route"], ["hz_seen"])
        self.assertIn("No detour needed", result["explanation"]["en"])

    async def test_moderate_still_reroutes(self):
        result = await self.build([area("hz_mod", True, "medium")], safe_y=600)
        self.assertTrue(result["has_detour"])
        self.assertEqual(result["safe"]["hazards_avoided"], ["hz_mod"])
        self.assertEqual(result["sightings_on_route"], [])

    async def test_faded_critical_still_reroutes(self):
        result = await self.build([area("hz_crit", True, "high", weight=0.05)], safe_y=600)
        self.assertEqual(result["safe"]["hazards_avoided"], ["hz_crit"])
