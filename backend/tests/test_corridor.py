"""Tests for the three-junction "Spillback and the Ambulance" corridor model.

Run from the ``backend`` directory:  python -m pytest tests -v
"""

import json

import numpy as np
import pytest

from app.simulation import SimulationConfigError
from app.simulation.corridor import (
    DEFAULT_VARIANTS,
    N_JUNCTIONS,
    CorridorConfig,
    compare_multi_seed,
    compare_strategies,
    demand_from_schedule,
    generate_demand,
    run_corridor,
)

GREEN = {"NS_GREEN", "EW_GREEN"}


def bottleneck(**overrides):
    """J2 gives the main road little green, so road L1 fills and spills back."""
    base = dict(main_vph=1000, side_vph=[200, 200, 300], main_green_s=[35, 35, 20],
                side_green_s=[20, 20, 35], link_storage_veh=25, link_travel_s=20,
                duration_min=30, seed=1, ambulance_request_s=700)
    base.update(overrides)
    return CorridorConfig(**base)


def empty_corridor(**overrides):
    base = dict(main_vph=0, side_vph=0, main_green_s=30, side_green_s=25, yellow_s=3,
                all_red_s=2, min_green_s=7, main_lanes=2, link_travel_s=20,
                duration_min=5, ambulance_request_s=0, seed=0)
    base.update(overrides)
    return CorridorConfig(**base)


# --------------------------------------------------------------------------- finite storage
def test_road_occupancy_never_exceeds_storage():
    cfg = bottleneck(main_vph=1800, link_storage_veh=12)
    for strategy, pre in DEFAULT_VARIANTS:
        res = run_corridor(cfg, strategy, pre)
        for frame in res["history"]:
            for link in frame["links"]:
                assert link["occupancy"] <= link["storage"] == 12
        assert max(res["summary"]["max_link_occupancy"]) == 12  # storage actually reached


def test_vehicle_conservation():
    res = run_corridor(bottleneck(), "coordinated", True)
    s = res["summary"]
    assert s["total_arrivals"] == s["completed_vehicles"] + s["vehicles_still_in_corridor"]
    assert s["vehicles_still_in_corridor"] > 0  # queues and moving vehicles at the end


# --------------------------------------------------------------------------- spillback blocking
def test_full_downstream_road_blocks_upstream_departures():
    # J2 almost never serves the main road; heavy main demand must back up to J0.
    cfg = CorridorConfig(main_vph=1500, side_vph=0, main_green_s=[30, 30, 5],
                         side_green_s=[10, 10, 120], min_green_s=5, link_storage_veh=10,
                         duration_min=10,
                         ambulance_request_s=None, seed=4)
    res = run_corridor(cfg, "fixed_time", preemption=False)
    s = res["summary"]
    assert s["spillback_events_per_link"][1] >= 1          # J1 blocked by full road L1
    assert s["spillback_events_per_link"][0] >= 1          # ...which then blocks J0 via L0
    assert s["spillback_blocked_seconds"] > 0
    blocked_frames = 0
    for frame in res["history"]:
        for i, link in enumerate(frame["links"]):
            if link["blocked"]:
                blocked_frames += 1
                assert link["occupancy"] == link["storage"]          # only full roads block
                assert frame["junctions"][i]["lights"]["W"] == "green"
                assert frame["junctions"][i]["queues"]["main"] > 0
    assert blocked_frames == s["spillback_blocked_seconds"]


def test_no_spillback_when_demand_is_light():
    cfg = bottleneck(main_vph=200, side_vph=100, main_green_s=30, side_green_s=25)
    s = run_corridor(cfg, "fixed_time", False)["summary"]
    assert s["spillback_events"] == 0 and s["spillback_blocked_seconds"] == 0


def test_coordinated_strategy_reduces_spillback_on_identical_demand():
    cmp = compare_strategies(bottleneck(), variants=[("fixed_time", False), ("coordinated", False)])
    fixed, coord = cmp["results"]["fixed_time"], cmp["results"]["coordinated"]
    assert fixed["total_arrivals"] == coord["total_arrivals"]
    assert fixed["spillback_blocked_seconds"] > 0
    assert coord["spillback_blocked_seconds"] < fixed["spillback_blocked_seconds"]
    assert coord["average_delay_s"] < fixed["average_delay_s"]


# --------------------------------------------------------------------------- safe transitions
@pytest.mark.parametrize("strategy,pre", DEFAULT_VARIANTS)
def test_signal_transitions_are_safe(strategy, pre):
    cfg = bottleneck()
    res = run_corridor(cfg, strategy, pre)
    allowed = {("NS_GREEN", "NS_YELLOW"), ("NS_YELLOW", "ALL_RED_1"), ("ALL_RED_1", "EW_GREEN"),
               ("EW_GREEN", "EW_YELLOW"), ("EW_YELLOW", "ALL_RED_2"), ("ALL_RED_2", "NS_GREEN"),
               ("ALL_RED_2", "EW_GREEN")}  # the last one only under pre-emption, after full all-red
    for j, trans in enumerate(res["transitions"]):
        assert trans, "signals must keep cycling"
        start = 0
        for tr in trans:
            assert (tr["from"], tr["to"]) in allowed
            if not pre:
                assert (tr["from"], tr["to"]) != ("ALL_RED_2", "EW_GREEN")
            held = tr["t"] - start
            if tr["from"] in ("NS_YELLOW", "EW_YELLOW"):
                assert held == cfg.yellow_s
            elif tr["from"].startswith("ALL_RED"):
                assert held == cfg.all_red_s
            else:
                assert held >= cfg.min_green_s
            start = tr["t"]
    for frame in res["history"]:
        for jn in frame["junctions"]:
            L = jn["lights"]
            ns_on = L["N"] != "red" or L["S"] != "red"
            ew_on = L["E"] != "red" or L["W"] != "red"
            assert not (ns_on and ew_on)


def test_every_green_change_passes_through_yellow_and_all_red():
    res = run_corridor(bottleneck(), "coordinated", True)
    for j in range(N_JUNCTIONS):
        seq = [f["junctions"][j]["phase"] for f in res["history"]]
        last_green = None
        for i in range(1, len(seq)):
            if seq[i] in GREEN and seq[i - 1] not in GREEN:
                assert seq[i - 1].startswith("ALL_RED"), (j, i)
                window = seq[max(0, i - 6):i]
                assert any("YELLOW" in p for p in window)
            if seq[i] in GREEN:
                last_green = seq[i]
        assert last_green is not None


# --------------------------------------------------------------------------- ambulance
def test_ambulance_exact_progression_in_empty_corridor():
    # J0 starts on side green: min green 7 s, yellow 3 s, all-red 2 s -> main green at t=12.
    # Road 20 s to J1 (already held green by look-ahead), 20 s more to J2 -> exits at t=52.
    res = run_corridor(empty_corridor(), "fixed_time", preemption=True)
    amb = res["summary"]["ambulance"]
    assert amb["completed"] is True
    assert amb["travel_time_s"] == 52
    assert amb["free_flow_s"] == 40 and amb["delay_s"] == 12
    trace = [(e["t"], e["location"], e["index"]) for e in amb["trace"]]
    assert trace == [(0, "queue", 0), (12, "link", 0), (32, "queue", 1),
                     (32, "link", 1), (52, "queue", 2), (52, "done", -1)]
    j0 = [(t["t"], t["from"], t["to"]) for t in res["transitions"][0][:3]]
    assert j0 == [(7, "NS_GREEN", "NS_YELLOW"), (10, "NS_YELLOW", "ALL_RED_1"),
                  (12, "ALL_RED_1", "EW_GREEN")]


def test_ambulance_waits_for_normal_cycle_without_preemption():
    res = run_corridor(empty_corridor(), "fixed_time", preemption=False)
    amb = res["summary"]["ambulance"]
    assert amb["completed"] and amb["travel_time_s"] > 52


def test_preemption_shortens_ambulance_trip_in_congestion():
    cmp = compare_strategies(bottleneck())
    times = {k: v["ambulance"]["travel_time_s"] for k, v in cmp["results"].items()}
    assert all(v is not None for v in times.values())
    assert times["fixed_time+preemption"] < times["fixed_time"]
    assert times["coordinated+preemption"] <= times["fixed_time+preemption"]
    for v in cmp["results"].values():
        assert v["ambulance"]["travel_time_s"] >= v["ambulance"]["free_flow_s"]


def test_ambulance_from_middle_junction_and_disabled_ambulance():
    res = run_corridor(empty_corridor(ambulance_entry_junction=1, ambulance_request_s=30))
    amb = res["summary"]["ambulance"]
    assert amb["completed"] and amb["entry_junction"] == 1 and amb["free_flow_s"] == 20
    none = run_corridor(empty_corridor(ambulance_request_s=None))["summary"]
    assert none["ambulance"] == {"requested": False}
    assert none["recovery_time_s"] is None


def test_ambulance_not_counted_as_ordinary_vehicle():
    s = run_corridor(empty_corridor())["summary"]
    assert s["total_arrivals"] == 0 and s["completed_vehicles"] == 0


# --------------------------------------------------------------------------- recovery
def test_recovery_returns_every_junction_to_normal_control():
    cfg = empty_corridor(duration_min=10)
    res = run_corridor(cfg, "fixed_time", True)
    s = res["summary"]
    assert s["all_recovered"] is True
    for rec in s["recovery"]:
        assert rec["preempt_start_s"] is not None
        assert rec["release_s"] > rec["preempt_start_s"]
        assert rec["recovery_end_s"] > rec["release_s"]
        assert rec["recovery_time_s"] == rec["recovery_end_s"] - rec["release_s"]
        trans = res["transitions"][rec["junction"]]
        after = [t for t in trans if t["t"] >= rec["release_s"]]
        # side street gets a full normal green during recovery, then main green resumes
        ns_start = next(t["t"] for t in after if t["to"] == "NS_GREEN")
        ns_end = next(t["t"] for t in after if t["from"] == "NS_GREEN" and t["t"] > ns_start)
        assert ns_end - ns_start == cfg.side_green_s[rec["junction"]]
        assert next(t["t"] for t in after if t["to"] == "EW_GREEN") == rec["recovery_end_s"]
    assert s["recovery_time_s"] == max(r["recovery_time_s"] for r in s["recovery"])
    # after recovery the last junction runs plain fixed timings again
    late = [t for t in res["transitions"][2] if t["t"] > s["recovery"][2]["recovery_end_s"]]
    held = [b["t"] - a["t"] for a, b in zip(late, late[1:]) if a["to"] == "EW_GREEN"]
    assert held and all(h == cfg.main_green_s[2] for h in held)


def test_recovery_reported_under_congestion():
    for name, s in compare_strategies(bottleneck())["results"].items():
        if name.endswith("+preemption"):
            assert s["recovery_time_s"] is not None and s["recovery_time_s"] > 0
            assert s["all_recovered"]
        else:
            assert s["recovery_time_s"] is None


# --------------------------------------------------------------------------- fairness & reproducibility
def test_identical_demand_across_strategies():
    cfg = bottleneck()
    cmp = compare_strategies(cfg)
    arrivals = {s["total_arrivals"] for s in cmp["results"].values()}
    assert arrivals == {cmp["ordinary_arrivals"]}
    requests = {s["ambulance"]["request_s"] for s in cmp["results"].values()}
    assert requests == {cfg.ambulance_request_s}


def test_fixed_seed_reproducible_and_seed_sensitive():
    a, b = generate_demand(bottleneck(seed=9)), generate_demand(bottleneck(seed=9))
    assert np.array_equal(a.main, b.main) and np.array_equal(a.side, b.side)
    assert not np.array_equal(a.main, generate_demand(bottleneck(seed=10)).main)
    r1 = compare_strategies(bottleneck(seed=9))
    r2 = compare_strategies(bottleneck(seed=9))
    assert r1 == r2


def test_multi_seed_comparison_is_compact_and_reproducible():
    seeds = [1, 2, 3]
    m1 = compare_multi_seed(bottleneck(), seeds)
    m2 = compare_multi_seed(bottleneck(), seeds)
    assert m1 == m2
    json.dumps(m1)
    assert set(m1["mean"]) == {"fixed_time", "fixed_time+preemption", "coordinated+preemption"}
    for rows in m1["per_seed"].values():
        assert [r["seed"] for r in rows] == seeds
    mean = m1["mean"]
    assert mean["coordinated+preemption"]["spillback_blocked_seconds"] < \
        mean["fixed_time"]["spillback_blocked_seconds"]
    assert mean["fixed_time+preemption"]["ambulance_travel_time_s"] < \
        mean["fixed_time"]["ambulance_travel_time_s"]
    assert m1["ambulance_completed_runs"] == {k: 3 for k in m1["mean"]}


def test_schedule_demand_exact_delay():
    # 3 main vehicles enter at t=0 into an otherwise empty corridor, no ambulance.
    # Travel time = cycle length (65 s), so vehicles reach J1 and J2 exactly as their
    # main greens start again: all delay is the initial wait at J0.
    cfg = empty_corridor(ambulance_request_s=None, main_lanes=2, link_travel_s=65)
    s = run_corridor(cfg, "fixed_time", False, demand_from_schedule(cfg, main=[3]))["summary"]
    assert s["completed_vehicles"] == 3 and s["vehicles_still_in_corridor"] == 0
    # J0 main green starts at t=25+3+2=30; 2 lanes -> one departure per second: 30, 31, 32.
    assert s["average_delay_s"] == pytest.approx((30 + 31 + 32) / 3)


# --------------------------------------------------------------------------- validation
@pytest.mark.parametrize("overrides", [
    {"main_vph": -5},
    {"side_vph": [100, 100]},
    {"main_green_s": [30, 30, 0]},
    {"link_storage_veh": 0},
    {"link_travel_s": 0},
    {"min_green_s": 40},
    {"ambulance_request_s": 99999},
    {"ambulance_entry_junction": 3},
    {"gate_threshold": 0},
    {"duration_min": 0},
    {"record_history": "yes"},
])
def test_invalid_corridor_config_rejected(overrides):
    with pytest.raises(SimulationConfigError):
        bottleneck(**overrides)


def test_invalid_strategy_and_seed_lists_rejected():
    with pytest.raises(SimulationConfigError):
        run_corridor(bottleneck(), "ai_magic")
    with pytest.raises(SimulationConfigError):
        compare_multi_seed(bottleneck(), [])
    with pytest.raises(SimulationConfigError):
        compare_multi_seed(bottleneck(), [1, 1])
    with pytest.raises(SimulationConfigError):
        CorridorConfig.from_dict({"bogus": 1})
