"""Local route server. Start: uv run uvicorn api.main:app --reload --port 8000."""

from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from api.routing import ROOT, build_routes, load_demo_hazards

load_dotenv(ROOT / ".env")
app = FastAPI(
    title="Vecino route demo",
    description="Uses one synthetic report until Person 1's reports are connected. Routes are not a safety guarantee.",
    swagger_ui_parameters={"persistAuthorization": False},
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lng: float = Field(ge=-180, le=180, allow_inf_nan=False)


class RouteRequest(BaseModel):
    origin: Point
    destination: Point
    profile: Literal["driving-car", "foot-walking", "cycling-regular"] = "driving-car"
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


@app.post("/route", summary="Get two routes using the synthetic demo report")
async def route(trip: RouteRequest):
    try:
        hazards = load_demo_hazards()
        return await build_routes(
            [trip.origin.lng, trip.origin.lat],
            [trip.destination.lng, trip.destination.lat],
            trip.profile, hazards,
        )
    except httpx.TimeoutException:
        raise HTTPException(504, "Directions took too long. Please retry.") from None
    except httpx.HTTPStatusError:
        raise HTTPException(502, "Directions service could not complete this trip. Check your key or try another trip.") from None
    except httpx.RequestError:
        raise HTTPException(503, "Directions service is unavailable. Please retry.") from None
    except (ValueError, KeyError, IndexError, OSError):
        raise HTTPException(503, "Route unavailable. Check demo settings, seed data, and the requested trip.") from None
