"""Tests for the bench sweeps: well-formed rows, consistent schemas (so
`_write_csv`'s `DictWriter(fieldnames=rows[0].keys())` never chokes on a
later row with different keys), and the qualitative results run_bench.py's
charts depend on actually holding.
"""
from __future__ import annotations

from bench.sweeps import (
    sweep_apsp_crossover, sweep_capacity, sweep_selector_quality, sweep_size,
    sweep_zoning_quality,
)


def _same_schema(rows: list[dict]) -> bool:
    if not rows:
        return True
    keys = set(rows[0].keys())
    return all(set(r.keys()) == keys for r in rows)


def test_apsp_crossover_shape_and_schema():
    rows = sweep_apsp_crossover(node_counts=[20, 40], densities=[0.1, 0.4])
    assert len(rows) == 2 * 2 * 3  # n x density x {dijkstra,floyd,johnson}
    assert _same_schema(rows)
    modes = {r["mode"] for r in rows}
    assert modes == {"dijkstra", "floyd", "johnson"}
    assert all(r["runtime_ms"] >= 0 for r in rows)


def test_apsp_crossover_floyd_runtime_roughly_density_independent():
    """Floyd-Warshall's O(n^3) genuinely doesn't depend on m -- its runtime
    at a fixed n should stay in the same ballpark across densities, unlike
    dijkstra/johnson which both do."""
    rows = sweep_apsp_crossover(node_counts=[60], densities=[0.05, 0.7])
    floyd = sorted(r["runtime_ms"] for r in rows if r["mode"] == "floyd")
    # generous bound: even with system noise, flat-complexity shouldn't
    # swing by an order of magnitude the way m-dependent algorithms can
    assert floyd[-1] < floyd[0] * 5 + 1.0


def test_selector_quality_shape_and_schema():
    rows = sweep_selector_quality(n_orders_list=[6, 10], seeds=[1, 2])
    assert _same_schema(rows)
    assert {r["selector"] for r in rows} == {"dp_deadline", "dp_01", "greedy_density", "greedy_edd"}
    for r in rows:
        assert r["profit"] <= r["dp_bound"] + 1e-6
        assert r["repair_drops"] >= 0


def test_selector_quality_dp01_needs_no_fewer_repairs_on_average():
    """The real, load-bearing Step 7 finding this chart exists to show:
    deadline-blind selection needs as much or more repair effort, on
    average, than deadline-aware selection -- checked here at the actual
    sizes run_bench.py charts, not just the seeds spot-checked in Step 7."""
    rows = sweep_selector_quality(n_orders_list=[16, 24], seeds=[1, 2, 3])
    for n in (16, 24):
        dp3 = [r["repair_drops"] for r in rows if r["n_orders"] == n and r["selector"] == "dp_deadline"]
        dp1 = [r["repair_drops"] for r in rows if r["n_orders"] == n and r["selector"] == "dp_01"]
        assert sum(dp1) / len(dp1) >= sum(dp3) / len(dp3) - 1e-9, f"n_orders={n}"


def test_zoning_quality_mst_beats_round_robin_on_average():
    rows = sweep_zoning_quality(seeds=list(range(1, 11)))
    assert _same_schema(rows)
    prim = [r["total_travel_time"] for r in rows if r["zoning"] == "prim"]
    none = [r["total_travel_time"] for r in rows if r["zoning"] == "none"]
    assert sum(prim) / len(prim) < sum(none) / len(none)


def test_size_sweep_shape_and_monotone_ish_runtime():
    rows = sweep_size(node_counts=[20, 60, 100], seeds=[1])
    assert _same_schema(rows)
    by_n = {r["n_nodes"]: r["runtime_ms"] for r in rows}
    assert by_n[100] > by_n[20]  # larger instances take longer, at minimum at the extremes


def test_capacity_sweep_shape_and_profit_non_decreasing_trend():
    rows = sweep_capacity(capacities=[4, 30], seeds=[1, 2, 3])
    assert _same_schema(rows)
    low = [r["profit"] for r in rows if r["capacity"] == 4]
    high = [r["profit"] for r in rows if r["capacity"] == 30]
    assert sum(high) / len(high) >= sum(low) / len(low)  # more capacity can't hurt achievable profit


def test_sweeps_skip_invalid_combinations_without_crashing():
    """generate() raises ValueError when n_nodes is too small for n_orders
    (needs 2*n_orders+1); every sweep must skip that combo, not propagate."""
    rows = sweep_apsp_crossover(node_counts=[4], densities=[0.1])  # n_orders = max(2, 4//4) = 2, needs 5 nodes
    assert rows == []
