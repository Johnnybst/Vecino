"""Local route server. Start: uv run uvicorn api.main:app --reload --port 8000."""

from datetime import datetime
import os
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from api.hazards import get_hazards
from api.incidents import get_incidents, inside_miami_dade
from api.routing import ROOT, build_routes, load_demo_hazards

load_dotenv(ROOT / ".env")
app = FastAPI(
    title="Vecino routes",
    description="Uses demo or live reports from the shared hazards function. Routes are not a safety guarantee.",
    swagger_ui_parameters={"persistAuthorization": False},
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip().rstrip("/")
        for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lng: float = Field(ge=-180, le=180, allow_inf_nan=False)


class RouteRequest(BaseModel):
    origin: Point
    destination: Point
    profile: Literal["driving-car", "foot-walking", "cycling-regular"] = "driving-car"
    # Language for turn-by-turn instructions only (ht falls back to English).
    language: Literal["en", "es", "ht"] = "en"
    model_config = ConfigDict(json_schema_extra={"example": {
        "origin": {"lat": 25.757, "lng": -80.374},
        "destination": {"lat": 25.766, "lng": -80.219},
        "profile": "driving-car",
    }})


@app.middleware("http")
async def no_cache(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(RequestValidationError)
async def invalid_request(request, exc):
    # Do not echo submitted coordinates in error responses.
    return JSONResponse(status_code=422, content={
        "detail": "Provide valid origin/destination coordinates and a drive, walk, or bike profile."
    })


@app.post("/route", summary="Get two routes using the shared reports")
async def route(trip: RouteRequest):
    # Miami-Dade only (NEWAGENTS.md 4b). The map shows "Vecino covers Miami-Dade only."
    if not all(inside_miami_dade(p.lat, p.lng) for p in (trip.origin, trip.destination)):
        raise HTTPException(422, "outside_area")
    try:
        hazards = load_demo_hazards()
        return await build_routes(
            [trip.origin.lng, trip.origin.lat],
            [trip.destination.lng, trip.destination.lat],
            trip.profile, hazards, language=trip.language,
        )
    except httpx.TimeoutException:
        raise HTTPException(504, "Directions took too long. Please retry.") from None
    except httpx.HTTPStatusError:
        raise HTTPException(502, "Directions service could not complete this trip. Check your key or try another trip.") from None
    except httpx.RequestError:
        raise HTTPException(503, "Directions service is unavailable. Please retry.") from None
    except (ValueError, KeyError, IndexError, OSError):
        raise HTTPException(503, "Route unavailable. Check demo settings, seed data, and the requested trip.") from None
@app.get("/hazards")
def hazards(at: datetime | None = None):
    if at is not None and at.tzinfo is None:
        raise HTTPException(
            status_code=400,
            detail="Include a timezone in 'at', such as Z for UTC.",
        )

    try:
        return get_hazards(at=at)
    except (OSError, ValueError, KeyError):
        raise HTTPException(503, "Reports unavailable. Check the report source and database settings.") from None


@app.get("/incidents", summary="Live crashes and closures in Miami-Dade (map only, not avoided)")
def incidents():
    return get_incidents()

#this is a line 
#this is another line btw
