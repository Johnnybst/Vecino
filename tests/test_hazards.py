"""Live-source checks use a temporary database, never the collector's data."""
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from api.hazards import get_hazards, load_live_reports, reports_to_hazards
from api.main import app


class SeverityTests(unittest.TestCase):
    def test_severity_properties_match_drawn_radius(self):
        now = datetime.now(timezone.utc)
        for count, confidence, severity, radius in (
            (1, 0.65, "low", 75),
            (2, 0.65, "medium", 90),
            (3, 0.84, "medium", 90),
            (4, 0.65, "high", 100),
            (1, 0.85, "high", 100),
        ):
            with self.subTest(count=count, confidence=confidence):
                report = {
                    "id": 1, "primary_location": "Test location",
                    "latitude": 25.8, "longitude": -80.2,
                    "source_count": count, "confidence_score": confidence,
                    "latest_report": now.isoformat(),
                }
                feature = reports_to_hazards([report], at=now)["features"][0]
                self.assertEqual(feature["properties"]["severity"], severity)
                self.assertEqual(feature["properties"]["radius_m"], radius)
                ring = feature["geometry"]["coordinates"][0]
                self.assertEqual(ring[0], ring[-1])
                north_radius = (max(point[1] for point in ring) - 25.8) * 111320
                self.assertAlmostEqual(north_radius, radius, places=5)


class LiveHazardsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "reports.db"
        self.now = datetime.now(timezone.utc)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("""CREATE TABLE clusters (
                id INTEGER, primary_location TEXT, latitude REAL, longitude REAL,
                confidence_score REAL, source_count INTEGER, latest_report TEXT,
                notified INTEGER)""")
            rows = [
                (1, 10, 0.8, 25.8, -80.2),
                (2, 361, 0.9, 25.8, -80.2),
                (3, -10, 0.9, 25.8, -80.2),
                (4, 10, 0.9, None, -80.2),
                (5, 10, 0.9, 25.8, None),
                (6, 180, 0.5, 25.8, -80.2),
            ]
            for ident, age, confidence, lat, lng in rows:
                stamp = (self.now - timedelta(minutes=age)).isoformat()
                db.execute("INSERT INTO clusters VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
                           (ident, "Test location", lat, lng, confidence, 2, stamp))
        self.env = patch.dict(os.environ, {"DEMO_MODE": "false", "DB_PATH": str(self.path)})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_recent_unnotified_clusters_and_fading(self):
        before = self.path.read_bytes()
        self.assertEqual([r["id"] for r in load_live_reports(self.now)], [1, 6])
        features = get_hazards(self.now)["features"]
        self.assertEqual([f["properties"]["id"] for f in features], ["hz_1"])
        self.assertTrue(features[0]["properties"]["reported_at"].endswith("Z"))
        self.assertEqual(self.path.read_bytes(), before)

    def test_offset_and_naive_utc_dates(self):
        for stamp in (
            (self.now - timedelta(minutes=10)).replace(tzinfo=None).isoformat(),
            (self.now - timedelta(minutes=10)).astimezone(timezone(timedelta(hours=-4))).isoformat(),
        ):
            with closing(sqlite3.connect(self.path)) as db, db:
                db.execute("UPDATE clusters SET latest_report = ? WHERE id = 1", (stamp,))
            self.assertEqual(get_hazards(self.now)["features"][0]["properties"]["id"], "hz_1")

    def test_live_coverage_includes_edges_and_excludes_outside_reports(self):
        # NEWAGENTS.md defines a rectangular coverage area, including its edges.
        cases = [
            (25.13, -80.88, True), (25.98, -80.11, True),
            (25.13, -80.11, True), (25.98, -80.88, True),
            (25.1299, -80.2, False), (25.9801, -80.2, False),
            (25.8, -80.8801, False), (25.8, -80.1099, False),
            (26.12, -80.14, False),
        ]
        for lat, lng, included in cases:
            with self.subTest(lat=lat, lng=lng):
                with closing(sqlite3.connect(self.path)) as db, db:
                    db.execute("UPDATE clusters SET latitude = ?, longitude = ? WHERE id = 1",
                               (lat, lng))
                before = self.path.read_bytes()
                reports = load_live_reports(self.now)
                self.assertEqual(any(r["id"] == 1 for r in reports), included)
                features = get_hazards(self.now)["features"]
                self.assertEqual(any(f["properties"]["id"] == "hz_1" for f in features), included)
                self.assertEqual(self.path.read_bytes(), before)

    def test_time_preview_fades_all_reports(self):
        self.assertEqual(get_hazards(self.now + timedelta(hours=4))["features"], [])

    def test_missing_database_is_not_created_or_replaced_with_demo(self):
        missing = Path(self.temp.name) / "missing.db"
        with patch.dict(os.environ, {"DB_PATH": str(missing)}):
            response = TestClient(app).get("/hazards")
            self.assertEqual(response.status_code, 503)
        self.assertFalse(missing.exists())

    def test_empty_database_returns_empty_collection(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("DELETE FROM clusters")
        self.assertEqual(get_hazards(self.now), {"type": "FeatureCollection", "features": []})

    def test_demo_does_not_need_database(self):
        with patch.dict(os.environ, {"DEMO_MODE": "true", "DB_PATH": "/missing/reports.db"}):
            self.assertGreater(len(get_hazards()["features"]), 0)

    def test_live_api_and_routing_share_reports(self):
        client = TestClient(app)
        features = client.get("/hazards").json()["features"]
        self.assertEqual([f["properties"]["id"] for f in features], ["hz_1"])
        with patch("api.main.build_routes", new_callable=AsyncMock, return_value={}) as build:
            response = client.post("/route", json={
                "origin": {"lat": 25.7, "lng": -80.3},
                # Inside the Miami-Dade box (-80.1 is in the ocean and now gets outside_area).
                "destination": {"lat": 25.9, "lng": -80.15},
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual([h["id"] for h in build.call_args.args[3]], ["hz_1"])
