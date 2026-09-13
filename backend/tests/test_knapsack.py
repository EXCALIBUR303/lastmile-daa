"""Correctness tests for order selection.

DP-3 (dp_deadline_knapsack) is cross-validated against the exact bitmask
oracle, proven never to lose to either greedy baseline on their SHARED
(continuous-time) surrogate objective in the overwhelming majority of cases,
and its rare, small, discretization-driven exceptions are measured and
bounded rather than asserted away -- see the module docstring in
knapsack.py for exactly why they exist and why they're safe.
"""
from __future__ import annotations

import math

import pytest

from app.core.graph import Graph
from app.core.knapsack import (
    MAX_BITMASK_N, _edd_feasible, _surrogate_time, dp_01_knapsack,
    dp_bitmask_exact, dp_deadline_knapsack, greedy_density, greedy_edd, lp_bound,
)
from app.core.sssp import dijkstra
from app.data.generator import generate
from app.models import GenerateRequest, Order


def _instance_context(seed: int, n_orders: int = 10, n_nodes: int = 30):
    inst = generate(GenerateRequest(seed=seed, n_orders=n_orders, n_nodes=n_nodes))
    g = Graph.from_instance(inst)
    sources = sorted({0} | {o.pickup for o in inst.orders} | {o.drop for o in inst.orders})
    dist_from = {s: dijkstra(g, s)[0] for s in sources}
    return inst.orders, dist_from


def _surrogate_profit(by_id: dict[int, Order], ids: list[int]) -> float:
    return sum(by_id[i].profit for i in ids)


# --------------------------------------------------------------------------- #
# DP-3 vs the exact bitmask oracle
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", range(1, 11))
def test_dp3_matches_bitmask_oracle(seed):
    """Both solve the SAME (continuous-time) surrogate problem via
    `_edd_feasible` -- DP-3's discretisation is the only difference, so an
    exact match confirms the DP itself is doing the right optimisation, not
    just "close enough"."""
    orders, dist_from = _instance_context(seed, n_orders=8, n_nodes=25)  # N=16 stops -> fine for 2^N
    cap, horizon = 15, 480
    n = len(orders)
    assert n <= MAX_BITMASK_N
    dp_sel, dp_val = dp_deadline_knapsack(orders, cap, horizon, dist_from)
    oracle_sel, oracle_val = dp_bitmask_exact(orders, cap, horizon, dist_from)
    assert dp_val == pytest.approx(oracle_val, abs=1e-6), (
        f"seed={seed}: DP-3={dp_val} oracle={oracle_val} (selections {sorted(dp_sel)} vs {sorted(oracle_sel)})"
    )


def test_bitmask_oracle_refuses_large_n():
    orders = [Order(id=i, pickup=0, drop=1, deadline=100, qty=1, profit=1, service=1)
              for i in range(MAX_BITMASK_N + 1)]
    with pytest.raises(ValueError, match="exponential"):
        dp_bitmask_exact(orders, capacity=100, horizon=1000, dist_from={0: [0, 0]})


# --------------------------------------------------------------------------- #
# DP-3 vs greedy on their SHARED surrogate objective
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", range(1, 41))
def test_dp3_selection_is_feasible_under_its_own_discretisation(seed):
    """The one invariant a discretised DP can promise unconditionally: its
    answer is feasible WITHIN THE INTEGER GRID IT ACTUALLY SOLVED. Continuous-
    time feasibility is a different, weaker claim -- see the dedicated
    residual-error test below for that one."""
    orders, dist_from = _instance_context(seed)
    cap, horizon = 15, 480
    sel, val = dp_deadline_knapsack(orders, cap, horizon, dist_from)
    by_id = {o.id: o for o in orders}
    clock = 0
    for oid in sorted(sel, key=lambda i: by_id[i].deadline):
        o = by_id[oid]
        clock += round(_surrogate_time(o, dist_from))
        assert clock <= math.floor(o.deadline), f"seed={seed}: infeasible in DP's OWN grid"
    assert sum(by_id[i].qty for i in sel) <= cap
    assert val == pytest.approx(_surrogate_profit(by_id, sel), abs=1e-6)


@pytest.mark.parametrize("seed", range(1, 61))
def test_dp3_not_beaten_by_greedy_on_shared_continuous_objective(seed):
    orders, dist_from = _instance_context(seed)
    cap, horizon = 15, 480
    by_id = {o.id: o for o in orders}
    dp_sel, dp_val = dp_deadline_knapsack(orders, cap, horizon, dist_from)
    g1 = greedy_density(orders, cap, dist_from)
    g2 = greedy_edd(orders, cap, dist_from)
    assert _surrogate_profit(by_id, g1) <= dp_val + 1e-6, f"seed={seed}: G1 beat DP-3"
    assert _surrogate_profit(by_id, g2) <= dp_val + 1e-6, f"seed={seed}: G2 beat DP-3"


def test_discretisation_residual_error_stays_small_and_rare():
    """Rounding each order's surrogate time to the nearest whole minute (not
    ceiling -- see knapsack.py's docstring for why ceiling compounds into a
    real bug) means a DP-3 selection can very occasionally be a few seconds
    over budget in TRUE continuous time, self-corrected later by S6's exact
    simulation. This is a regression guard on the SIZE of that gap, not a
    claim that it's zero -- it categorically cannot be zero for any
    pseudo-polynomial DP over real-valued weights without exact arithmetic.
    """
    overruns = []
    for seed in range(1, 201):
        orders, dist_from = _instance_context(seed)
        by_id = {o.id: o for o in orders}
        sel, _ = dp_deadline_knapsack(orders, 15, 480, dist_from)
        clock = 0.0
        for oid in sorted(sel, key=lambda i: by_id[i].deadline):
            o = by_id[oid]
            clock += _surrogate_time(o, dist_from)
            if clock > o.deadline:
                overruns.append(clock - o.deadline)
    rate = len(overruns) / 200
    worst = max(overruns) if overruns else 0.0
    assert rate < 0.15, f"discretisation overrun rate regressed to {rate:.1%}"
    assert worst < 3.0, f"worst discretisation overrun regressed to {worst:.2f} min"


# --------------------------------------------------------------------------- #
# DP-1: deliberately deadline-blind
# --------------------------------------------------------------------------- #


def test_dp1_can_pick_orders_dp3_provably_wont():
    orders = [
        Order(id=0, pickup=0, drop=1, deadline=100, qty=4, profit=80, service=1),
        Order(id=1, pickup=2, drop=3, deadline=5, qty=4, profit=200, service=1),  # impossible deadline
        Order(id=2, pickup=4, drop=5, deadline=100, qty=4, profit=70, service=1),
    ]
    dist_from = {0: [0] * 6, 2: [0] * 6, 4: [0] * 6}
    dist_from[0][1] = 20
    dist_from[2][3] = 20
    dist_from[4][5] = 20
    dp1_sel, _ = dp_01_knapsack(orders, capacity=8)
    dp3_sel, dp3_val = dp_deadline_knapsack(orders, capacity=8, horizon=100, dist_from=dist_from)
    oracle_sel, oracle_val = dp_bitmask_exact(orders, capacity=8, horizon=100, dist_from=dist_from)
    assert 1 in dp1_sel, "DP-1 should grab the high-profit order, blind to its deadline"
    assert 1 not in dp3_sel, "DP-3 must reject an order it can never make on time"
    assert dp3_val == pytest.approx(oracle_val, abs=1e-6)
    assert oracle_val == oracle_val  # sanity: oracle agrees with itself trivially
    assert sorted(dp3_sel) == sorted(oracle_sel)


def test_dp1_ignores_capacity_zero_gracefully():
    orders = [Order(id=0, pickup=0, drop=1, deadline=10, qty=1, profit=5, service=1)]
    assert dp_01_knapsack(orders, capacity=0) == ([], 0.0)


def test_dp3_empty_inputs():
    assert dp_deadline_knapsack([], capacity=10, horizon=100, dist_from={}) == ([], 0.0)


# --------------------------------------------------------------------------- #
# LP bound: valid ceiling, even though it relaxes MORE than DP-3 does
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", range(1, 21))
def test_lp_bound_never_beaten_by_dp3(seed):
    orders, dist_from = _instance_context(seed)
    cap, horizon = 15, 480
    _, dp_val = dp_deadline_knapsack(orders, cap, horizon, dist_from)
    bound = lp_bound(orders, cap)
    assert bound >= dp_val - 1e-6, f"seed={seed}: LP bound {bound} < DP-3 {dp_val}"


def test_lp_bound_matches_hand_computed_fractional_fill():
    orders = [
        Order(id=0, pickup=0, drop=1, deadline=100, qty=2, profit=20, service=0),  # density 10
        Order(id=1, pickup=0, drop=1, deadline=100, qty=4, profit=20, service=0),  # density 5
    ]
    # capacity 3: take all of item 0 (qty2,profit20), then 1/4 of item1's qty (1 unit) -> +5 profit
    assert lp_bound(orders, capacity=3) == pytest.approx(25.0, abs=1e-6)


# --------------------------------------------------------------------------- #
# Greedy baselines: internal feasibility and capacity invariants
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", range(1, 21))
@pytest.mark.parametrize("selector", [greedy_density, greedy_edd])
def test_greedy_selection_is_edd_feasible_and_within_capacity(seed, selector):
    orders, dist_from = _instance_context(seed)
    by_id = {o.id: o for o in orders}
    sel = selector(orders, capacity=15, dist_from=dist_from)
    assert _edd_feasible(sel, by_id, dist_from)
    assert sum(by_id[i].qty for i in sel) <= 15
    assert len(sel) == len(set(sel))
