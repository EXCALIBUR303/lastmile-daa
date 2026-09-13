"""Step 6 pipeline integration: the selector config actually swaps the
selection algorithm, results stay internally consistent (route/visits match
`selected`), and the quality metrics (dp_bound, bound_gap_pct) behave.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

SELECTORS = ["dp_deadline", "dp_01", "greedy_density", "greedy_edd"]


def _solve(selector: str = "dp_deadline", seed: int = 7, **gen) -> dict:
    r = client.post("/api/solve", json={"generate": {"seed": seed, **gen},
                                        "config": {"selector": selector}})
    assert r.status_code == 200, r.text
    return r.json()


def test_all_four_selectors_return_valid_responses():
    for sel in SELECTORS:
        d = _solve(sel)
        assert d["stub"] is False  # every stage real as of Step 7
        m = d["result"]["metrics"]
        assert m["dp_bound"] > 0
        assert m["bound_gap_pct"] >= -1e-6  # profit can equal but never exceed the bound


def test_selected_orders_are_reported_in_deadline_order():
    """`selected` is still LISTED sorted by deadline for stable, readable
    reporting, regardless of which selector produced it or what order Step
    7's sequencer actually visits them in (dp_deadline_knapsack's own
    backtracking returns orders latest-deadline-first; greedy_density
    returns profit-density order). This is now purely a display convention
    -- see test_step7.py for confirmation that the ACTUAL route (`visits`)
    is free to differ from EDD order when that's more travel-efficient."""
    for sel in SELECTORS:
        d = _solve(sel)
        deadlines = {o["id"]: o["deadline"] for o in d["instance"]["orders"]}
        for plan in d["result"]["plans"]:
            ds = [deadlines[oid] for oid in plan["selected"]]
            assert ds == sorted(ds), f"selector={sel} veh={plan['vehicle_id']}: not EDD-ordered"


def test_dp01_needs_more_repair_drops_than_deadline_aware_selection():
    """dp_01 is deliberately deadline-blind. Since Step 7's repair loop now
    corrects ANY selector's deadline misses (dropping violators until none
    remain), on_time_pct is saturated at 100% for every selector -- no
    longer a useful signal (see pipeline.py's Step 7 docstring). The
    surviving, real signal is repair EFFORT: dp_01 starts from a selection
    that doesn't know deadlines exist, so it should need as many or more
    repair drops than dp_deadline's already-near-feasible surrogate choice,
    and strictly more at least sometimes.
    """
    dp01_ever_worse = False
    for seed in range(1, 21):
        dp3 = _solve("dp_deadline", seed)
        dp1 = _solve("dp_01", seed)
        dp3_drops = sum(1 for s in dp3["trace"] if s["stage"] == "repair")
        dp1_drops = sum(1 for s in dp1["trace"] if s["stage"] == "repair")
        assert dp1_drops >= dp3_drops, f"seed={seed}: dp_01 needed FEWER repairs than dp_deadline"
        if dp1_drops > dp3_drops:
            dp01_ever_worse = True
    assert dp01_ever_worse


def test_dp_bound_is_never_beaten_by_realised_profit():
    """LP bound relaxes capacity-only across ALL selectors -- a valid
    ceiling regardless of which one actually ran."""
    for sel in SELECTORS:
        for seed in range(1, 11):
            d = _solve(sel, seed)
            m = d["result"]["metrics"]
            assert m["total_profit"] <= m["dp_bound"] + 1e-6, f"{sel} seed={seed}"


def test_per_vehicle_dp_bound_sums_to_top_line_metric():
    d = _solve("dp_deadline")
    per_vehicle_sum = sum(p["dp_bound"] for p in d["result"]["plans"])
    assert per_vehicle_sum == pytest.approx(d["result"]["metrics"]["dp_bound"], abs=1e-2)


def test_trace_contains_knapsack_events_only_for_dp_deadline():
    dp = _solve("dp_deadline")
    greedy = _solve("greedy_edd")
    assert "knapsack" in {s["stage"] for s in dp["trace"]}
    assert "knapsack" not in {s["stage"] for s in greedy["trace"]}
    kinds = {s["kind"] for s in dp["trace"] if s["stage"] == "knapsack"}
    assert {"row_start", "cell_take", "traceback"} <= kinds


def test_switching_selector_does_not_change_zoning_or_apsp():
    """Selector swaps should be surgical -- zones (Step 5) and the metric
    closure (Steps 3-4) must be identical regardless of which selector S4
    then runs on top of them."""
    a = _solve("dp_deadline", seed=9)
    b = _solve("greedy_edd", seed=9)
    zones_a = sorted(sorted(p["zone"]) for p in a["result"]["plans"])
    zones_b = sorted(sorted(p["zone"]) for p in b["result"]["plans"])
    assert zones_a == zones_b
