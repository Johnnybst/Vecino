"""Critical / Moderate / Observed rules: size, rerouting, and how long each stays on the map."""
import unittest
from datetime import datetime, timedelta, timezone

from api.hazards import reports_to_hazards
from api.routing import _build_routes
from tests.test_routing_radius import CENTER, point, route

NOW = datetime(2026, 9, 27, 12, tzinfo=timezone.utc)


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

    def test_critical_grays_but_stays_while_others_leave_at_three_hours(self):
        self.assertEqual(len(shown(4, 0.7, 300)), 1)   # Critical, 5 h old: still shown
        self.assertLess(shown(4, 0.7, 300)[0]["properties"]["weight"], 0.1)
        for count in (2, 1):                            # Moderate, Observed
            with self.subTest(count=count):
                self.assertEqual(len(shown(count, 0.7, 170)), 1)
                self.assertEqual(shown(count, 0.7, 180), [])

    def test_nothing_older_than_six_hours(self):
        self.assertEqual(shown(4, 0.9, 361), [])


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
