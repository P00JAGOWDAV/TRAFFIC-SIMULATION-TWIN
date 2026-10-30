"""Simulation configuration, model constants and input validation.

MODEL ASSUMPTIONS (simplified, for demonstration only)
------------------------------------------------------
This is a simplified educational model of a fixed-time, four-way signalised
intersection. It is NOT a certified traffic-engineering tool and must not be
used to design or operate real traffic control equipment.

* Time advances in fixed steps of ``TIME_STEP_S`` (1 second).
* Arrivals per approach follow a Poisson process whose hourly rate is
  ``base_rate_vph * traffic_multiplier``. Arrival counts are drawn with
  ``numpy.random.default_rng(seed)``, so the same configuration always
  produces the same result.
* Each approach discharges only while its signal is GREEN, at a saturation
  flow of ``lane_count * 3600 / DISCHARGE_HEADWAY_S`` vehicles per hour
  (2.0 s headway -> 1800 veh/h/lane, a common textbook value). Yellow and
  all-red intervals are treated as lost time (no discharge), which is a
  conservative simplification.
* Turning movements, pedestrians, start-up lost time and vehicle
  dynamics are not modelled.
* BLOCKED APPROACH interpretation: a blocked approach represents a full
  incident blockage (e.g. a crash or closure just downstream of the stop
  line). Its discharge capacity is multiplied by ``BLOCKED_CAPACITY_FACTOR``
  (0.0 -> zero capacity). Vehicles still arrive and queue on that approach,
  which is what makes spillback visible. The signal plan is unchanged.
* SPILLBACK: each lane can store ``QUEUE_STORAGE_PER_LANE`` vehicles
  (about 300 m of road at 7.5 m per queued vehicle). A spillback event is
  counted each time an approach's queue rises above its storage capacity
  (i.e. the onset of an overflow episode, not every second spent in it).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum
from typing import Any, Mapping, Optional

# ---- Model constants (documented above) ----------------------------------
TIME_STEP_S: int = 1
DISCHARGE_HEADWAY_S: float = 2.0
BLOCKED_CAPACITY_FACTOR: float = 0.0
QUEUE_STORAGE_PER_LANE: int = 40

# ---- Validation limits -----------------------------------------------------
MAX_ARRIVAL_RATE_VPH: float = 5000.0
MIN_GREEN_S: int = 5
MAX_GREEN_S: int = 180
MIN_YELLOW_S: int = 2
MAX_YELLOW_S: int = 10
MIN_ALL_RED_S: int = 1
MAX_ALL_RED_S: int = 10
MIN_LANES: int = 1
MAX_LANES: int = 6
MAX_DURATION_MIN: float = 240.0
MAX_TRAFFIC_MULTIPLIER: float = 5.0
MIN_HISTORY_INTERVAL_S: int = 1
MAX_HISTORY_INTERVAL_S: int = 600


class SimulationConfigError(ValueError):
    """Raised when a simulation configuration is invalid."""


class Direction(str, Enum):
    NORTH = "N"
    SOUTH = "S"
    EAST = "E"
    WEST = "W"

    @classmethod
    def parse(cls, value: Any) -> "Direction":
        if isinstance(value, Direction):
            return value
        if isinstance(value, str):
            key = value.strip().upper()
            aliases = {"N": cls.NORTH, "NORTH": cls.NORTH,
                       "S": cls.SOUTH, "SOUTH": cls.SOUTH,
                       "E": cls.EAST, "EAST": cls.EAST,
                       "W": cls.WEST, "WEST": cls.WEST}
            if key in aliases:
                return aliases[key]
        raise SimulationConfigError(
            f"Unsupported approach {value!r}; expected one of N, S, E, W "
            "(or north, south, east, west)."
        )


DIRECTIONS: tuple[Direction, ...] = (
    Direction.NORTH, Direction.SOUTH, Direction.EAST, Direction.WEST,
)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _check_number(name: str, value: Any, lo: float, hi: float) -> float:
    if not _is_number(value) or not math.isfinite(value):
        raise SimulationConfigError(f"{name} must be a finite number, got {value!r}.")
    if value < lo or value > hi:
        raise SimulationConfigError(f"{name} must be between {lo} and {hi}, got {value}.")
    return float(value)


def _check_int(name: str, value: Any, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        # Accept integral floats such as 30.0 coming from JSON.
        if _is_number(value) and math.isfinite(value) and float(value).is_integer():
            value = int(value)
        else:
            raise SimulationConfigError(f"{name} must be a whole number, got {value!r}.")
    if value < lo or value > hi:
        raise SimulationConfigError(f"{name} must be between {lo} and {hi}, got {value}.")
    return value


@dataclass(frozen=True)
class SimulationConfig:
    """Validated, immutable simulation input. Durations are in seconds unless named otherwise."""

    north_vph: float = 0.0
    south_vph: float = 0.0
    east_vph: float = 0.0
    west_vph: float = 0.0
    ns_green_s: int = 30
    ew_green_s: int = 30
    yellow_s: int = 3
    all_red_s: int = 2
    duration_min: float = 60.0
    lane_count: int = 2
    blocked_approach: Optional[Direction] = None
    traffic_multiplier: float = 1.0
    seed: int = 42
    history_interval_s: int = 1

    def __post_init__(self) -> None:
        set_ = lambda k, v: object.__setattr__(self, k, v)  # noqa: E731 (frozen dataclass)
        for name in ("north_vph", "south_vph", "east_vph", "west_vph"):
            value = getattr(self, name)
            if _is_number(value) and math.isfinite(value) and value < 0:
                raise SimulationConfigError(f"{name} cannot be negative, got {value}.")
            set_(name, _check_number(name, value, 0.0, MAX_ARRIVAL_RATE_VPH))
        set_("ns_green_s", _check_int("ns_green_s", self.ns_green_s, MIN_GREEN_S, MAX_GREEN_S))
        set_("ew_green_s", _check_int("ew_green_s", self.ew_green_s, MIN_GREEN_S, MAX_GREEN_S))
        set_("yellow_s", _check_int("yellow_s", self.yellow_s, MIN_YELLOW_S, MAX_YELLOW_S))
        set_("all_red_s", _check_int("all_red_s", self.all_red_s, MIN_ALL_RED_S, MAX_ALL_RED_S))
        duration = _check_number("duration_min", self.duration_min, 0.0, MAX_DURATION_MIN)
        if duration <= 0 or duration * 60 < TIME_STEP_S:
            raise SimulationConfigError("duration_min must be greater than zero.")
        set_("duration_min", duration)
        set_("lane_count", _check_int("lane_count", self.lane_count, MIN_LANES, MAX_LANES))
        if self.blocked_approach is not None:
            set_("blocked_approach", Direction.parse(self.blocked_approach))
        set_("traffic_multiplier", _check_number(
            "traffic_multiplier", self.traffic_multiplier, 0.0, MAX_TRAFFIC_MULTIPLIER))
        set_("seed", _check_int("seed", self.seed, 0, 2**32 - 1))
        set_("history_interval_s", _check_int(
            "history_interval_s", self.history_interval_s,
            MIN_HISTORY_INTERVAL_S, MAX_HISTORY_INTERVAL_S))

    # ---- Derived values --------------------------------------------------
    @property
    def duration_s(self) -> int:
        return int(round(self.duration_min * 60))

    @property
    def cycle_length_s(self) -> int:
        return self.ns_green_s + self.ew_green_s + 2 * (self.yellow_s + self.all_red_s)

    def base_rate_vph(self, direction: Direction) -> float:
        return {
            Direction.NORTH: self.north_vph,
            Direction.SOUTH: self.south_vph,
            Direction.EAST: self.east_vph,
            Direction.WEST: self.west_vph,
        }[direction]

    def effective_rate_vph(self, direction: Direction) -> float:
        return self.base_rate_vph(direction) * self.traffic_multiplier

    def capacity_factor(self, direction: Direction) -> float:
        return BLOCKED_CAPACITY_FACTOR if direction == self.blocked_approach else 1.0

    def saturation_flow_vph(self, direction: Direction) -> float:
        """Discharge rate while green, in vehicles per hour."""
        return self.lane_count * 3600.0 / DISCHARGE_HEADWAY_S * self.capacity_factor(direction)

    def approach_capacity_vph(self, direction: Direction) -> float:
        """Average hourly capacity = saturation flow * (green / cycle)."""
        green = self.ns_green_s if direction in (Direction.NORTH, Direction.SOUTH) else self.ew_green_s
        return self.saturation_flow_vph(direction) * green / self.cycle_length_s

    @property
    def queue_storage_per_approach(self) -> int:
        return self.lane_count * QUEUE_STORAGE_PER_LANE

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "SimulationConfig":
        known = set(cls.__dataclass_fields__)
        unknown = set(data) - known
        if unknown:
            raise SimulationConfigError(f"Unknown configuration field(s): {sorted(unknown)}.")
        return cls(**dict(data))

    def to_dict(self) -> dict[str, Any]:
        return {
            "north_vph": self.north_vph, "south_vph": self.south_vph,
            "east_vph": self.east_vph, "west_vph": self.west_vph,
            "ns_green_s": self.ns_green_s, "ew_green_s": self.ew_green_s,
            "yellow_s": self.yellow_s, "all_red_s": self.all_red_s,
            "duration_min": self.duration_min, "lane_count": self.lane_count,
            "blocked_approach": self.blocked_approach.value if self.blocked_approach else None,
            "traffic_multiplier": self.traffic_multiplier, "seed": self.seed,
            "history_interval_s": self.history_interval_s,
        }


def model_assumptions() -> dict[str, Any]:
    """Machine-readable summary of the model's assumptions, returned with every result."""
    return {
        "disclaimer": ("Simplified educational model of a fixed-time four-way intersection. "
                       "Not a certified traffic-engineering or signal-control tool."),
        "time_step_s": TIME_STEP_S,
        "arrival_process": "Poisson arrivals per approach, seeded with numpy default_rng",
        "discharge_headway_s": DISCHARGE_HEADWAY_S,
        "saturation_flow_vph_per_lane": 3600.0 / DISCHARGE_HEADWAY_S,
        "discharge_during": "green only (yellow and all-red treated as lost time)",
        "blocked_approach": (f"Full incident blockage: capacity x {BLOCKED_CAPACITY_FACTOR}; "
                             "vehicles still arrive and queue"),
        "queue_storage_per_lane_veh": QUEUE_STORAGE_PER_LANE,
        "spillback_event": "Counted when an approach queue rises above its storage capacity",
        "not_modelled": ["turning movements", "pedestrians", "start-up lost time",
                         "vehicle dynamics", "actuated or adaptive control"],
    }
