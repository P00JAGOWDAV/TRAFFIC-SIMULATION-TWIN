"""Tests for the TrafficTwin simulation engine.

Run from the ``backend`` directory:  python -m pytest tests -v
"""

import json
import math

import pytest

from app.simulation import (
    DIRECTIONS,
    QUEUE_STORAGE_PER_LANE,
    Direction,
    Light,
    Phase,
    SignalConflictError,
    SignalController,
    SimulationConfig,
    SimulationConfigError,
    run_simulation,
    simulate,
)
from app.simulation.signals import check_no_conflict


def make_config(**overrides):
    base = dict(north_vph=400, south_vph=400, east_vph=300, west_vph=300,
                ns_green_s=30, ew_green_s=30, yellow_s=3, all_red_s=2,
                duration_min=30, lane_count=2, seed=7)
    base.update(overrides)
    return SimulationConfig(**base)


# --------------------------------------------------------------------------- zero traffic
def test_zero_traffic_produces_no_vehicles_but_signals_still_cycle():
    cfg = make_config(north_vph=0, south_vph=0, east_vph=0, west_vph=0, duration_min=5)
    result = run_simulation(cfg)
    s = result.summary
    assert s["total_arrivals"] == 0
    assert s["completed_vehicles"] == 0
    assert s["vehicles_still_waiting"] == 0
    assert s["throughput_vph"] == 0.0
    assert s["average_delay_s"] == 0.0
    assert s["average_delay_incl_waiting_s"] == 0.0
    assert s["max_queue_overall"] == 0
    assert s["spillback_events"] == 0
    assert len(result.history) == cfg.duration_s  # one frame per second by default
    assert {f["phase"] for f in result.history} == {p.value for p in Phase}


def test_zero_multiplier_removes_all_demand():
    result = run_simulation(make_config(traffic_multiplier=0.0))
    assert result.summary["total_arrivals"] == 0


# --------------------------------------------------------------------------- high demand
def test_high_demand_oversaturates_and_caps_throughput():
    cfg = make_config(north_vph=1500, south_vph=1500, east_vph=1500, west_vph=1500,
                      lane_count=1, duration_min=30, seed=3)
    s = run_simulation(cfg).summary
    # Each approach can release at most one vehicle per 2 s of green.
    cycle = cfg.cycle_length_s
    full_cycles, rem = divmod(cfg.duration_s, cycle)
    green_s_ns = full_cycles * cfg.ns_green_s + min(rem, cfg.ns_green_s)
    for d in ("N", "S"):
        assert s["per_approach"][d]["completed"] <= math.ceil(green_s_ns / 2)
    assert s["completed_vehicles"] < s["total_arrivals"]
    assert s["vehicles_still_waiting"] > 0
    assert s["max_queue_overall"] > QUEUE_STORAGE_PER_LANE
    assert s["spillback_events"] >= 4  # every approach overflowed at least once
    assert s["average_delay_incl_waiting_s"] >= s["average_delay_s"] > 0
    demand_vph = 4 * 1500
    assert s["throughput_vph"] < 0.6 * demand_vph


def test_throughput_matches_demand_when_undersaturated():
    cfg = make_config(north_vph=200, south_vph=200, east_vph=200, west_vph=200,
                      lane_count=2, duration_min=60, seed=11)
    s = run_simulation(cfg).summary
    assert s["vehicles_still_waiting"] <= 20  # only vehicles caught by the last red
    assert s["completed_vehicles"] >= 0.97 * s["total_arrivals"]
    assert s["spillback_events"] == 0


# --------------------------------------------------------------------------- signals
def test_signal_cycle_order_and_durations():
    cfg = make_config(ns_green_s=20, ew_green_s=15, yellow_s=4, all_red_s=2)
    ctrl = SignalController(cfg)
    assert ctrl.cycle_length_s == 20 + 4 + 2 + 15 + 4 + 2
    phases = [ctrl.state_at(t).phase for t in range(ctrl.cycle_length_s)]
    # collapse consecutive duplicates
    order = [p for i, p in enumerate(phases) if i == 0 or phases[i - 1] != p]
    assert order == [Phase.NS_GREEN, Phase.NS_YELLOW, Phase.ALL_RED_1,
                     Phase.EW_GREEN, Phase.EW_YELLOW, Phase.ALL_RED_2]
    counts = {p: phases.count(p) for p in Phase}
    assert counts == {Phase.NS_GREEN: 20, Phase.NS_YELLOW: 4, Phase.ALL_RED_1: 2,
                      Phase.EW_GREEN: 15, Phase.EW_YELLOW: 4, Phase.ALL_RED_2: 2}
    # wraps around to the start of the next cycle
    assert ctrl.state_at(ctrl.cycle_length_s).phase == Phase.NS_GREEN


def test_no_conflicting_greens_over_full_run_and_all_red_between_groups():
    cfg = make_config(ns_green_s=12, ew_green_s=9, yellow_s=3, all_red_s=1, duration_min=10)
    result = run_simulation(cfg)
    last_group, all_red_seen, switches = None, False, 0
    for frame in result.history:
        lights = frame["lights"]
        ns_active = lights["N"] != "red" or lights["S"] != "red"
        ew_active = lights["E"] != "red" or lights["W"] != "red"
        assert not (ns_active and ew_active), frame
        assert lights["N"] == lights["S"] and lights["E"] == lights["W"]
        group = "NS" if ns_active else "EW" if ew_active else None
        if group is None:
            assert frame["phase"].startswith("ALL_RED")
            all_red_seen = True
            continue
        if last_group is not None and group != last_group:
            assert all_red_seen, f"Group switched without all-red clearance at t={frame['t']}"
            switches += 1
        last_group, all_red_seen = group, False
    assert switches > 10


def test_conflict_check_rejects_conflicting_lights():
    bad = {Direction.NORTH: Light.GREEN, Direction.SOUTH: Light.GREEN,
           Direction.EAST: Light.GREEN, Direction.WEST: Light.RED}
    with pytest.raises(SignalConflictError):
        check_no_conflict(bad)
    yellow_vs_green = {Direction.NORTH: Light.YELLOW, Direction.SOUTH: Light.YELLOW,
                       Direction.EAST: Light.RED, Direction.WEST: Light.GREEN}
    with pytest.raises(SignalConflictError):
        check_no_conflict(yellow_vs_green)


def test_no_departures_on_red_or_yellow():
    result = run_simulation(make_config(north_vph=900, east_vph=900, duration_min=10))
    for frame in result.history:
        for d in ("N", "S", "E", "W"):
            if frame["lights"][d] != "green":
                assert frame["departures"][d] == 0, frame


# --------------------------------------------------------------------------- blocked approach / capacity
def test_blocked_approach_has_zero_capacity_and_spills_back():
    cfg = make_config(north_vph=800, south_vph=800, blocked_approach="north", duration_min=30)
    result = run_simulation(cfg)
    s = result.summary
    n = s["per_approach"]["N"]
    assert n["arrivals"] > 0
    assert n["completed"] == 0
    assert n["still_waiting"] == n["arrivals"]
    assert n["spillback_events"] >= 1
    assert s["per_approach"]["S"]["completed"] > 0  # the opposing approach is unaffected
    cap = result.capacity["per_approach"]
    assert cap["N"]["capacity_vph"] == 0.0 and cap["N"]["blocked"] is True
    assert cap["S"]["capacity_vph"] > 0 and cap["S"]["blocked"] is False


def test_capacity_scales_with_lane_count():
    one = make_config(lane_count=1)
    three = make_config(lane_count=3)
    # 2.0 s headway -> 1800 veh/h/lane saturation flow
    assert one.saturation_flow_vph(Direction.EAST) == pytest.approx(1800.0)
    assert three.saturation_flow_vph(Direction.EAST) == pytest.approx(5400.0)
    assert one.approach_capacity_vph(Direction.NORTH) == pytest.approx(1800.0 * 30 / 70)
    heavy = dict(north_vph=2500, south_vph=0, east_vph=0, west_vph=0, duration_min=20, seed=5)
    done_1 = run_simulation(make_config(lane_count=1, **heavy)).summary["completed_vehicles"]
    done_2 = run_simulation(make_config(lane_count=2, **heavy)).summary["completed_vehicles"]
    assert done_2 == pytest.approx(2 * done_1, rel=0.02)


# --------------------------------------------------------------------------- reproducibility
def test_fixed_seed_is_reproducible():
    a = run_simulation(make_config(seed=123)).to_dict()
    b = run_simulation(make_config(seed=123)).to_dict()
    assert a == b


def test_different_seeds_give_different_arrivals():
    a = run_simulation(make_config(seed=1)).summary
    b = run_simulation(make_config(seed=2)).summary
    assert a["per_approach"] != b["per_approach"]


# --------------------------------------------------------------------------- arrivals vs completed vs waiting
def test_arrivals_completed_and_waiting_are_consistent():
    cfg = make_config(north_vph=1200, east_vph=700, blocked_approach="W", duration_min=15)
    result = run_simulation(cfg)
    s = result.summary
    assert s["total_arrivals"] == s["completed_vehicles"] + s["vehicles_still_waiting"]
    for d in ("N", "S", "E", "W"):
        p = s["per_approach"][d]
        assert p["arrivals"] == p["completed"] + p["still_waiting"]
        assert p["final_queue"] == p["still_waiting"] == result.history[-1]["queues"][d]
        assert sum(f["arrivals"][d] for f in result.history) == p["arrivals"]
        assert sum(f["departures"][d] for f in result.history) == p["completed"]
        assert result.history[-1]["cumulative_departures"][d] == p["completed"]


def test_vehicles_that_arrive_during_red_are_waiting_not_completed():
    # North is red from t=40 (green 30 + yellow 3 + all-red 2 ... EW green until 65).
    cfg = make_config(ns_green_s=30, ew_green_s=30, duration_min=1, lane_count=1)
    schedule = {"N": [0] * 40 + [5]}  # 5 vehicles arrive at t=40, North red until t=70
    s = run_simulation(cfg, arrival_counts=schedule).summary
    assert s["total_arrivals"] == 5
    assert s["completed_vehicles"] == 0
    assert s["vehicles_still_waiting"] == 5
    assert s["average_delay_s"] == 0.0  # no completed vehicles
    assert s["average_delay_incl_waiting_s"] == pytest.approx(60 - 40)


# --------------------------------------------------------------------------- delay & queue maths
def test_average_delay_and_max_queue_exact_values():
    # 1 lane -> one departure per 2 s of green. Cycle: NS 10 | Y 3 | AR 2 | EW 10 | Y 3 | AR 2
    cfg = make_config(ns_green_s=10, ew_green_s=10, yellow_s=3, all_red_s=2,
                      lane_count=1, duration_min=1)
    schedule = {"N": [3], "E": [1]}  # all arrive at t=0
    s = run_simulation(cfg, arrival_counts=schedule).summary
    # North departs at t=1, 3, 5 -> delays 1, 3, 5. East waits for EW green (t=15), departs t=16.
    assert s["per_approach"]["N"]["average_delay_s"] == pytest.approx(3.0)
    assert s["per_approach"]["E"]["average_delay_s"] == pytest.approx(16.0)
    assert s["average_delay_s"] == pytest.approx((1 + 3 + 5 + 16) / 4)
    assert s["max_queue"] == {"N": 3, "S": 0, "E": 1, "W": 0}
    assert s["max_queue_overall"] == 3
    assert s["completed_vehicles"] == 4 and s["vehicles_still_waiting"] == 0
    assert s["throughput_vph"] == pytest.approx(4 * 60)  # 4 vehicles in 1 minute


def test_spillback_counts_overflow_onsets_not_seconds():
    cfg = make_config(lane_count=1, duration_min=2, blocked_approach="S")
    storage = cfg.queue_storage_per_approach
    schedule = {"S": [storage + 5]}  # instantly overflows and stays overflowed
    s = run_simulation(cfg, arrival_counts=schedule).summary
    assert s["per_approach"]["S"]["spillback_events"] == 1
    assert s["per_approach"]["S"]["spillback_seconds"] == cfg.duration_s
    assert s["spillback_events"] == 1


# --------------------------------------------------------------------------- validation
@pytest.mark.parametrize("overrides", [
    {"north_vph": -1},
    {"west_vph": float("nan")},
    {"east_vph": float("inf")},
    {"south_vph": "lots"},
    {"north_vph": 100000},
    {"ns_green_s": 0},
    {"ew_green_s": 1000},
    {"yellow_s": 0},
    {"all_red_s": 0},
    {"yellow_s": 2.5},
    {"duration_min": 0},
    {"duration_min": -10},
    {"duration_min": 10_000},
    {"lane_count": 0},
    {"lane_count": 7},
    {"lane_count": 1.5},
    {"lane_count": True},
    {"blocked_approach": "northeast"},
    {"blocked_approach": 3},
    {"traffic_multiplier": -0.5},
    {"traffic_multiplier": 50},
    {"seed": -1},
    {"history_interval_s": 0},
])
def test_invalid_inputs_are_rejected(overrides):
    with pytest.raises(SimulationConfigError):
        make_config(**overrides)


def test_unknown_fields_rejected_and_valid_aliases_accepted():
    with pytest.raises(SimulationConfigError):
        SimulationConfig.from_dict({"north_vph": 100, "bogus": 1})
    assert make_config(blocked_approach="e").blocked_approach is Direction.EAST
    assert make_config(blocked_approach="West").blocked_approach is Direction.WEST
    assert make_config(ns_green_s=30.0).ns_green_s == 30


# --------------------------------------------------------------------------- output shape
def test_simulate_returns_json_serialisable_animation_data():
    out = simulate({"north_vph": 500, "east_vph": 300, "duration_min": 5,
                    "history_interval_s": 5, "blocked_approach": "S"})
    json.dumps(out)  # must not raise
    assert set(out) == {"config", "assumptions", "signal_plan", "capacity", "summary", "history"}
    assert "Not a certified" in out["assumptions"]["disclaimer"]
    assert len(out["history"]) == 5 * 60 // 5
    frame = out["history"][0]
    assert set(frame) == {"t", "phase", "phase_remaining_s", "lights", "queues",
                          "arrivals", "departures", "cumulative_departures"}
    assert set(frame["lights"]) == {d.value for d in DIRECTIONS}
