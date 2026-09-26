from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from api.hazards import get_demo_hazards

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/hazards")
def hazards(at: datetime | None = None):
    if at is not None and at.tzinfo is None:
        raise HTTPException(
            status_code=400,
            detail="Include a timezone in 'at', such as Z for UTC.",
        )

    return get_demo_hazards(at=at)