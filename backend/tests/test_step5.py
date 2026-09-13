"""Step 5 pipeline integration: MST zoning actually reduces travel time
versus the round-robin baseline, the empty-zone pathology stays rare (the
regression guard for clustering on pickups only, not pickups+drops), and the
TSP lower bound is a genuine, unconditional lower bound on what's driven.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _solve(zoning: str = "prim", seed: int = 7, **gen_overrides) -> dict:
    gen = {"seed": seed, **gen_overrides}
    r = client.post("/api/solve", json={"generate": gen, "config": {"zoning": zoning}})
    assert r.status_code == 200, r.text
    return r.json()


def test_mst_zoning_meaningfully_reduces_travel_time_vs_round_robin():
    """The actual payoff, not just a checkbox: measured ~31% average
    reduction across 20 seeds when this test was first written (Step 5,
    before real sequencing existed -- every zoning mode just walked
    `selected` in EDD order). Step 7 gave EVERY zoning mode a real
    sequencer, which narrows the gap since round-robin's routes are no
    longer needlessly criss-crossed on top of being badly zoned -- remeasured
    at ~12% post-Step-7. Both numbers are real; the threshold moved because
    the baseline got better, not because MST zoning stopped mattering.
    """
    total_none, total_prim = 0.0, 0.0
    for seed in range(1, 16):
        none = _solve(zoning="none", seed=seed)["result"]["metrics"]["total_travel_time"]
        mst = _solve(zoning="prim", seed=seed)["result"]["metrics"]["total_travel_time"]
        total_none += none
        total_prim += mst
    improvement = 1 - total_prim / total_none
    assert improvement > 0.08, f"MST zoning only improved travel time by {improvement:.1%}"


def test_empty_zone_rate_stays_low_pickups_only_regression_guard():
    """Regression guard for the pickups-only clustering fix: clustering on
    pickups+drops together measured a 72% empty-vehicle rate; pickups-only
    measured 5%. If this ever creeps back toward the old rate, the fix
    likely regressed (e.g. drops crept back into the zoning stop set).
    """
    empty = 0
    for seed in range(1, 41):
        d = _solve(zoning="prim", seed=seed)
        sizes = [len(p["selected"]) for p in d["result"]["plans"]]
        if 0 in sizes:
            empty += 1
    assert empty / 40 < 0.3, f"empty-zone rate {empty}/40 looks like the pickups+drops bug"


@pytest.mark.parametrize("zoning", ["prim", "kruskal"])
def test_mst_lower_bound_is_never_exceeded_by_actual_travel(zoning):
    for seed in range(1, 16):
        d = _solve(zoning=zoning, seed=seed)
        for p in d["result"]["plans"]:
            if p["mst_lower_bound"] is not None:
                assert p["travel_time"] >= p["mst_lower_bound"] - 1e-6, (
                    f"seed={seed} veh={p['vehicle_id']}: "
                    f"{p['travel_time']} < bound {p['mst_lower_bound']}"
                )


def test_zoning_none_has_no_lower_bound_and_matches_old_round_robin_shape():
    d = _solve(zoning="none")
    for p in d["result"]["plans"]:
        assert p["mst_lower_bound"] is None


def test_prim_and_kruskal_produce_the_same_zoning():
    """Real-valued distances make weight ties astronomically unlikely, so
    both algorithms should partition orders identically -- algorithm choice
    is a performance knob, not a behaviour knob (same pattern as Step 4)."""
    p = _solve(zoning="prim", seed=9)
    k = _solve(zoning="kruskal", seed=9)
    p_zones = sorted(sorted(pl["zone"]) for pl in p["result"]["plans"])
    k_zones = sorted(sorted(pl["zone"]) for pl in k["result"]["plans"])
    assert p_zones == k_zones


def test_every_order_lands_in_exactly_one_zone_or_none_are_unzoned():
    d = _solve(zoning="prim", seed=12, n_orders=20, n_vehicles=4, n_nodes=45)
    zoned = [oid for p in d["result"]["plans"] for oid in p["zone"]]
    assert sorted(zoned) == list(range(20))
    assert len(zoned) == len(set(zoned))  # no order double-zoned


def test_trace_contains_mst_events_only_when_zoning_is_not_none():
    on = _solve(zoning="prim")
    off = _solve(zoning="none")
    assert "mst" in {s["stage"] for s in on["trace"]}
    assert "mst" not in {s["stage"] for s in off["trace"]}
    kinds = {s["kind"] for s in on["trace"] if s["stage"] == "mst"}
    assert {"edge_consider", "edge_accept"} <= kinds


def test_more_vehicles_than_pickup_stops_does_not_crash():
    d = _solve(zoning="prim", seed=1, n_orders=2, n_vehicles=5, n_nodes=12)
    assert len(d["result"]["plans"]) == 5
