"""Correctness tests for route sequencing: Held-Karp cross-validated against
brute force, the safety cap that keeps it from ever running unbounded,
cheapest-insertion + 2-opt's precedence preservation, and `sequence()`'s
mode-dispatch (including that "held_karp" can't override the safety cap).
"""
from __future__ import annotations

import itertools
import math
import random

import pytest

from app.core.routing import (
    HELD_KARP_MAX_STOPS, cheapest_insertion, held_karp, sequence, two_opt,
)
from app.models import Order


def _route_cost(route: list[int], dist_from: dict[int, list[float]]) -> float:
    return sum(dist_from[route[i]][route[i + 1]] for i in range(len(route) - 1))


def _precedence_ok(route: list[int], orders: list[Order]) -> bool:
    seen: set[int] = set()
    order_of: dict[int, tuple[str, int]] = {}
    for o in orders:
        order_of[o.pickup] = ("p", o.id)
        order_of[o.drop] = ("d", o.id)
    for node in route:
        info = order_of.get(node)
        if info is None:
            continue
        kind, oid = info
        if kind == "p":
            seen.add(oid)
        elif oid not in seen:
            return False
    return True


def _brute_force(depot: int, orders: list[Order], dist_from: dict[int, list[float]]) -> float:
    stops = []
    for o in orders:
        stops.append(("p", o.pickup, o.id))
        stops.append(("d", o.drop, o.id))
    best = None
    for perm in itertools.permutations(range(len(stops))):
        seen: set[int] = set()
        ok = True
        for i in perm:
            kind, _node, oid = stops[i]
            if kind == "p":
                seen.add(oid)
            elif oid not in seen:
                ok = False
                break
        if not ok:
            continue
        route = [depot] + [stops[i][1] for i in perm] + [depot]
        c = _route_cost(route, dist_from)
        if best is None or c < best:
            best = c
    return best


def _random_instance(seed: int, n_orders: int, n_nodes: int = 14):
    rng = random.Random(seed)
    pos = {i: (rng.random() * 10, rng.random() * 10) for i in range(n_nodes)}
    dist_from = {
        i: [math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]) for j in range(n_nodes)]
        for i in range(n_nodes)
    }
    pool = list(range(1, n_nodes))
    rng.shuffle(pool)
    orders = [
        Order(id=k, pickup=pool[2 * k], drop=pool[2 * k + 1], deadline=1000, qty=1, profit=1, service=0)
        for k in range(n_orders)
    ]
    return orders, dist_from


@pytest.mark.parametrize("seed", range(1, 31))
def test_held_karp_matches_brute_force(seed):
    orders, dist_from = _random_instance(seed, n_orders=random.Random(seed).randint(2, 4))
    route = [0] + held_karp(0, orders, dist_from) + [0]
    assert _precedence_ok(route, orders)
    assert _route_cost(route, dist_from) == pytest.approx(_brute_force(0, orders, dist_from), abs=1e-6)


def test_held_karp_refuses_past_the_safety_cap():
    n_orders = HELD_KARP_MAX_STOPS // 2 + 1  # one order over the line
    orders, dist_from = _random_instance(1, n_orders=n_orders, n_nodes=2 * n_orders + 2)
    with pytest.raises(ValueError, match="exponential"):
        held_karp(0, orders, dist_from)


def test_held_karp_stays_fast_at_the_cap():
    import time
    n_orders = HELD_KARP_MAX_STOPS // 2
    orders, dist_from = _random_instance(1, n_orders=n_orders, n_nodes=2 * n_orders + 4)
    t0 = time.perf_counter()
    held_karp(0, orders, dist_from)
    assert time.perf_counter() - t0 < 2.0  # generous CI margin; measured ~17ms in development


def test_held_karp_empty_and_singleton():
    assert held_karp(0, [], {0: [0]}) == []
    orders = [Order(id=0, pickup=1, drop=2, deadline=10, qty=1, profit=1, service=0)]
    dist_from = {0: [0, 1, 2], 1: [1, 0, 1], 2: [2, 1, 0]}
    route = held_karp(0, orders, dist_from)
    assert route == [1, 2]


@pytest.mark.parametrize("seed", range(1, 11))
def test_cheapest_insertion_preserves_precedence(seed):
    orders, dist_from = _random_instance(seed, n_orders=10, n_nodes=30)
    route = cheapest_insertion(0, orders, dist_from)
    assert _precedence_ok(route, orders)
    assert route[0] == 0 and route[-1] == 0
    assert sorted(route[1:-1]) == sorted([o.pickup for o in orders] + [o.drop for o in orders])


@pytest.mark.parametrize("seed", range(1, 11))
def test_two_opt_never_increases_cost_and_keeps_precedence(seed):
    orders, dist_from = _random_instance(seed, n_orders=10, n_nodes=30)
    route = cheapest_insertion(0, orders, dist_from)
    before = _route_cost(route, dist_from)
    improved = two_opt(route, orders, dist_from)
    after = _route_cost(improved, dist_from)
    assert after <= before + 1e-9
    assert _precedence_ok(improved, orders)
    assert sorted(improved) == sorted(route)  # same multiset of stops, just reordered


def test_two_opt_respects_max_passes_and_terminates():
    orders, dist_from = _random_instance(3, n_orders=8, n_nodes=24)
    route = cheapest_insertion(0, orders, dist_from)
    result = two_opt(route, orders, dist_from, max_passes=1)
    assert _precedence_ok(result, orders)  # must not raise or hang regardless of pass cap


@pytest.mark.parametrize("mode", ["auto", "held_karp", "insertion_2opt"])
def test_sequence_dispatch_produces_a_valid_route(mode):
    orders, dist_from = _random_instance(5, n_orders=4, n_nodes=14)
    route = sequence(0, orders, dist_from, mode)
    assert _precedence_ok(route, orders)
    assert route[0] == 0 and route[-1] == 0


def test_sequence_held_karp_request_falls_back_above_the_cap():
    """The safety cap is a guardrail, not a preference -- an explicit
    "held_karp" request past HELD_KARP_MAX_STOPS must still fall back to the
    heuristic instead of raising or hanging."""
    n_orders = HELD_KARP_MAX_STOPS // 2 + 2
    orders, dist_from = _random_instance(1, n_orders=n_orders, n_nodes=2 * n_orders + 4)
    route = sequence(0, orders, dist_from, mode="held_karp")  # must not raise
    assert _precedence_ok(route, orders)


def test_sequence_empty_orders():
    assert sequence(0, [], {0: [0]}, "auto") == [0, 0]


def test_auto_matches_held_karp_below_the_cap():
    """auto should be exact (== Held-Karp's own cost) whenever it's safe to
    be -- confirms auto isn't silently taking the heuristic path early."""
    orders, dist_from = _random_instance(9, n_orders=4, n_nodes=14)
    auto_route = sequence(0, orders, dist_from, "auto")
    hk_route = [0] + held_karp(0, orders, dist_from) + [0]
    assert _route_cost(auto_route, dist_from) == pytest.approx(_route_cost(hk_route, dist_from), abs=1e-6)
