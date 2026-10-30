
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.simulation.config import SimulationConfigError
from app.simulation.corridor import (
    CorridorConfig,
    compare_multi_seed,
    compare_strategies,
    corridor_assumptions,
)
from app.scenario_routes import router as scenario_router

app = FastAPI(
    title="TrafficTwin API",
    description="Corridor spillback, signal coordination, and ambulance simulation",
    version="1.0.0",
)

# Allow the local Vite frontend to call this backend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class CorridorCompareRequest(BaseModel):
    config: dict[str, Any] = Field(default_factory=dict)
    include_history: bool = False


class MultiSeedRequest(BaseModel):
    config: dict[str, Any] = Field(default_factory=dict)
    seeds: list[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5])


@app.get("/")
def root():
    return {
        "name": "TrafficTwin API",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/corridor/assumptions")
def assumptions():
    return corridor_assumptions()


@app.post("/api/corridor/compare")
def compare_corridor(request: CorridorCompareRequest):
    try:
        config_data = dict(request.config)
        config_data["record_history"] = request.include_history

        config = CorridorConfig.from_dict(config_data)
        result = compare_strategies(config)

        return {
            "status": "success",
            "assumptions": corridor_assumptions(),
            "comparison": result,
        }

    except SimulationConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/corridor/multi-seed")
def compare_corridor_multi_seed(request: MultiSeedRequest):
    try:
        config_data = dict(request.config)
        config_data["record_history"] = False

        config = CorridorConfig.from_dict(config_data)

        result = compare_multi_seed(config, request.seeds)

        return {
            "status": "success",
            "assumptions": corridor_assumptions(),
            "comparison": result,
        }

    except SimulationConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
app.include_router(scenario_router)
