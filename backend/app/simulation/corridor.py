"""Corridor model for the "Spillback and the Ambulance" challenge.

A simplified, deterministic model of three signalised junctions (J0, J1, J2)
along one eastbound main road, joined by two roads (L0: J0->J1, L1: J1->J2).
It is an educational demonstration, NOT certified traffic-control software.

MODEL (all documented simplifications)
--------------------------------------
* 1-second time steps (``TIME_STEP_S``).
* Main-road traffic enters the corridor at J0's west approach and travels
  straight through all three junctions. Each junction also has North and
  South side-street approaches whose vehicles cross the main road and leave
  the model. No turning movements.
* Every queue is FIFO: no overtaking, the ambulance included. The ambulance
  can only pass a stop line once every vehicle ahead of it has discharged.
* Discharge happens only on green, at ``lanes * dt / DISCHARGE_HEADWAY_S``
  vehicles per second (2.0 s headway, as in the single-junction engine).
* Roads have a fixed travel time ``link_travel_s`` and a finite storage
  ``link_storage_veh``. A road's occupancy is the vehicles driving on it plus
  those queued at the downstream junction's main approach. A vehicle may only
  leave a junction onto a road whose occupancy is below storage. When a green
  main approach has a vehicle ready but the road ahead is full, that junction
  is BLOCKED BY SPILLBACK. A spillback event is counted at the onset of each
  blocked episode; blocked seconds are also reported.
* Junctions are processed downstream-first within a second, so space freed
  at a stop line can be used by the upstream junction in the same second.
* The entry queue at J0 and the side-street queues have unlimited storage.

SIGNAL CONTROL (one state machine per junction)
-----------------------------------------------
Cycle: NS_GREEN -> NS_YELLOW -> ALL_RED_1 -> EW_GREEN -> EW_YELLOW -> ALL_RED_2.
The main road is served by EW_GREEN. Yellow and all-red intervals are never
shortened or skipped, so every change between conflicting greens passes
through a full yellow and all-red clearance. Every green runs at least
``min_green_s`` before it can be ended.

Strategies:
* ``fixed_time`` - fixed main and side green durations per junction.
* ``coordinated`` - downstream-capacity aware:
  - GATING: a main green ends early (after min green) when the road ahead is
    at least ``gate_threshold`` full - pushing more cars into it only spreads
    the blockage, so the time goes to the side street instead.
  - FLUSHING: when the road arriving at a junction is at least
    ``flush_threshold`` full, that junction extends its main green by up to
    ``max_extension_s`` and trims its side green by up to the same amount
    (never below min green) to drain the road.

Ambulance pre-emption (optional per run):
* The ambulance appears at ``ambulance_request_s`` at the back of the main
  queue of junction ``ambulance_entry_junction`` and travels east to the end
  of the corridor.
* A junction receives a pre-emption request while the ambulance is queued at
  it, or is queued at / driving towards the junction immediately upstream
  (one-junction look-ahead, so the road ahead is flushed early).
* Under pre-emption: a main green is held; a side green ends as soon as it has
  run min green; the normal yellow and all-red clearance then runs; after
  ALL_RED_2 the controller returns straight to main green (skipping the side
  phase) - still only after a full clearance interval.
* RECOVERY: when the request ends (ambulance has passed), the main green ends
  at its normal duration (immediately if already exceeded and min green has
  run), the side street is served next, and normal control resumes. Recovery
  time is measured from release until the first main green that starts
  after a full side green, i.e. when the normal cycle sequence has resumed.

Fair comparison: ordinary arrivals are generated once from ``seed`` and the
same arrays and the same ambulance event are passed to every strategy.
"""

from __future__ import annotations

import math
import sys
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Mapping, Optional, Sequence

import numpy as np

from .config import (
    DISCHARGE_HEADWAY_S,
    MAX_ARRIVAL_RATE_VPH,
    MAX_DURATION_MIN,
    MAX_GREEN_S,
    MAX_LANES,
    MAX_TRAFFIC_MULTIPLIER,
    MIN_GREEN_S,
    MIN_LANES,
    TIME_STEP_S,
    Direction,
    SimulationConfigError,
    _check_int,
    _check_number,
)
from .metrics import ApproachStats
from .signals import Light, Phase, check_no_conflict

N_JUNCTIONS = 3
N_LINKS = N_JUNCTIONS - 1
SIDE_APPROACHES = (Direction.NORTH, Direction.SOUTH)
STRATEGIES = ("fixed_time", "coordinated")
DEFAULT_VARIANTS: tuple[tuple[str, bool], ...] = (
    ("fixed_time", False),
    ("fixed_time", True),
    ("coordinated", True),
)
MAX_SEEDS = 20
_EPS = 1e-9
_NO_LIMIT = sys.maxsize

_PHASE_LIGHTS: dict[Phase, tuple[Light, Light]] = {  # (NS light, EW light)
    Phase.NS_GREEN: (Light.GREEN, Light.RED),
    Phase.NS_YELLOW: (Light.YELLOW, Light.RED),
    Phase.ALL_RED_1: (Light.RED, Light.RED),
    Phase.EW_GREEN: (Light.RED, Light.GREEN),
    Phase.EW_YELLOW: (Light.RED, Light.YELLOW),
    Phase.ALL_RED_2: (Light.RED, Light.RED),
}
_NEXT_PHASE = {
    Phase.NS_GREEN: Phase.NS_YELLOW,
    Phase.NS_YELLOW: Phase.ALL_RED_1,
    Phase.ALL_RED_1: Phase.EW_GREEN,
    Phase.EW_GREEN: Phase.EW_YELLOW,
    Phase.EW_YELLOW: Phase.ALL_RED_2,
    Phase.ALL_RED_2: Phase.NS_GREEN,
}


def variant_name(strategy: str, preemption: bool) -> str:
    return f"{strategy}+preemption" if preemption else strategy


# =========================================================================== config
def _per_junction(name: str, value: Any, check) -> tuple:
    values = list(value) if isinstance(value, (list, tuple)) else [value] * N_JUNCTIONS
    if len(values) != N_JUNCTIONS:
        raise SimulationConfigError(f"{name} needs {N_JUNCTIONS} values (one per junction).")
    return tuple(check(f"{name}[{i}]", v) for i, v in enumerate(values))


@dataclass(frozen=True)
class CorridorConfig:
    main_vph: float = 900.0
    side_vph: Any = 300.0              # per side approach (N and S), scalar or 3 values
    main_green_s: Any = 30             # scalar or 3 values
    side_green_s: Any = 25
    yellow_s: int = 3
    all_red_s: int = 2
    min_green_s: int = 7
    main_lanes: int = 2
    side_lanes: int = 1
    link_travel_s: int = 20
    link_storage_veh: int = 30
    duration_min: float = 30.0
    traffic_multiplier: float = 1.0
    seed: int = 42
    ambulance_request_s: Optional[int] = 600
    ambulance_entry_junction: int = 0
    gate_threshold: float = 0.9
    flush_threshold: float = 0.6
    max_extension_s: int = 20
    record_history: bool = True

    def __post_init__(self) -> None:
        s = lambda k, v: object.__setattr__(self, k, v)  # noqa: E731 (frozen dataclass)
        rate = lambda n, v: _check_number(n, v, 0.0, MAX_ARRIVAL_RATE_VPH)  # noqa: E731
        green = lambda n, v: _check_int(n, v, MIN_GREEN_S, MAX_GREEN_S)  # noqa: E731
        s("main_vph", rate("main_vph", self.main_vph))
        s("side_vph", _per_junction("side_vph", self.side_vph, rate))
        s("main_green_s", _per_junction("main_green_s", self.main_green_s, green))
        s("side_green_s", _per_junction("side_green_s", self.side_green_s, green))
        s("yellow_s", _check_int("yellow_s", self.yellow_s, 2, 10))
        s("all_red_s", _check_int("all_red_s", self.all_red_s, 1, 10))
        s("min_green_s", _check_int("min_green_s", self.min_green_s, MIN_GREEN_S, MAX_GREEN_S))
        if self.min_green_s > min(self.main_green_s + self.side_green_s):
            raise SimulationConfigError("min_green_s cannot exceed any configured green time.")
        s("main_lanes", _check_int("main_lanes", self.main_lanes, MIN_LANES, MAX_LANES))
        s("side_lanes", _check_int("side_lanes", self.side_lanes, MIN_LANES, MAX_LANES))
        s("link_travel_s", _check_int("link_travel_s", self.link_travel_s, 1, 600))
        s("link_storage_veh", _check_int("link_storage_veh", self.link_storage_veh, 1, 1000))
        duration = _check_number("duration_min", self.duration_min, 0.0, MAX_DURATION_MIN)
        if duration * 60 < 1:
            raise SimulationConfigError("duration_min must be greater than zero.")
        s("duration_min", duration)
        s("traffic_multiplier", _check_number(
            "traffic_multiplier", self.traffic_multiplier, 0.0, MAX_TRAFFIC_MULTIPLIER))
        s("seed", _check_int("seed", self.seed, 0, 2**32 - 1))
        if self.ambulance_request_s is not None:
            s("ambulance_request_s", _check_int(
                "ambulance_request_s", self.ambulance_request_s, 0, self.duration_s - 1))
        s("ambulance_entry_junction", _check_int(
            "ambulance_entry_junction", self.ambulance_entry_junction, 0, N_JUNCTIONS - 1))
        s("gate_threshold", _check_number("gate_threshold", self.gate_threshold, 0.1, 1.0))
        s("flush_threshold", _check_number("flush_threshold", self.flush_threshold, 0.1, 1.0))
        s("max_extension_s", _check_int("max_extension_s", self.max_extension_s, 0, 120))
        if not isinstance(self.record_history, bool):
            raise SimulationConfigError("record_history must be true or false.")

    @property
    def duration_s(self) -> int:
        return int(round(self.duration_min * 60))

    @property
    def free_flow_through_s(self) -> int:
        return N_LINKS * self.link_travel_s

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "CorridorConfig":
        unknown = set(data) - set(cls.__dataclass_fields__)
        if unknown:
            raise SimulationConfigError(f"Unknown configuration field(s): {sorted(unknown)}.")
        return cls(**dict(data))

    def to_dict(self) -> dict[str, Any]:
        out = {k: getattr(self, k) for k in self.__dataclass_fields__}
        for k in ("side_vph", "main_green_s", "side_green_s"):
            out[k] = list(out[k])
        return out


# =========================================================================== demand
@dataclass(frozen=True)
class CorridorDemand:
    """Ordinary-traffic arrival counts per second. Shared by every strategy run."""

    main: np.ndarray                       # shape (n_steps,) entering J0 eastbound
    side: np.ndarray                       # shape (N_JUNCTIONS, 2, n_steps): [j][0]=N, [j][1]=S

    @property
    def n_steps(self) -> int:
        return int(self.main.shape[0])

    @property
    def total(self) -> int:
        return int(self.main.sum() + self.side.sum())


def generate_demand(config: CorridorConfig) -> CorridorDemand:
    """Reproducible Poisson arrivals; draw order is fixed so a seed gives one demand set."""
    rng = np.random.default_rng(config.seed)
    n = config.duration_s // TIME_STEP_S
    m = config.traffic_multiplier
    main = rng.poisson(config.main_vph * m / 3600.0 * TIME_STEP_S, size=n).astype(np.int64)
    side = np.zeros((N_JUNCTIONS, len(SIDE_APPROACHES), n), dtype=np.int64)
    for j in range(N_JUNCTIONS):
        for k in range(len(SIDE_APPROACHES)):
            side[j, k] = rng.poisson(config.side_vph[j] * m / 3600.0 * TIME_STEP_S, size=n)
    return CorridorDemand(main=main, side=side)


def demand_from_schedule(config: CorridorConfig, main: Sequence[int] = (),
                         side: Optional[Mapping[tuple[int, str], Sequence[int]]] = None
                         ) -> CorridorDemand:
    """Exact arrival schedule (used by tests). ``side`` keys are (junction, 'N'|'S')."""
    n = config.duration_s // TIME_STEP_S
    main_arr = np.zeros(n, dtype=np.int64)
    main_arr[: len(main)] = np.asarray(main, dtype=np.int64)
    side_arr = np.zeros((N_JUNCTIONS, len(SIDE_APPROACHES), n), dtype=np.int64)
    for (j, d), counts in (side or {}).items():
        k = SIDE_APPROACHES.index(Direction.parse(d))
        side_arr[j, k, : len(counts)] = np.asarray(counts, dtype=np.int64)
    if (main_arr < 0).any() or (side_arr < 0).any():
        raise ValueError("Arrival counts cannot be negative.")
    return CorridorDemand(main=main_arr, side=side_arr)


# =========================================================================== signal control
@dataclass
class JunctionController:
    """Per-junction phase state machine with strategy logic, pre-emption and recovery."""

    index: int
    main_green: int
    side_green: int
    yellow: int
    all_red: int
    min_green: int
    coordinated: bool
    gate_threshold: float
    flush_threshold: float
    max_extension: int
    phase: Phase = Phase.NS_GREEN
    elapsed: int = 0                       # whole seconds already spent in ``phase``
    mode: str = "normal"                   # normal | preempt | recovery
    preempt_start_s: Optional[int] = None
    release_s: Optional[int] = None
    recovery_end_s: Optional[int] = None
    _side_served_since_release: bool = False
    transitions: list = field(default_factory=list)  # (t, from_phase, to_phase)

    def lights(self) -> dict[Direction, Light]:
        ns, ew = _PHASE_LIGHTS[self.phase]
        return {Direction.NORTH: ns, Direction.SOUTH: ns, Direction.EAST: ew, Direction.WEST: ew}

    def main_is_green(self) -> bool:
        return self.phase == Phase.EW_GREEN

    def side_is_green(self) -> bool:
        return self.phase == Phase.NS_GREEN

    def _phase_should_end(self, preempt: bool, occ_down: float, occ_in: float) -> bool:
        e = self.elapsed
        if self.phase in (Phase.NS_YELLOW, Phase.EW_YELLOW):
            return e >= self.yellow
        if self.phase in (Phase.ALL_RED_1, Phase.ALL_RED_2):
            return e >= self.all_red
        if e < self.min_green:
            return False                                   # min green always honoured
        if self.phase == Phase.EW_GREEN:
            if preempt:
                return False                               # hold main green for the ambulance
            if self.coordinated and self.mode == "normal":
                if occ_down >= self.gate_threshold:
                    return True                            # gate: road ahead is full
                if occ_in >= self.flush_threshold:
                    return e >= self.main_green + self.max_extension  # flush
            return e >= self.main_green
        # NS_GREEN
        if preempt:
            return True                                    # truncate side green after min green
        if self.coordinated and self.mode == "normal" and occ_in >= self.flush_threshold:
            return e >= max(self.min_green, self.side_green - self.max_extension)
        return e >= self.side_green

    def begin_step(self, t: int, preempt: bool, occ_down: float, occ_in: float) -> None:
        if preempt and self.mode != "preempt":
            self.mode = "preempt"
            if self.preempt_start_s is None:
                self.preempt_start_s = t
        elif not preempt and self.mode == "preempt":
            self.mode = "recovery"
            self.release_s = t
            self._side_served_since_release = False

        if self._phase_should_end(preempt, occ_down, occ_in):
            nxt = _NEXT_PHASE[self.phase]
            if self.phase == Phase.ALL_RED_2 and preempt:
                nxt = Phase.EW_GREEN       # skip side phase; clearance interval already completed
            self.transitions.append((t, self.phase, nxt))
            self.phase, self.elapsed = nxt, 0
            if self.mode == "recovery":
                if nxt == Phase.NS_GREEN:
                    self._side_served_since_release = True
                elif nxt == Phase.EW_GREEN and self._side_served_since_release:
                    self.mode = "normal"
                    self.recovery_end_s = t
        check_no_conflict(self.lights())

    def end_step(self) -> None:
        self.elapsed += TIME_STEP_S

    @property
    def recovery_time_s(self) -> Optional[int]:
        if self.release_s is None or self.recovery_end_s is None:
            return None
        return self.recovery_end_s - self.release_s


# =========================================================================== simulation
@dataclass
class _Vehicle:
    entry_s: int
    ambulance: bool = False


def run_corridor(config: CorridorConfig, strategy: str = "fixed_time",
                 preemption: bool = True, demand: Optional[CorridorDemand] = None
                 ) -> dict[str, Any]:
    """Run one strategy. Pass a shared ``demand`` to compare strategies fairly."""
    if strategy not in STRATEGIES:
        raise SimulationConfigError(f"Unknown strategy {strategy!r}; expected one of {STRATEGIES}.")
    if demand is None:
        demand = generate_demand(config)
    n_steps = config.duration_s // TIME_STEP_S
    if demand.n_steps != n_steps:
        raise ValueError("Demand length does not match the simulation duration.")

    dt, T, storage = TIME_STEP_S, config.link_travel_s, config.link_storage_veh
    ctrls = [JunctionController(
        index=j, main_green=config.main_green_s[j], side_green=config.side_green_s[j],
        yellow=config.yellow_s, all_red=config.all_red_s, min_green=config.min_green_s,
        coordinated=strategy == "coordinated", gate_threshold=config.gate_threshold,
        flush_threshold=config.flush_threshold, max_extension=config.max_extension_s,
    ) for j in range(N_JUNCTIONS)]

    main_q: list[deque[_Vehicle]] = [deque() for _ in range(N_JUNCTIONS)]
    side_q: list[list[deque[_Vehicle]]] = [[deque(), deque()] for _ in range(N_JUNCTIONS)]
    links: list[deque[tuple[int, _Vehicle]]] = [deque() for _ in range(N_LINKS)]  # (ready_s, veh)
    main_credit = [0.0] * N_JUNCTIONS
    side_credit = [[0.0, 0.0] for _ in range(N_JUNCTIONS)]
    main_rate = config.main_lanes * dt / DISCHARGE_HEADWAY_S
    side_rate = config.side_lanes * dt / DISCHARGE_HEADWAY_S

    through = ApproachStats()                       # main-road vehicles: entry at J0 -> exit at J2
    main_stats = [ApproachStats() for _ in range(N_JUNCTIONS)]   # per-junction main queue maxima
    side_stats = [[ApproachStats(), ApproachStats()] for _ in range(N_JUNCTIONS)]
    max_link_occ = [0] * N_LINKS
    spill_events = [0] * N_LINKS
    spill_seconds = [0] * N_LINKS
    blocked_prev = [False] * N_LINKS

    amb: Optional[_Vehicle] = None
    amb_loc: Optional[tuple[str, int]] = None       # ("queue", j) | ("link", i) | ("done", -1)
    amb_exit_s: Optional[int] = None
    amb_trace: list[tuple[int, str, int]] = []
    history: list[dict[str, Any]] = []

    def occupancy(i: int) -> int:
        return len(links[i]) + len(main_q[i + 1])

    for step in range(n_steps):
        t = step * dt

        # 1. vehicles finishing a road join the downstream main queue (occupancy unchanged)
        for i in range(N_LINKS):
            while links[i] and links[i][0][0] <= t:
                _, veh = links[i].popleft()
                main_q[i + 1].append(veh)
                if veh.ambulance:
                    amb_loc = ("queue", i + 1)
                    amb_trace.append((t, "queue", i + 1))

        # 2. new arrivals (ordinary demand is identical across strategies)
        for _ in range(int(demand.main[step])):
            main_q[0].append(_Vehicle(t))
            through.arrivals += 1
        for j in range(N_JUNCTIONS):
            for k in range(2):
                for _ in range(int(demand.side[j, k, step])):
                    side_q[j][k].append(_Vehicle(t))
                    side_stats[j][k].arrivals += 1
        if config.ambulance_request_s is not None and t == config.ambulance_request_s:
            amb = _Vehicle(t, ambulance=True)
            main_q[config.ambulance_entry_junction].append(amb)
            amb_loc = ("queue", config.ambulance_entry_junction)
            amb_trace.append((t, "queue", config.ambulance_entry_junction))

        # 3. pre-emption requests (current junction + one-junction look-ahead)
        requests = [False] * N_JUNCTIONS
        if preemption and amb_loc is not None and amb_loc[0] != "done":
            kind, idx = amb_loc
            here = idx if kind == "queue" else idx + 1          # junction being approached
            requests[here] = True
            if kind == "queue" and here + 1 < N_JUNCTIONS:
                requests[here + 1] = True

        # 4. signal decisions
        for j, c in enumerate(ctrls):
            occ_down = occupancy(j) / storage if j < N_LINKS else 0.0
            occ_in = occupancy(j - 1) / storage if j > 0 else 0.0
            c.begin_step(t, requests[j], occ_down, occ_in)

        # 5. discharge, downstream junction first
        blocked_now = [False] * N_LINKS
        for j in reversed(range(N_JUNCTIONS)):
            c = ctrls[j]
            # side streets leave the model on departure
            for k in range(2):
                q = side_q[j][k]
                if c.side_is_green():
                    side_credit[j][k] += side_rate
                    n = min(int(side_credit[j][k] + _EPS), len(q))
                    for _ in range(n):
                        side_stats[j][k].record_departure(t - q.popleft().entry_s)
                    side_credit[j][k] -= n
                    if not q:
                        side_credit[j][k] = 0.0
                else:
                    side_credit[j][k] = 0.0
            # main road
            q = main_q[j]
            if not c.main_is_green():
                main_credit[j] = 0.0
                continue
            main_credit[j] += main_rate
            while q and main_credit[j] >= 1.0 - _EPS:
                if j < N_LINKS and occupancy(j) >= storage:
                    blocked_now[j] = True                    # spillback: road ahead is full
                    main_credit[j] = min(main_credit[j], max(1.0, main_rate))
                    break
                veh = q.popleft()
                main_credit[j] -= 1.0
                if j < N_LINKS:
                    links[j].append((t + T, veh))
                    if veh.ambulance:
                        amb_loc = ("link", j)
                        amb_trace.append((t, "link", j))
                elif veh.ambulance:
                    amb_loc, amb_exit_s = ("done", -1), t
                    amb_trace.append((t, "done", -1))
                else:
                    through.record_departure(t - veh.entry_s - config.free_flow_through_s)
            if not q:
                main_credit[j] = 0.0

        # 6. bookkeeping
        for i in range(N_LINKS):
            occ = occupancy(i)
            if occ > storage:  # pragma: no cover - guarded above; kept as an invariant check
                raise AssertionError(f"Road L{i} exceeded storage at t={t}")
            max_link_occ[i] = max(max_link_occ[i], occ)
            if blocked_now[i]:
                spill_seconds[i] += dt
                if not blocked_prev[i]:
                    spill_events[i] += 1
            blocked_prev[i] = blocked_now[i]
        for j in range(N_JUNCTIONS):
            main_stats[j].record_queue(sum(not v.ambulance for v in main_q[j]), _NO_LIMIT, dt)
            for k in range(2):
                side_stats[j][k].record_queue(len(side_q[j][k]), _NO_LIMIT, dt)

        if config.record_history:
            history.append({
                "t": t,
                "junctions": [{
                    "phase": c.phase.value, "mode": c.mode,
                    "lights": {d.value: l.value for d, l in c.lights().items()},
                    "queues": {"main": len(main_q[j]), "N": len(side_q[j][0]), "S": len(side_q[j][1])},
                } for j, c in enumerate(ctrls)],
                "links": [{"occupancy": occupancy(i), "moving": len(links[i]), "storage": storage,
                           "blocked": blocked_now[i]} for i in range(N_LINKS)],
                "ambulance": None if amb_loc is None else {"location": amb_loc[0], "index": amb_loc[1]},
            })

        for c in ctrls:
            c.end_step()

    # ---------------------------------------------------------------- summary
    end_s = n_steps * dt
    waiting_ordinary = (
        sum(sum(not v.ambulance for v in q) for q in main_q)
        + sum(sum(not v.ambulance for _, v in lk) for lk in links)
        + sum(len(q) for qs in side_q for q in qs)
    )
    waiting_ages = (
        [end_s - v.entry_s for q in main_q for v in q if not v.ambulance]
        + [end_s - v.entry_s for lk in links for _, v in lk if not v.ambulance]
        + [end_s - v.entry_s for qs in side_q for q in qs for v in q]
    )
    all_side = [s for row in side_stats for s in row]
    arrivals = through.arrivals + sum(s.arrivals for s in all_side)
    completed = through.completed + sum(s.completed for s in all_side)
    total_delay = through.total_delay_s + sum(s.total_delay_s for s in all_side)
    if arrivals != completed + waiting_ordinary:  # conservation invariant
        raise AssertionError("vehicle conservation violated")

    amb_summary: dict[str, Any] = {"requested": config.ambulance_request_s is not None}
    if amb_summary["requested"]:
        links_on_route = N_JUNCTIONS - 1 - config.ambulance_entry_junction
        free_flow = links_on_route * T
        travel = None if amb_exit_s is None else amb_exit_s - config.ambulance_request_s
        amb_summary.update({
            "request_s": config.ambulance_request_s,
            "entry_junction": config.ambulance_entry_junction,
            "completed": amb_exit_s is not None,
            "exit_s": amb_exit_s,
            "travel_time_s": travel,
            "free_flow_s": free_flow,
            "delay_s": None if travel is None else travel - free_flow,
            "trace": [{"t": a, "location": b, "index": c} for a, b, c in amb_trace],
        })

    recovery = [{
        "junction": c.index, "preempt_start_s": c.preempt_start_s, "release_s": c.release_s,
        "recovery_end_s": c.recovery_end_s, "recovery_time_s": c.recovery_time_s,
    } for c in ctrls]
    rec_times = [r["recovery_time_s"] for r in recovery if r["recovery_time_s"] is not None]
    hours = end_s / 3600.0

    return {
        "variant": variant_name(strategy, preemption),
        "strategy": strategy,
        "preemption": preemption,
        "seed": config.seed,
        "summary": {
            "total_arrivals": arrivals,
            "completed_vehicles": completed,
            "vehicles_still_in_corridor": waiting_ordinary,
            "throughput_vph": round(completed / hours, 3),
            "main_road_completed": through.completed,
            "average_delay_s": round(total_delay / completed, 3) if completed else 0.0,
            "average_delay_incl_waiting_s": (
                round((total_delay + sum(waiting_ages)) / (completed + waiting_ordinary), 3)
                if completed + waiting_ordinary else 0.0),
            "max_queues": [{"junction": j, "main": main_stats[j].max_queue,
                            "N": side_stats[j][0].max_queue, "S": side_stats[j][1].max_queue}
                           for j in range(N_JUNCTIONS)],
            "max_link_occupancy": max_link_occ,
            "link_storage_veh": storage,
            "spillback_events": sum(spill_events),
            "spillback_events_per_link": spill_events,
            "spillback_blocked_seconds": sum(spill_seconds),
            "spillback_blocked_seconds_per_link": spill_seconds,
            "ambulance": amb_summary,
            "recovery": recovery,
            "recovery_time_s": max(rec_times) if rec_times else None,
            "all_recovered": all(c.mode == "normal" for c in ctrls),
        },
        "transitions": [[{"t": a, "from": b.value, "to": c_.value} for a, b, c_ in c.transitions]
                        for c in ctrls],
        "history": history,
    }


# =========================================================================== comparisons
def compare_strategies(config: CorridorConfig,
                       variants: Sequence[tuple[str, bool]] = DEFAULT_VARIANTS
                       ) -> dict[str, Any]:
    """Run every variant on one shared demand set and the same ambulance event."""
    demand = generate_demand(config)
    runs = {variant_name(s, p): run_corridor(config, s, p, demand) for s, p in variants}
    return {
        "seed": config.seed,
        "ordinary_arrivals": demand.total,
        "results": {name: r["summary"] for name, r in runs.items()},
        "runs": runs,
    }


_KEY_METRICS = ("completed_vehicles", "throughput_vph", "average_delay_s",
                "spillback_events", "spillback_blocked_seconds")


def compare_multi_seed(config: CorridorConfig, seeds: Sequence[int],
                       variants: Sequence[tuple[str, bool]] = DEFAULT_VARIANTS
                       ) -> dict[str, Any]:
    """Compact comparison over several seeds; each seed's demand is shared by all variants."""
    seeds = list(seeds)
    if not 1 <= len(seeds) <= MAX_SEEDS:
        raise SimulationConfigError(f"Provide between 1 and {MAX_SEEDS} seeds.")
    if len(set(seeds)) != len(seeds):
        raise SimulationConfigError("Seeds must be unique.")
    base = config.to_dict() | {"record_history": False}
    per_seed: dict[str, list[dict[str, Any]]] = {variant_name(s, p): [] for s, p in variants}
    for seed in seeds:
        cfg = CorridorConfig.from_dict(base | {"seed": seed})
        demand = generate_demand(cfg)
        for s, p in variants:
            summ = run_corridor(cfg, s, p, demand)["summary"]
            row = {k: summ[k] for k in _KEY_METRICS}
            row["seed"] = seed
            row["max_main_queue"] = max(q["main"] for q in summ["max_queues"])
            row["ambulance_travel_time_s"] = summ["ambulance"].get("travel_time_s")
            row["recovery_time_s"] = summ["recovery_time_s"]
            per_seed[variant_name(s, p)].append(row)

    def mean(rows: list[dict[str, Any]], key: str) -> Optional[float]:
        vals = [r[key] for r in rows if r[key] is not None]
        return round(float(np.mean(vals)), 3) if vals else None

    metrics = _KEY_METRICS + ("max_main_queue", "ambulance_travel_time_s", "recovery_time_s")
    return {
        "seeds": seeds,
        "mean": {name: {k: mean(rows, k) for k in metrics} for name, rows in per_seed.items()},
        "ambulance_completed_runs": {
            name: sum(r["ambulance_travel_time_s"] is not None for r in rows)
            for name, rows in per_seed.items()},
        "per_seed": per_seed,
    }


def corridor_assumptions() -> dict[str, Any]:
    return {
        "disclaimer": ("Simplified educational corridor model. Not a certified traffic-engineering, "
                       "signal-control or emergency-vehicle pre-emption system."),
        "time_step_s": TIME_STEP_S,
        "junctions": N_JUNCTIONS,
        "vehicle_model": "FIFO queues, no overtaking (ambulance included), no turning movements",
        "discharge_headway_s": DISCHARGE_HEADWAY_S,
        "road_model": "fixed travel time, finite storage = moving + queued at downstream stop line",
        "spillback_event": "onset of an interval where a green main approach is blocked by a full road",
        "preemption": "hold main green / truncate side green after min green; yellow and all-red never skipped",
        "recovery": "side street served next; recovery ends when the next main green starts",
    }
