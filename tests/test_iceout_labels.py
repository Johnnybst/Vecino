"""Live circles use IceOut's own level (Critical / Active / Observed) when the reports came from IceOut."""
import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from api.hazards import get_hazards
from storage.database import SCHEMA_SQL


class IceoutLabelTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        path = Path(self.temp.name) / "reports.db"
        stamp = (self.now - timedelta(minutes=20)).isoformat()
        with closing(sqlite3.connect(path)) as db, db:
            db.executescript(SCHEMA_SQL)
            # cluster id, IceOut labels of its reports (None = not from IceOut), source_count
            for cluster_id, labels, count in [(1, [2], 1),        # one "Active" report -> Moderate
                                              (2, [1, 0], 2),     # Observed + Critical -> Critical
                                              (3, [1], 1),        # Observed -> Observed
                                              (4, [None], 1),     # not IceOut -> by report count (Observed)
                                              (5, [3, 3, 3, 3], 4), (6, [1, 2], 2)]:  # "Other" only -> by count (Critical)
                db.execute("""INSERT INTO clusters (id, primary_location, latitude, longitude, confidence_score,
                              source_count, unique_source_types, earliest_report, latest_report, city)
                              VALUES (?, 'Test', 25.8, -80.2, 0.6, ?, 1, ?, ?, 'miami')""",
                           (cluster_id, count, stamp, stamp))
                for n, label in enumerate(labels):
                    source = "iceout" if label is not None else "bluesky"
                    db.execute("""INSERT INTO raw_reports (source_type, source_id, original_text, timestamp,
                                  collected_at, raw_metadata, cluster_id) VALUES (?, ?, 'x', ?, ?, ?, ?)""",
                               (source, f"{cluster_id}-{n}", stamp, stamp,
                                json.dumps({"category_enum": label} if label is not None else {}), cluster_id))
        env = patch.dict(os.environ, {"DEMO_MODE": "false", "DB_PATH": str(path)})
        env.start()
        self.addCleanup(env.stop)

    def test_circles_follow_iceout_labels(self):
        levels = {f["properties"]["id"]: f["properties"]["severity"] for f in get_hazards(self.now)["features"]}
        self.assertEqual(levels, {"hz_1": "medium", "hz_2": "high", "hz_3": "low", "hz_4": "low", "hz_5": "high", "hz_6": "medium"})

    def test_active_report_remains_visible_at_five_hours_nineteen_minutes(self):
        # The eastern Doral example was incorrectly treated as Observed and expired at 3 h.
        from api.hazards import reports_to_hazards
        report = {"id": 42, "primary_location": "7843 NW 36th St, Doral",
                  "latitude": 25.81, "longitude": -80.32, "confidence_score": 0.65,
                  "source_count": 1, "iceout_category": 2,
                  "latest_report": (self.now - timedelta(hours=5, minutes=19)).isoformat()}
        features = reports_to_hazards([report], self.now)["features"]
        self.assertEqual(len(features), 1)
        self.assertEqual(features[0]["properties"]["severity"], "medium")
        self.assertTrue(features[0]["properties"]["reroute"])

    def test_collector_labels_match_source_categories(self):
        from collectors.iceout_collector import CATEGORY_LABELS
        self.assertEqual(CATEGORY_LABELS[1], "Observed")
        self.assertEqual(CATEGORY_LABELS[2], "Active")
