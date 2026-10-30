"""Deterministic, time-stepped four-way intersection simulator.

Per step (1 s), in this order:
  1. Read the signal state for time t from the fixed-time controller.
  2. Add this step's arrivals to each approach queue, stamped with arrival time t.
  3. If the approach is GREEN, add discharge credit
     (lane_count * dt / DISCHARGE_HEADWAY_S * capacity_factor) and release whole
     vehicles from the front of the queue (FIFO). Departure time is t, so a
     vehicle that arrives on green to an empty queue has zero waiting delay.
     Unused credit is cleared when the queue empties or the signal is not green.
  4. Record queue lengths, spillback and (every ``history_interval_s``) a
     history frame for animation.

Vehicles are counted as completed only when they depart in step 3.
See ``config.py`` for the full list of modelling assumptions.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Sequence

import numpy as np

from .config import (
    DIRECTIONS,
    DISCHARGE_HEADWAY_S,
    TIME_STEP_S,
    Direction,
    SimulationConfig,
    model_assumptions,
)
from .metrics import MetricsCollector
from .signals import SignalController, check_no_conflict

_EPS = 1e-9


@dataclass
class SimulationResult:
    config: SimulationConfig
    summary: dict[str, Any]
    history: list[dict[str, Any]]
    signal_plan: list[dict[str, Any]]
    capacity: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "config": self.config.to_dict(),
            "assumptions": model_assumptions(),
            "signal_plan": self.signal_plan,
            "capacity": self.capacity,
            "summary": self.summary,
            "history": self.history,
        }


def generate_arrivals(config: SimulationConfig) -> dict[Direction, np.ndarray]:
    """Reproducible Poisson arrival counts per step for each approach.

    One generator seeded with ``config.seed`` draws all four approaches in a
    fixed order, so identical configs give identical arrivals.
    """
    rng = np.random.default_rng(config.seed)
    n_steps = config.duration_s // TIME_STEP_S
    arrivals: dict[Direction, np.ndarray] = {}
    for d in DIRECTIONS:
        lam = config.effective_rate_vph(d) / 3600.0 * TIME_STEP_S
        arrivals[d] = rng.poisson(lam, size=n_steps).astype(np.int64)
    return arrivals


def _normalise_arrivals(
    arrival_counts: Mapping[Any, Sequence[int]], n_steps: int
) -> dict[Direction, np.ndarray]:
    out = {d: np.zeros(n_steps, dtype=np.int64) for d in DIRECTIONS}
    for key, counts in arrival_counts.items():
        d = Direction.parse(key)
        arr = np.asarray(counts, dtype=np.int64)
        if arr.ndim != 1 or len(arr) > n_steps or (arr < 0).any():
            raise ValueError(f"Invalid arrival schedule for {d.value}.")
        out[d][: len(arr)] = arr
    return out


def run_simulation(
    config: SimulationConfig,
    arrival_counts: Optional[Mapping[Any, Sequence[int]]] = None,
) -> SimulationResult:
    """Run the simulation.

    ``arrival_counts`` optionally overrides the random arrivals with an exact
    per-step schedule ({direction: [count at t=0, t=1, ...]}); used by tests
    and for replaying recorded demand.
    """
    dt = TIME_STEP_S
    n_steps = config.duration_s // dt
    controller = SignalController(config)
    arrivals = (generate_arrivals(config) if arrival_counts is None
                else _normalise_arrivals(arrival_counts, n_steps))

    queues: dict[Direction, deque[int]] = {d: deque() for d in DIRECTIONS}
    credit = {d: 0.0 for d in DIRECTIONS}
    credit_per_step = {d: config.lane_count * dt / DISCHARGE_HEADWAY_S * config.capacity_factor(d)
                       for d in DIRECTIONS}
    storage = config.queue_storage_per_approach
    metrics = MetricsCollector()
    cumulative_departures = {d: 0 for d in DIRECTIONS}

    history: list[dict[str, Any]] = []
    bucket_arrivals = {d: 0 for d in DIRECTIONS}
    bucket_departures = {d: 0 for d in DIRECTIONS}
    interval = config.history_interval_s

    for step in range(n_steps):
        t = step * dt
        signal = controller.state_at(t)
        check_no_conflict(signal.lights)  # defensive: never run with conflicting greens

        for d in DIRECTIONS:
            stats = metrics.approaches[d]
            q = queues[d]

            n_arr = int(arrivals[d][step])
            if n_arr:
                q.extend([t] * n_arr)
                stats.arrivals += n_arr
                bucket_arrivals[d] += n_arr

            if signal.is_green(d) and credit_per_step[d] > 0:
                credit[d] += credit_per_step[d]
                n_dep = min(int(credit[d] + _EPS), len(q))
                for _ in range(n_dep):
                    stats.record_departure(t - q.popleft())
                credit[d] -= n_dep
                if not q:
                    credit[d] = 0.0  # no banking capacity while the queue is empty
                cumulative_departures[d] += n_dep
                bucket_departures[d] += n_dep
            else:
                credit[d] = 0.0

            stats.record_queue(len(q), storage, dt)

        is_last = step == n_steps - 1
        if (step + 1) % interval == 0 or is_last:
            history.append({
                "t": t,
                "phase": signal.phase.value,
                "phase_remaining_s": signal.phase_remaining_s,
                "lights": signal.lights_dict(),
                "queues": {d.value: len(queues[d]) for d in DIRECTIONS},
                "arrivals": dict((d.value, bucket_arrivals[d]) for d in DIRECTIONS),
                "departures": dict((d.value, bucket_departures[d]) for d in DIRECTIONS),
                "cumulative_departures": {d.value: cumulative_departures[d] for d in DIRECTIONS},
            })
            bucket_arrivals = {d: 0 for d in DIRECTIONS}
            bucket_departures = {d: 0 for d in DIRECTIONS}

    end_time = n_steps * dt
    final_queues = {d: len(queues[d]) for d in DIRECTIONS}
    waiting_ages = [end_time - a for d in DIRECTIONS for a in queues[d]]
    summary = metrics.summary(final_queues, waiting_ages, end_time)

    capacity = {
        "discharge_headway_s": DISCHARGE_HEADWAY_S,
        "queue_storage_per_approach": storage,
        "cycle_length_s": controller.cycle_length_s,
        "per_approach": {
            d.value: {
                "demand_vph": round(config.effective_rate_vph(d), 3),
                "saturation_flow_vph": round(config.saturation_flow_vph(d), 3),
                "capacity_vph": round(config.approach_capacity_vph(d), 3),
                "blocked": d == config.blocked_approach,
            }
            for d in DIRECTIONS
        },
    }

    return SimulationResult(
        config=config,
        summary=summary,
        history=history,
        signal_plan=controller.plan_dict(),
        capacity=capacity,
    )


def simulate(params: Mapping[str, Any]) -> dict[str, Any]:
    """Convenience entry point: validate a plain dict and return a JSON-ready dict."""
    return run_simulation(SimulationConfig.from_dict(params)).to_dict()
