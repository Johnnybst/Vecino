"""/route refuses trips that start or end outside Miami-Dade (NEWAGENTS.md 4b)."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)
MIAMI = {"lat": 25.7617, "lng": -80.1918}
FORT_LAUDERDALE = {"lat": 26.1224, "lng": -80.1373}


def test_start_outside_miami_dade_is_refused_without_calling_routes():
    with patch("api.main.build_routes", new=AsyncMock()) as build:
        response = client.post("/route", json={"origin": FORT_LAUDERDALE, "destination": MIAMI})
    assert response.status_code == 422
    assert response.json() == {"detail": "outside_area"}
    build.assert_not_called()


def test_end_outside_miami_dade_is_refused():
    response = client.post("/route", json={"origin": MIAMI, "destination": FORT_LAUDERDALE})
    assert response.status_code == 422
    assert response.json() == {"detail": "outside_area"}
