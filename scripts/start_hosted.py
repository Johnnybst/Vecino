"""Run the collector and API together so both can access one Render disk."""

import asyncio
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading


async def initialize_database():
    from config import load_config
    from storage.database import Database

    config = load_config()
    Path(config.db_path).parent.mkdir(parents=True, exist_ok=True)
    db = Database(config)
    try:
        await db.connect()
    finally:
        await db.close()


def run_services(commands, stop, env):
    """Exit if either child dies; terminate both process groups on shutdown."""
    children = []
    try:
        for command in commands:
            children.append(subprocess.Popen(command, env=env, start_new_session=True))
        while not stop.wait(0.2):
            for child in children:
                code = child.poll()
                if code is not None:
                    print(f"Hosted process exited (status {code}); stopping service.", flush=True)
                    return code or 1
        return 0
    finally:
        for child in children:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        for child in children:
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                pass
            # Also clean up any Chromium descendants left after their parent exits.
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()


def main():
    os.chdir(Path(__file__).resolve().parent.parent)
    # This hosted app collects public reports but never sends Discord messages.
    os.environ["DRY_RUN"] = "true"
    os.environ["DISCORD_BOT_TOKEN"] = ""
    os.environ["DISCORD_WEBHOOK_URL"] = ""
    os.environ.setdefault("LOCALE", "miami")
    port = int(os.environ.get("PORT", "8000"))
    if not 1 <= port <= 65535:
        raise ValueError("PORT must be between 1 and 65535")
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    asyncio.run(initialize_database())
    commands = [
        [sys.executable, "main.py", "--dry-run"],
        [sys.executable, "-m", "uvicorn", "api.main:app", "--host", "0.0.0.0",
         "--port", str(port), "--no-access-log"],
    ]
    return run_services(commands, stop, os.environ.copy())


if __name__ == "__main__":
    sys.exit(main())
