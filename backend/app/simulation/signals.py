"""Fixed-time, two-phase signal controller.

Cycle order (always):
    NS_GREEN -> NS_YELLOW -> ALL_RED_1 -> EW_GREEN -> EW_YELLOW -> ALL_RED_2 -> repeat

North and South share a phase; East and West share a phase. The two groups
conflict, so at most one group is ever non-red, and an all-red clearance
interval always separates them.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .config import DIRECTIONS, Direction, SimulationConfig

NS_GROUP = frozenset({Direction.NORTH, Direction.SOUTH})
EW_GROUP = frozenset({Direction.EAST, Direction.WEST})


class Light(str, Enum):
    GREEN = "green"
    YELLOW = "yellow"
    RED = "red"


class Phase(str, Enum):
    NS_GREEN = "NS_GREEN"
    NS_YELLOW = "NS_YELLOW"
    ALL_RED_1 = "ALL_RED_1"
    EW_GREEN = "EW_GREEN"
    EW_YELLOW = "EW_YELLOW"
    ALL_RED_2 = "ALL_RED_2"


class SignalConflictError(RuntimeError):
    """Raised if conflicting approaches would ever be non-red together."""


@dataclass(frozen=True)
class SignalState:
    phase: Phase
    time_in_phase_s: int
    phase_remaining_s: int
    lights: dict[Direction, Light]

    def is_green(self, direction: Direction) -> bool:
        return self.lights[direction] == Light.GREEN

    def lights_dict(self) -> dict[str, str]:
        return {d.value: self.lights[d].value for d in DIRECTIONS}


_PHASE_LIGHTS: dict[Phase, tuple[Light, Light]] = {
    # (north/south light, east/west light)
    Phase.NS_GREEN: (Light.GREEN, Light.RED),
    Phase.NS_YELLOW: (Light.YELLOW, Light.RED),
    Phase.ALL_RED_1: (Light.RED, Light.RED),
    Phase.EW_GREEN: (Light.RED, Light.GREEN),
    Phase.EW_YELLOW: (Light.RED, Light.YELLOW),
    Phase.ALL_RED_2: (Light.RED, Light.RED),
}


def check_no_conflict(lights: dict[Direction, Light]) -> None:
    ns_active = any(lights[d] != Light.RED for d in NS_GROUP)
    ew_active = any(lights[d] != Light.RED for d in EW_GROUP)
    if ns_active and ew_active:
        raise SignalConflictError(f"Conflicting approaches active together: {lights}")


class SignalController:
    """Pure function of time: ``state_at(t)`` for t in seconds from simulation start."""

    def __init__(self, config: SimulationConfig) -> None:
        self.plan: list[tuple[Phase, int]] = [
            (Phase.NS_GREEN, config.ns_green_s),
            (Phase.NS_YELLOW, config.yellow_s),
            (Phase.ALL_RED_1, config.all_red_s),
            (Phase.EW_GREEN, config.ew_green_s),
            (Phase.EW_YELLOW, config.yellow_s),
            (Phase.ALL_RED_2, config.all_red_s),
        ]
        self.cycle_length_s = sum(d for _, d in self.plan)

    def state_at(self, t: int) -> SignalState:
        if t < 0:
            raise ValueError("time must be non-negative")
        offset = t % self.cycle_length_s
        for phase, duration in self.plan:
            if offset < duration:
                ns, ew = _PHASE_LIGHTS[phase]
                lights = {Direction.NORTH: ns, Direction.SOUTH: ns,
                          Direction.EAST: ew, Direction.WEST: ew}
                check_no_conflict(lights)
                return SignalState(phase, offset, duration - offset, lights)
            offset -= duration
        raise AssertionError("unreachable: offset exceeded cycle length")  # pragma: no cover

    def plan_dict(self) -> list[dict[str, object]]:
        return [{"phase": p.value, "duration_s": d} for p, d in self.plan]
