"""Scenario presets for the corridor model.

Each preset is a set of real CorridorConfig settings. Choosing several presets
combines them (applied in the fixed order of ``SCENARIOS``), then any custom
values typed by the user are applied last. The merged settings are validated
by CorridorConfig, so a bad combination is rejected with a clear message.

"normal" and "peak_hour" both set the traffic level, so only one may be chosen.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional, Sequence

from .config import SimulationConfigError
from .corridor import (
    CorridorConfig,
    compare_multi_seed,
    compare_strategies,
    corridor_assumptions,
    variant_name,
)

# Starting point for every scenario (matches the dashboard's original defaults,
# but with no ambulance unless the "ambulance" scenario is chosen).
BASE_CONFIG: dict[str, Any] = {
    "main_vph": 900, "side_vph": 300, "main_green_s": 30, "side_green_s": 25,
    "yellow_s": 3, "all_red_s": 2, "min_green_s": 7, "main_lanes": 2, "side_lanes": 1,
    "link_travel_s": 30, "link_storage_veh": 20, "duration_min": 30,
    "traffic_multiplier": 1.0, "seed": 42, "ambulance_request_s": None,
    "ambulance_entry_junction": 0, "gate_threshold": 0.9, "flush_threshold": 0.6,
    "max_extension_s": 20,
}

SCENARIOS: dict[str, dict[str, Any]] = {
    "normal": {
        "label": "Normal traffic",
        "description": "Moderate, steady traffic on all roads.",
        "settings": {"main_vph": 600, "side_vph": 200},
    },
    "peak_hour": {
        "label": "Peak hour",
        "description": "Heavy, steady traffic on all roads.",
        "settings": {"main_vph": 1000, "side_vph": 320},
    },
    "surge": {
        "label": "Sudden traffic surge",
        "description": "Twice as many cars arrive between 5 and 15 minutes.",
        "settings": {"surge_start_s": 300, "surge_end_s": 900, "surge_multiplier": 2.0},
    },
    "blocked_lane": {
        "label": "Blocked lane",
        "description": "One main-road lane closed just past junction J1 from 6 to 18 minutes.",
        "settings": {"closure_junction": 1, "closure_start_s": 360, "closure_end_s": 1080,
                     "closure_lanes_closed": 1},
    },
    "spillback": {
        "label": "Spillback",
        "description": "Short roads (8 cars) and a slow last junction, so queues back up.",
        "settings": {"link_storage_veh": 8, "main_green_s": [30, 30, 20],
                     "side_green_s": [25, 25, 35]},
    },
    "ambulance": {
        "label": "Ambulance priority",
        "description": "An ambulance enters at J0 after 10 minutes.",
        "settings": {"ambulance_request_s": 600, "ambulance_entry_junction": 0},
    },
}

TRAFFIC_LEVELS = ("normal", "peak_hour")
VARIANTS: dict[str, tuple[str, bool]] = {
    variant_name("fixed_time", False): ("fixed_time", False),
    variant_name("fixed_time", True): ("fixed_time", True),
    variant_name("coordinated", True): ("coordinated", True),
}

# Settings the user may change from the dashboard.
EDITABLE_FIELDS = frozenset({
    "main_vph", "side_vph", "traffic_multiplier", "duration_min", "seed",
    "ambulance_request_s", "ambulance_entry_junction",
    "closure_junction", "closure_start_s", "closure_end_s", "closure_lanes_closed",
    "surge_start_s", "surge_end_s", "surge_multiplier", "link_storage_veh",
})


def list_scenarios() -> dict[str, Any]:
    return {
        "base": BASE_CONFIG,
        "scenarios": {k: dict(v) for k, v in SCENARIOS.items()},
        "traffic_levels": list(TRAFFIC_LEVELS),
        "variants": list(VARIANTS),
        "editable_fields": sorted(EDITABLE_FIELDS),
    }


def build_config(scenarios: Sequence[str],
                 overrides: Optional[Mapping[str, Any]] = None) -> CorridorConfig:
    chosen = list(dict.fromkeys(scenarios))  # remove duplicates, keep order
    unknown = [s for s in chosen if s not in SCENARIOS]
    if unknown:
        raise SimulationConfigError(f"Unknown scenario(s): {unknown}.")
    if sum(s in TRAFFIC_LEVELS for s in chosen) > 1:
        raise SimulationConfigError("Choose only one of 'normal' and 'peak_hour'.")
    settings = dict(BASE_CONFIG)
    for key in SCENARIOS:                       # fixed order, so results never depend on click order
        if key in chosen:
            settings.update(SCENARIOS[key]["settings"])
    overrides = dict(overrides or {})
    bad = set(overrides) - EDITABLE_FIELDS
    if bad:
        raise SimulationConfigError(f"These settings cannot be changed here: {sorted(bad)}.")
    # Empty form boxes arrive as None/""; ignore them so the preset value is kept,
    # except where None has a meaning (no ambulance / closure until the end).
    for k, v in overrides.items():
        if v == "":
            continue
        if v is None and k not in ("ambulance_request_s", "closure_end_s"):
            continue
        settings[k] = v
    settings["record_history"] = False
    return CorridorConfig.from_dict(settings)


def _downsample(history: list[dict[str, Any]], step: int) -> list[dict[str, Any]]:
    if step <= 1:
        return history
    return [f for i, f in enumerate(history) if i % step == 0 or i == len(history) - 1]


def run_scenario(scenarios: Sequence[str], overrides: Optional[Mapping[str, Any]] = None,
                 variants: Optional[Sequence[str]] = None, include_history: bool = True,
                 history_step_s: int = 1) -> dict[str, Any]:
    """Build the config, run the chosen strategies on one shared demand, return JSON-ready data."""
    if not scenarios:
        raise SimulationConfigError("Choose at least one scenario.")
    names = list(variants) if variants else list(VARIANTS)
    unknown = [v for v in names if v not in VARIANTS]
    if unknown or not names:
        raise SimulationConfigError(f"Unknown strategy name(s): {unknown}. Use {list(VARIANTS)}.")
    if not isinstance(history_step_s, int) or not 1 <= history_step_s <= 60:
        raise SimulationConfigError("history_step_s must be a whole number from 1 to 60.")
    config = build_config(scenarios, overrides)
    if include_history:
        config = CorridorConfig.from_dict(config.to_dict() | {"record_history": True})
    comparison = compare_strategies(config, [VARIANTS[v] for v in names])
    for run in comparison["runs"].values():
        run["history"] = _downsample(run["history"], history_step_s) if include_history else []
    return {
        "scenarios": [s for s in SCENARIOS if s in scenarios],
        "config": config.to_dict(),
        "assumptions": corridor_assumptions(),
        "history_step_s": history_step_s if include_history else None,
        "comparison": comparison,
    }


MAX_CHECK_SEEDS = 10


def run_scenario_multi_seed(scenarios: Sequence[str],
                            overrides: Optional[Mapping[str, Any]] = None,
                            variants: Optional[Sequence[str]] = None,
                            n_seeds: int = 5) -> dict[str, Any]:
    """Repeat the chosen scenario with several seeds (seed, seed+1, ...) to show the
    comparison is not a one-seed accident. Each seed's traffic is shared by every
    strategy. Also counts, per metric, how many seeds each strategy was best in."""
    if not scenarios:
        raise SimulationConfigError("Choose at least one scenario.")
    names = list(variants) if variants else list(VARIANTS)
    unknown = [v for v in names if v not in VARIANTS]
    if unknown or not names:
        raise SimulationConfigError(f"Unknown strategy name(s): {unknown}. Use {list(VARIANTS)}.")
    if isinstance(n_seeds, bool) or not isinstance(n_seeds, int) or not 2 <= n_seeds <= MAX_CHECK_SEEDS:
        raise SimulationConfigError(f"n_seeds must be a whole number from 2 to {MAX_CHECK_SEEDS}.")
    config = build_config(scenarios, overrides)
    seeds = [(config.seed + i) % (2**32) for i in range(n_seeds)]
    result = compare_multi_seed(config, seeds, [VARIANTS[v] for v in names])

    # lower is better for these, higher is better for completed_vehicles
    lower = ("average_delay_s", "spillback_blocked_seconds", "ambulance_travel_time_s")
    wins: dict[str, dict[str, int]] = {n: {m: 0 for m in ("completed_vehicles",) + lower} for n in names}
    for i in range(n_seeds):
        for metric in wins[names[0]]:
            vals = {n: result["per_seed"][n][i][metric] for n in names}
            vals = {n: v for n, v in vals.items() if v is not None}
            if len(vals) < 2:
                continue
            best = (max if metric == "completed_vehicles" else min)(vals.values())
            for n, v in vals.items():
                if v == best:
                    wins[n][metric] += 1
    result["wins"] = wins
    result["config"] = config.to_dict()
    return result
