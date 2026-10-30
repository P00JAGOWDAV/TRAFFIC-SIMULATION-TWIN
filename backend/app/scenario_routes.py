"""Web routes for scenario presets.

Add to main.py (2 lines):
    from app.scenario_routes import router as scenario_router
    app.include_router(scenario_router)

Routes:
    GET  /api/scenarios       -> list of presets and default settings
    POST /api/scenarios/run   -> run the chosen scenarios and strategies
         body: {"scenarios": ["peak_hour", "ambulance"],
                "overrides": {"main_vph": 1100},           (optional)
                "variants": ["fixed_time", ...],             (optional, default all 3)
                "include_history": true,                     (optional, default true)
                "history_step_s": 2}                         (optional, default 2)
    POST /api/scenarios/multi-seed -> same body plus "n_seeds" (2-10); repeats the
         scenario with seeds seed, seed+1, ... and averages the results
"""

from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException

try:  # works when the app is started as "uvicorn app.main:app" from the backend folder
    from .simulation.config import SimulationConfigError
    from .simulation.scenarios import list_scenarios, run_scenario, run_scenario_multi_seed
except ImportError:  # works when started from inside the app folder
    from simulation.config import SimulationConfigError
    from simulation.scenarios import list_scenarios, run_scenario, run_scenario_multi_seed

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])


@router.get("")
def get_scenarios() -> Dict[str, Any]:
    return list_scenarios()


@router.post("/run")
def post_run_scenario(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    try:
        return run_scenario(
            scenarios=payload.get("scenarios") or [],
            overrides=payload.get("overrides") or {},
            variants=payload.get("variants") or None,
            include_history=bool(payload.get("include_history", True)),
            history_step_s=payload.get("history_step_s", 2),
        )
    except SimulationConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid request: {exc}") from exc


@router.post("/multi-seed")
def post_multi_seed(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    try:
        return run_scenario_multi_seed(
            scenarios=payload.get("scenarios") or [],
            overrides=payload.get("overrides") or {},
            variants=payload.get("variants") or None,
            n_seeds=payload.get("n_seeds", 5),
        )
    except SimulationConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid request: {exc}") from exc
