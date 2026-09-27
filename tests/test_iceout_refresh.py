import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import msgpack

from api.hazards import get_hazards
from collectors.iceout_collector import IceoutCollector
from storage.database import Database


def test_repeated_collection_refreshes_category_without_duplicate_or_new_age(tmp_path):
    async def run():
        now = datetime.now(timezone.utc)
        stamp = (now - timedelta(minutes=30)).isoformat()
        config = SimpleNamespace(db_path=str(tmp_path / 'reports.db'),
                                 locale=SimpleNamespace(centers=[(25.8, -80.3, 60)], geo_city_names=['Doral']))
        collector = IceoutCollector(config, asyncio.Queue())
        item = {'id': 123, 'category_enum': 2, 'status': 0,
                'incident_time': stamp, 'created_at': stamp,
                'location_description': 'Doral',
                'location': {'coordinates': [-80.3, 25.8]}}
        collector._ensure_browser = AsyncMock(return_value=True)
        collector._navigate_and_fetch = AsyncMock()
        db = Database(config)
        await db.connect()
        try:
            row_id = None
            for category, expected in [(2, 'medium'), (1, 'low'), (2, 'medium')]:
                item['category_enum'] = category
                collector._navigate_and_fetch.return_value = msgpack.packb([item], use_bin_type=True)
                reports = await collector.collect()
                assert len(reports) == 1  # Previously seen IDs must still reach storage.
                result = await db.insert_raw_report(reports[0])
                if row_id is None:
                    row_id = result
                    await db._db.execute('''INSERT INTO clusters
                        (id, primary_location, latitude, longitude, confidence_score, source_count,
                         unique_source_types, earliest_report, latest_report)
                        VALUES (1, 'Doral', 25.8, -80.3, 0.65, 1, 1, ?, ?)''', (stamp, stamp))
                    await db._db.execute('UPDATE raw_reports SET cluster_id=1, notified=1 WHERE id=?', (row_id,))
                    await db._db.commit()
                else:
                    assert result is None  # Caller must not rerun correlation or notification.
                with patch.dict('os.environ', {'DB_PATH': config.db_path, 'DEMO_MODE': 'false'}):
                    features = get_hazards(now)['features']
                assert len(features) == 1
                assert features[0]['properties']['severity'] == expected
                assert features[0]['properties']['reroute'] == (expected == 'medium')
                rows = await (await db._db.execute('SELECT * FROM raw_reports')).fetchall()
                assert len(rows) == 1
                assert rows[0]['id'] == row_id
                assert rows[0]['cluster_id'] == 1
                assert rows[0]['notified'] == 1
                assert rows[0]['timestamp'] == stamp
                assert json.loads(rows[0]['raw_metadata'])['category_enum'] == category
                cluster = await (await db._db.execute('SELECT * FROM clusters')).fetchone()
                assert cluster['source_count'] == 1
                assert cluster['latest_report'] == stamp
        finally:
            await db.close()
    asyncio.run(run())
