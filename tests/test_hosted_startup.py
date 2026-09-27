import asyncio
import os
import sqlite3
import sys
import threading
from unittest.mock import patch

from scripts.start_hosted import initialize_database, run_services


def test_database_initialized_before_api_and_existing_reports_preserved(tmp_path):
    path = tmp_path / "disk" / "reports.db"
    with patch.dict(os.environ, {"DB_PATH": str(path), "LOCALE": "miami"}):
        asyncio.run(initialize_database())
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM clusters").fetchone()[0] == 0
            db.execute("CREATE TABLE preservation_check (value TEXT)")
            db.execute("INSERT INTO preservation_check VALUES ('keep')")
        asyncio.run(initialize_database())
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT value FROM preservation_check").fetchone()[0] == "keep"


def test_child_failure_stops_other_process():
    from subprocess import Popen
    children = []

    def launch(*args, **kwargs):
        child = Popen(*args, **kwargs)
        children.append(child)
        return child

    with patch("scripts.start_hosted.subprocess.Popen", side_effect=launch):
        code = run_services([
            [sys.executable, "-c", "raise SystemExit(7)"],
            [sys.executable, "-c", "import time; time.sleep(60)"],
        ], threading.Event(), os.environ.copy())
    assert code == 7
    assert all(child.poll() is not None for child in children)


def test_requested_shutdown_stops_children():
    stop = threading.Event()
    stop.set()
    assert run_services([[sys.executable, "-c", "import time; time.sleep(60)"]],
                        stop, os.environ.copy()) == 0
