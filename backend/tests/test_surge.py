"""Tests for the traffic surge feature of the corridor model.

Run from the ``backend`` folder:  python -m pytest tests/test_surge.py -v
"""

import numpy as np
import pytest

from app.simulation import SimulationConfigError
from app.simulation.corridor import (
    CorridorConfig,
    compare_multi_seed,
    compare_strategies,
    generate_demand,
)


def cfg(**overrides):
    base = dict(main_vph=900, side_vph=300, duration_min=15, seed=42,
                link_travel_s=30, link_storage_veh=8, traffic_multiplier=1.2,
                ambulance_request_s=600)
    base.update(overrides)
    return CorridorConfig(**base)


def old_generate_demand(c):
    """Exact copy of the arrival logic from before the surge feature existed."""
    rng = np.random.default_rng(c.seed)
    n = c.duration_s
    m = c.traffic_multiplier
    main = rng.poisson(c.main_vph * m / 3600.0, size=n)
    side = [[rng.poisson(c.side_vph[j] * m / 3600.0, size=n) for _ in range(2)] for j in range(3)]
    return main, np.array(side)


def test_no_surge_gives_exactly_the_old_traffic():
    c = cfg()
    old_main, old_side = old_generate_demand(c)
    new = generate_demand(c)
    assert np.array_equal(new.main, old_main)
    assert np.array_equal(new.side, old_side)


def test_multiplier_of_one_is_the_same_as_no_surge():
    plain = generate_demand(cfg())
    flat = generate_demand(cfg(surge_start_s=100, surge_end_s=400, surge_multiplier=1.0))
    assert np.array_equal(plain.main, flat.main) and np.array_equal(plain.side, flat.side)


def test_surge_adds_traffic_only_inside_the_window():
    # Long window and big multiplier so the random effect is clearly visible.
    c = cfg(duration_min=60, surge_start_s=1200, surge_end_s=2400, surge_multiplier=3.0)
    d = generate_demand(c)
    before = d.main[:1200].sum()
    during = d.main[1200:2400].sum()
    after = d.main[2400:].sum()
    assert during > 2.2 * before          # expected ratio is 3.0
    assert during > 2.2 * after
    side_during = d.side[:, :, 1200:2400].sum()
    side_before = d.side[:, :, :1200].sum()
    assert side_during > 2.2 * side_before   # surge applies to side roads as well


def test_traffic_before_the_surge_is_unchanged_on_the_main_road():
    plain = generate_demand(cfg())
    surged = generate_demand(cfg(surge_start_s=300, surge_end_s=600, surge_multiplier=2.0))
    assert np.array_equal(plain.main[:300], surged.main[:300])
    assert surged.total > plain.total


def test_surge_is_reproducible_with_the_same_seed():
    a = generate_demand(cfg(surge_start_s=300, surge_end_s=600, surge_multiplier=2.0))
    b = generate_demand(cfg(surge_start_s=300, surge_end_s=600, surge_multiplier=2.0))
    assert np.array_equal(a.main, b.main) and np.array_equal(a.side, b.side)


def test_all_strategies_get_the_same_surged_traffic():
    c = cfg(surge_start_s=300, surge_end_s=600, surge_multiplier=2.0)
    result = compare_strategies(c)
    arrivals = {s["total_arrivals"] for s in result["results"].values()}
    assert arrivals == {generate_demand(c).total}


def test_surge_works_in_multi_seed_comparison():
    c = cfg(surge_start_s=300, surge_end_s=600, surge_multiplier=2.0)
    m1 = compare_multi_seed(c, [1, 2])
    m2 = compare_multi_seed(c, [1, 2])
    assert m1 == m2


def test_surge_settings_appear_in_config_dict():
    d = cfg(surge_start_s=300, surge_end_s=600, surge_multiplier=2.0).to_dict()
    assert (d["surge_start_s"], d["surge_end_s"], d["surge_multiplier"]) == (300, 600, 2.0)
    assert CorridorConfig.from_dict(d).to_dict() == d


@pytest.mark.parametrize("overrides", [
    {"surge_start_s": 300},                                     # end missing
    {"surge_end_s": 600},                                       # start missing
    {"surge_start_s": 600, "surge_end_s": 300},                 # end before start
    {"surge_start_s": 300, "surge_end_s": 300},                 # zero length
    {"surge_start_s": -10, "surge_end_s": 300},                 # negative start
    {"surge_start_s": 300, "surge_end_s": 99999},               # ends after simulation
    {"surge_start_s": 300, "surge_end_s": 600, "surge_multiplier": 0.5},   # not a surge
    {"surge_start_s": 300, "surge_end_s": 600, "surge_multiplier": 50},    # too big
    {"surge_start_s": 300, "surge_end_s": 600, "surge_multiplier": "big"}, # not a number
])
def test_bad_surge_settings_are_rejected(overrides):
    with pytest.raises(SimulationConfigError):
        cfg(**overrides)
