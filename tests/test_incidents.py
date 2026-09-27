"""Offline checks for api/incidents.py: no internet or TomTom key needed."""

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from api import incidents

NOW = datetime(2026, 9, 27, 16, 30, tzinfo=timezone.utc)  # 12:30 PM in Miami
REAL_CLIENT = httpx.Client


def fake_client(tomtom_json=None, fhp_html=""):
    def handler(request):
        if "tomtom" in request.url.host:
            return httpx.Response(200, json=tomtom_json or {"incidents": []})
        return httpx.Response(200, text=fhp_html)
    return REAL_CLIENT(transport=httpx.MockTransport(handler))


def tomtom_incident(category, started, lat=25.77, lng=-80.2):
    return {"geometry": {"type": "LineString", "coordinates": [[lng, lat], [lng + 0.001, lat]]},
            "properties": {"id": f"x{category}{started}", "iconCategory": category,
                           "startTime": started, "from": "A St", "to": "B St",
                           "events": [{"description": "Closed"}]}}


def fhp_row(number, kind, reported, county, notes, lat, lng):
    cells = [kind, reported, "", "", county, "I-95 SB x[NW 79TH ST] [MIAMI]", notes, lat, lng]
    return (f'<tr id="gvCAD_DXDataRow{number}" class="r">'
            + "".join(f"<td>{c}</td>" for c in cells) + "</tr>")


def test_tomtom_keeps_crashes_and_fresh_closures_only(monkeypatch):
    monkeypatch.setenv("TOMTOM_API_KEY", "test")
    fresh = (NOW - timedelta(hours=2)).isoformat()
    old = (NOW - timedelta(days=30)).isoformat()
    data = {"incidents": [
        tomtom_incident(1, old),             # crash: kept even if old
        tomtom_incident(8, fresh, lat=25.80),  # new closure: kept
        tomtom_incident(8, old, lat=25.85),    # month-old construction: dropped
        tomtom_incident(6, fresh, lat=25.70),  # jam: dropped
        tomtom_incident(1, fresh, lat=27.0),   # outside Miami-Dade: dropped
    ]}
    found = incidents.from_tomtom(fake_client(tomtom_json=data), NOW)
    assert sorted(f["properties"]["type"] for f in found) == ["crash", "road_closed"]


def test_tomtom_without_key_is_skipped(monkeypatch):
    monkeypatch.delenv("TOMTOM_API_KEY", raising=False)
    with pytest.raises(ValueError):
        incidents.from_tomtom(fake_client(), NOW)


def test_fhp_keeps_recent_open_miami_dade_crashes():
    page = "".join([
        fhp_row(0, "Vehicle Crash", "09/27/2026 12:10:00", "MIAMI-DADE", "LEFT LANE", "25.84", "-80.20"),
        fhp_row(1, "Vehicle Crash", "09/27/2026 12:15:00", "MIAMI-DADE", "ROAD CLEAR", "25.85", "-80.20"),
        fhp_row(2, "Vehicle Crash", "04/01/2026 12:41:33", "MIAMI-DADE", "", "25.86", "-80.20"),
        fhp_row(3, "Vehicle Crash", "09/27/2026 12:20:00", "BROWARD", "", "26.10", "-80.20"),
        fhp_row(4, "Roadway Debris/Object", "09/27/2026 12:20:00", "MIAMI-DADE", "", "25.87", "-80.20"),
    ])
    found = incidents.from_fhp(fake_client(fhp_html=page), NOW)
    assert [f["properties"]["id"] for f in found] == ["fhp_0"]
    assert found[0]["properties"]["started_at"] == "2026-09-27T16:10:00Z"


def test_same_spot_is_listed_once(monkeypatch):
    monkeypatch.setenv("TOMTOM_API_KEY", "test")
    fresh = (NOW - timedelta(minutes=30)).isoformat()
    # Both directions of one closure, ~50 m apart.
    data = {"incidents": [tomtom_incident(8, fresh), tomtom_incident(8, fresh, lng=-80.2005)]}
    data["incidents"][1]["properties"]["id"] = "other-direction"
    monkeypatch.setattr(incidents, "_saved", {"at": 0.0, "data": None})
    monkeypatch.setattr(incidents.httpx, "Client", lambda **_: fake_client(tomtom_json=data))
    monkeypatch.setattr(incidents, "datetime", type("D", (datetime,), {"now": staticmethod(lambda tz=None: NOW)}))
    result = incidents.get_incidents()
    assert len(result["features"]) == 1
    assert result["properties"]["sources"] == ["tomtom", "fhp"]
