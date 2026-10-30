"""Metric accumulation for the intersection simulation.

Definitions
-----------
* arrivals: vehicles generated at an approach during the run.
* completed: vehicles that actually departed through the stop line.
* still_waiting: vehicles queued at the end of the run (arrivals - completed).
* delay of a vehicle: departure time - arrival time, in seconds. Because
  vehicles only move when they discharge, this is the waiting delay at the
  approach (free-flow travel time is not part of the model).
* average_delay_s: mean delay over completed vehicles only.
* average_delay_incl_waiting_s: mean over completed vehicles plus the
  time-so-far of vehicles still waiting at the end (a lower bound for them),
  which avoids flattering heavily oversaturated scenarios.
* max_queue: largest queue observed on an approach at the end of any step.
* spillback_events: number of times an approach queue rose above its storage
  capacity (onset of each overflow episode).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from .config import DIRECTIONS, Direction


@dataclass
class ApproachStats:
    arrivals: int = 0
    completed: int = 0
    total_delay_s: float = 0.0
    max_queue: int = 0
    spillback_events: int = 0
    spillback_seconds: int = 0
    _in_spillback: bool = field(default=False, repr=False)

    def record_departure(self, delay_s: float) -> None:
        self.completed += 1
        self.total_delay_s += delay_s

    def record_queue(self, queue_len: int, storage: int, dt: int) -> None:
        if queue_len > self.max_queue:
            self.max_queue = queue_len
        overflowing = queue_len > storage
        if overflowing:
            self.spillback_seconds += dt
            if not self._in_spillback:
                self.spillback_events += 1
        self._in_spillback = overflowing

    @property
    def average_delay_s(self) -> float:
        return self.total_delay_s / self.completed if self.completed else 0.0


class MetricsCollector:
    def __init__(self) -> None:
        self.approaches: dict[Direction, ApproachStats] = {d: ApproachStats() for d in DIRECTIONS}

    def summary(self, final_queues: dict[Direction, int],
                waiting_ages_s: Iterable[float], duration_s: int) -> dict[str, Any]:
        stats = self.approaches
        total_arrivals = sum(s.arrivals for s in stats.values())
        total_completed = sum(s.completed for s in stats.values())
        total_waiting = sum(final_queues.values())
        total_delay = sum(s.total_delay_s for s in stats.values())
        waiting_ages = list(waiting_ages_s)
        if len(waiting_ages) != total_waiting:  # internal consistency guard
            raise AssertionError("waiting vehicle ages do not match final queues")
        incl_count = total_completed + total_waiting
        hours = duration_s / 3600.0

        def r(x: float) -> float:
            return round(float(x), 3)

        return {
            "total_arrivals": total_arrivals,
            "completed_vehicles": total_completed,
            "vehicles_still_waiting": total_waiting,
            "throughput_vph": r(total_completed / hours) if hours > 0 else 0.0,
            "average_delay_s": r(total_delay / total_completed) if total_completed else 0.0,
            "average_delay_incl_waiting_s": (
                r((total_delay + sum(waiting_ages)) / incl_count) if incl_count else 0.0),
            "max_queue": {d.value: stats[d].max_queue for d in DIRECTIONS},
            "max_queue_overall": max(s.max_queue for s in stats.values()),
            "final_queue": {d.value: final_queues[d] for d in DIRECTIONS},
            "spillback_events": sum(s.spillback_events for s in stats.values()),
            "per_approach": {
                d.value: {
                    "arrivals": stats[d].arrivals,
                    "completed": stats[d].completed,
                    "still_waiting": final_queues[d],
                    "average_delay_s": r(stats[d].average_delay_s),
                    "max_queue": stats[d].max_queue,
                    "final_queue": final_queues[d],
                    "spillback_events": stats[d].spillback_events,
                    "spillback_seconds": stats[d].spillback_seconds,
                }
                for d in DIRECTIONS
            },
        }
