"""Tests for the lane-closure feature and the scenario presets.

Run from the ``backend`` folder:  python -m pytest tests/test_scenarios.py -v
"""

import json

import pytest

from app.simulation import SimulationConfigError
from app.simulation.corridor import (
    CorridorConfig,
    compare_strategies,
    demand_from_schedule,
    generate_demand,
    run_corridor,
)
from app.simulation.scenarios import SCENARIOS, build_config, list_scenarios, run_scenario


def cfg(**overrides):
    base = dict(main_vph=900, side_vph=300, duration_min=20, seed=42, link_travel_s=30,
                link_storage_veh=20, ambulance_request_s=None)
    base.update(overrides)
    return CorridorConfig(**base)


# --------------------------------------------------------------------------- lane closure
def test_no_closure_keeps_old_results():
    a = run_corridor(cfg(), "fixed_time", False)["summary"]
    b = run_corridor(cfg(closure_junction=None, closure_lanes_closed=1), "fixed_time", False)["summary"]
    assert a == b
    assert a["lane_closure"] is None


def test_full_closure_stops_all_main_departures_while_active():
    c = cfg(closure_junction=0, closure_start_s=0, closure_end_s=None, closure_lanes_closed=2)
    res = run_corridor(c, "fixed_time", False)
    assert res["summary"]["main_road_completed"] == 0
    for frame in res["history"]:
        assert frame["junctions"][0]["closure"] is True
        assert frame["links"][0]["occupancy"] == 0          # nothing gets past J0


def test_one_lane_closed_halves_discharge_rate():
    # 20 cars wait at J0. J0 main green starts at t=30 (25 green + 3 yellow + 2 all-red).
    base = cfg(ambulance_request_s=None, duration_min=2, link_storage_veh=200)
    demand = demand_from_schedule(base, main=[20])
    two = run_corridor(base, "fixed_time", False, demand)
    closed = cfg(ambulance_request_s=None, duration_min=2, link_storage_veh=200,
                 closure_junction=0, closure_start_s=0, closure_lanes_closed=1)
    one = run_corridor(closed, "fixed_time", False, demand)
    left_two = two["history"][40]["links"][0]["occupancy"]   # after 11 s of green
    left_one = one["history"][40]["links"][0]["occupancy"]
    assert left_two == 11 and left_one == 5     # 2 lanes: 1 car/s; 1 lane: cars at t=31,33,35,37,39


def test_closure_only_during_its_window():
    c = cfg(closure_junction=1, closure_start_s=300, closure_end_s=600)
    res = run_corridor(c, "fixed_time", False)
    flags = [f["junctions"][1]["closure"] for f in res["history"]]
    assert not any(flags[:300]) and all(flags[300:600]) and not any(flags[600:])
    assert not any(f["junctions"][0]["closure"] for f in res["history"])


def test_closure_makes_queues_worse_and_does_not_change_arrivals():
    open_ = run_corridor(cfg(main_vph=1100), "fixed_time", False)["summary"]
    shut = run_corridor(cfg(main_vph=1100, closure_junction=1, closure_start_s=200,
                            closure_end_s=1000), "fixed_time", False)["summary"]
    assert open_["total_arrivals"] == shut["total_arrivals"]
    assert shut["main_road_completed"] < open_["main_road_completed"]
    # J1's queue is capped by road L0's storage, so the closure shows up as spillback
    # blocking J0 and a longer queue at J0.
    assert shut["spillback_blocked_seconds_per_link"][0] > open_["spillback_blocked_seconds_per_link"][0]
    assert shut["max_queues"][0]["main"] > open_["max_queues"][0]["main"]


def test_ambulance_is_held_by_full_closure_and_released_after():
    c = cfg(ambulance_request_s=0, main_vph=0, side_vph=0, closure_junction=1,
            closure_start_s=0, closure_end_s=300, closure_lanes_closed=2, duration_min=10)
    amb = run_corridor(c, "fixed_time", True)["summary"]["ambulance"]
    assert amb["completed"] is True
    assert amb["exit_s"] >= 300                         # could not pass J1 before reopening


@pytest.mark.parametrize("overrides", [
    {"closure_junction": 3},
    {"closure_junction": 0, "closure_lanes_closed": 3},   # only 2 lanes exist
    {"closure_junction": 0, "closure_lanes_closed": 0},
    {"closure_junction": 0, "closure_start_s": 500, "closure_end_s": 400},
    {"closure_junction": 0, "closure_start_s": 99999},
])
def test_bad_closure_settings_rejected(overrides):
    with pytest.raises(SimulationConfigError):
        cfg(**overrides)


# --------------------------------------------------------------------------- scenarios
def test_every_scenario_builds_and_changes_real_settings():
    base = build_config(["normal"]).to_dict()
    for key in SCENARIOS:
        c = build_config([key]).to_dict()
        if key != "normal":
            assert c != base, key


def test_combined_scenario_contains_every_part():
    c = build_config(["peak_hour", "blocked_lane", "ambulance", "spillback", "surge"])
    assert c.main_vph == 1000 and c.closure_junction == 1
    assert c.ambulance_request_s == 600 and c.link_storage_veh == 8
    assert c.surge_multiplier == 2.0


def test_scenario_order_does_not_matter():
    a = build_config(["ambulance", "peak_hour", "surge"])
    b = build_config(["surge", "ambulance", "peak_hour"])
    assert a == b


def test_custom_values_override_presets_and_blanks_are_ignored():
    c = build_config(["peak_hour", "ambulance"],
                     {"main_vph": 1200, "ambulance_request_s": 300, "seed": "", "side_vph": None})
    assert c.main_vph == 1200 and c.ambulance_request_s == 300
    assert c.seed == 42 and c.side_vph == (320.0, 320.0, 320.0)


@pytest.mark.parametrize("scenarios,overrides", [
    (["normal", "peak_hour"], {}),               # two traffic levels
    (["rush"], {}),                              # unknown scenario
    (["normal"], {"yellow_s": 0}),               # not editable here
    (["normal"], {"main_vph": -10}),             # invalid value
    (["surge"], {"surge_end_s": 100}),           # end before start
])
def test_bad_scenario_requests_rejected(scenarios, overrides):
    with pytest.raises(SimulationConfigError):
        build_config(scenarios, overrides)


def test_run_scenario_is_fair_reproducible_and_json_ready():
    out1 = run_scenario(["peak_hour", "ambulance"], {"duration_min": 15}, history_step_s=5)
    out2 = run_scenario(["peak_hour", "ambulance"], {"duration_min": 15}, history_step_s=5)
    assert out1 == out2
    json.dumps(out1)
    res = out1["comparison"]["results"]
    assert set(res) == {"fixed_time", "fixed_time+preemption", "coordinated+preemption"}
    assert len({r["total_arrivals"] for r in res.values()}) == 1
    hist = out1["comparison"]["runs"]["fixed_time"]["history"]
    assert len(hist) == 15 * 60 // 5 + 1   # every 5th second plus the final second
    assert "closure" in hist[0]["junctions"][0]


def test_run_scenario_matches_direct_engine_run():
    out = run_scenario(["spillback", "ambulance"], include_history=False)
    c = build_config(["spillback", "ambulance"])
    direct = compare_strategies(c)["results"]
    assert out["comparison"]["results"] == direct
    assert out["comparison"]["runs"]["fixed_time"]["history"] == []


def test_run_scenario_strategy_choice_and_validation():
    out = run_scenario(["normal"], variants=["coordinated+preemption"], include_history=False)
    assert list(out["comparison"]["results"]) == ["coordinated+preemption"]
    with pytest.raises(SimulationConfigError):
        run_scenario(["normal"], variants=["magic"])
    with pytest.raises(SimulationConfigError):
        run_scenario([])
    with pytest.raises(SimulationConfigError):
        run_scenario(["normal"], history_step_s=0)


def test_list_scenarios_is_json_ready():
    data = list_scenarios()
    json.dumps(data)
    assert set(data["scenarios"]) == set(SCENARIOS)


# --------------------------------------------------------------------------- multi-seed check
from app.simulation.scenarios import run_scenario_multi_seed  # noqa: E402


def test_multi_seed_check_uses_consecutive_seeds_and_is_reproducible():
    a = run_scenario_multi_seed(["peak_hour", "spillback", "ambulance"], {"seed": 7}, n_seeds=3)
    b = run_scenario_multi_seed(["peak_hour", "spillback", "ambulance"], {"seed": 7}, n_seeds=3)
    assert a == b
    json.dumps(a)
    assert a["seeds"] == [7, 8, 9]
    for name, w in a["wins"].items():
        assert all(0 <= v <= 3 for v in w.values())
    # every seed has at least one winner for cars finished
    assert sum(w["completed_vehicles"] for w in a["wins"].values()) >= 3


def test_multi_seed_first_seed_matches_single_run():
    single = run_scenario(["peak_hour", "ambulance"], {"seed": 11}, include_history=False)
    multi = run_scenario_multi_seed(["peak_hour", "ambulance"], {"seed": 11}, n_seeds=2)
    for name, summ in single["comparison"]["results"].items():
        row = multi["per_seed"][name][0]
        assert row["seed"] == 11
        assert row["completed_vehicles"] == summ["completed_vehicles"]
        assert row["ambulance_travel_time_s"] == summ["ambulance"]["travel_time_s"]


@pytest.mark.parametrize("n", [1, 11, "5", True])
def test_multi_seed_rejects_bad_seed_count(n):
    with pytest.raises(SimulationConfigError):
        run_scenario_multi_seed(["normal"], n_seeds=n)
