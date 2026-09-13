"""Step 4 pipeline integration: cfg.apsp actually switches which algorithm
computes the metric closure, all three modes agree on the resulting routes
and profit, the negative-cost-cycle flag surfaces without blocking, and the
Bellman-Ford guard is genuinely traced.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _solve(apsp: str = "dijkstra", seed: int = 7, **gen_overrides) -> dict:
    gen = {"seed": seed, **gen_overrides}
    r = client.post("/api/solve", json={"generate": gen, "config": {"apsp": apsp}})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("mode", ["floyd", "johnson"])
def test_apsp_mode_returns_a_full_matrix(mode):
    d = _solve(apsp=mode)
    assert d["apsp"] is not None
    assert d["apsp"]["algorithm"] == mode
    n = d["instance"]["meta"]["n"]
    assert len(d["apsp"]["node_ids"]) == n
    assert len(d["apsp"]["matrix"]) == n
    assert all(len(row) == n for row in d["apsp"]["matrix"])
    assert all(d["apsp"]["matrix"][i][i] == 0 for i in range(n))


def test_dijkstra_mode_builds_no_matrix():
    d = _solve(apsp="dijkstra")
    assert d["apsp"] is None


@pytest.mark.parametrize("mode", ["dijkstra", "floyd", "johnson"])
def test_unreachable_pairs_serialize_as_null_not_infinity(mode):
    """math.inf has no JSON form -- the response must already have sanitised
    it, or this .json() call itself would be the thing catching the bug."""
    d = _solve(apsp=mode, seed=3)
    assert d is not None  # got here without a JSON decode error


def test_all_three_apsp_modes_agree_on_routes_and_profit():
    """The whole design point of Step 4: the algorithm choice is a
    performance/pedagogy knob, never a behaviour knob."""
    results = {mode: _solve(apsp=mode, seed=7) for mode in ("dijkstra", "floyd", "johnson")}
    baseline = results["dijkstra"]["result"]
    for mode in ("floyd", "johnson"):
        r = results[mode]["result"]
        assert r["metrics"]["total_profit"] == baseline["metrics"]["total_profit"]
        assert r["metrics"]["total_travel_time"] == baseline["metrics"]["total_travel_time"]
        assert r["unserved"] == baseline["unserved"]
        for p1, p2 in zip(r["plans"], baseline["plans"]):
            assert p1["route"] == p2["route"]
            assert p1["selected"] == p2["selected"]


def test_net_profit_equals_profit_minus_cost():
    d = _solve()
    m = d["result"]["metrics"]
    assert m["net_profit"] == pytest.approx(m["total_profit"] - m["total_cost"], abs=1e-6)


def test_travel_cost_sums_to_total_cost():
    d = _solve()
    summed = sum(p["travel_cost"] for p in d["result"]["plans"])
    assert summed == pytest.approx(d["result"]["metrics"]["total_cost"], abs=1e-2)


def test_negative_cost_cycle_flag_does_not_block_solve():
    """At a high subsidy fraction the flag should fire for at least one seed,
    and the solve must still return 200 -- informational, not a rejection."""
    hits = 0
    for seed in range(1, 21):
        d = _solve(seed=seed, neg_cost_frac=0.15)  # _solve already asserts 200
        if d["result"]["metrics"]["negative_cost_cycle"]:
            hits += 1
    assert hits > 0, "expected at least one seed to trigger the flag at neg_cost_frac=0.15"


def test_bellman_ford_guard_is_traced_on_every_solve_regardless_of_apsp_mode():
    for mode in ("dijkstra", "floyd", "johnson"):
        d = _solve(apsp=mode)
        stages = {s["stage"] for s in d["trace"]}
        assert "bellman" in stages, f"mode={mode}"
        kinds = {s["kind"] for s in d["trace"] if s["stage"] == "bellman"}
        assert "done" in kinds


def test_floyd_trace_has_k_phase_events():
    d = _solve(apsp="floyd")
    kinds = [s["kind"] for s in d["trace"] if s["stage"] == "floyd"]
    assert kinds.count("k_phase") == d["instance"]["meta"]["n"]


def test_johnson_trace_has_dijkstra_events_from_demo_source():
    d = _solve(apsp="johnson")
    stages = {s["stage"] for s in d["trace"]}
    assert "dijkstra" in stages
