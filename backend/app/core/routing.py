"""Route sequencing for one vehicle's selected orders: Held-Karp exact TSP
with precedence constraints for small stop counts, cheapest-insertion +
precedence-preserving 2-opt for larger ones.

Both operate purely on the stop-closure distances already computed in S2
(`dist_from`) -- this module never touches the road graph directly. It is
combinatorial optimisation over a precomputed distance matrix and one
precedence relation: order i's drop must appear somewhere after order i's
pickup in the route. Neither algorithm cares WHY that relation holds.
"""
from __future__ import annotations

from typing import NamedTuple

from app.core.trace import Tracer
from app.models import Order

# 2^14 * 14^2 ~= 3.2M state transitions -- a few hundred ms in pure Python.
# 16 stops would already be 4x the states for 30% more per-state work: this
# is deliberately conservative, not the theoretical max Python could grind
# through, because it runs once per vehicle and a "Run" click should stay
# interactive even with 5 vehicles all needing it at once.
HELD_KARP_MAX_STOPS = 12


class Stop(NamedTuple):
    node: int
    order_id: int
    kind: str  # "pickup" | "drop"


def _stops_for(orders: list[Order]) -> list[Stop]:
    stops: list[Stop] = []
    for o in orders:
        stops.append(Stop(o.pickup, o.id, "pickup"))
        stops.append(Stop(o.drop, o.id, "drop"))
    return stops


def held_karp(
    depot: int, orders: list[Order], dist_from: dict[int, list[float]],
    tracer: Tracer | None = None,
) -> list[int]:
    """Exact PDP-TSP: depot -> every (pickup_i before drop_i) -> depot,
    minimising total travel. O(2^S * S^2), S = 2*len(orders) stops (the
    depot is fixed as start/end and handled separately, not counted in S).

    Correctness: the standard Held-Karp argument, adapted with one added
    precondition. dp[mask][last] = min cost of a walk that has visited
    exactly `mask` (a subset of stops), ending at `last`. Every optimal such
    walk, with its final edge removed, is an optimal walk to SOME
    second-to-last stop having visited mask-{last} -- trying every possible
    predecessor and keeping the best is exhaustive and exact, identical to
    plain-TSP Held-Karp. The precedence constraint (a drop only becomes
    reachable once its pickup's bit is already set in `mask`) only prunes
    which (mask, last) pairs are ever populated; it changes nothing about
    why taking the minimum over all valid predecessors is correct.

    Raises ValueError past HELD_KARP_MAX_STOPS -- exponential, so the caller
    (`sequence`, below) must never invoke this on an unbounded S.
    """
    stops = _stops_for(orders)
    S = len(stops)
    if S == 0:
        return []
    if S > HELD_KARP_MAX_STOPS:
        raise ValueError(f"held_karp is exponential; refusing S={S} > {HELD_KARP_MAX_STOPS}")

    nodes = [depot] + [s.node for s in stops]
    D = [[dist_from[nodes[i]][nodes[j]] for j in range(len(nodes))] for i in range(len(nodes))]

    pickup_idx = {s.order_id: i for i, s in enumerate(stops) if s.kind == "pickup"}

    def precedence_ok(mask: int, j: int) -> bool:
        s = stops[j]
        return s.kind == "pickup" or bool(mask & (1 << pickup_idx[s.order_id]))

    INF = float("inf")
    size = 1 << S
    dp = [[INF] * S for _ in range(size)]
    parent = [[-1] * S for _ in range(size)]

    for j in range(S):
        if precedence_ok(0, j):
            dp[1 << j][j] = D[0][j + 1]  # depot (D-index 0) -> stop j (D-index j+1)

    for mask in range(size):          # numerically increasing mask <=> predecessors before successors
        for last in range(S):
            cur = dp[mask][last]
            if cur == INF or not (mask & (1 << last)):
                continue
            if tracer is not None:
                tracer.emit("heldkarp", "state", mask=mask, last=last, cost=round(cur, 2))
            row = D[last + 1]
            for j in range(S):
                if mask & (1 << j) or not precedence_ok(mask, j):
                    continue
                cand = cur + row[j + 1]
                nmask = mask | (1 << j)
                if cand < dp[nmask][j]:
                    dp[nmask][j] = cand
                    parent[nmask][j] = last

    full = size - 1
    best_last, best_cost = -1, INF
    for last in range(S):
        cost = dp[full][last] + D[last + 1][0]
        if cost < best_cost:
            best_cost, best_last = cost, last

    seq_idx: list[int] = []
    mask, last = full, best_last
    while last != -1:
        seq_idx.append(last)
        prev = parent[mask][last]
        mask ^= (1 << last)
        last = prev
    seq_idx.reverse()

    if tracer is not None:
        tracer.emit("heldkarp", "done", cost=round(best_cost, 2), stops=S)
    return [stops[i].node for i in seq_idx]


def cheapest_insertion(
    depot: int, orders: list[Order], dist_from: dict[int, list[float]],
    tracer: Tracer | None = None,
) -> list[int]:
    """Heuristic PDP construction for when Held-Karp is unsafe: repeatedly
    insert one order's (pickup, drop) pair wherever it adds the least travel,
    processed earliest-deadline-first (the most time-constrained orders tend
    to most restrict the route, so fixing their position first is the
    standard cheapest-insertion tie-break). O(N*L) per order to scan every
    insertion gap via O(1) incremental deltas (below), O(N) orders inserted
    one at a time against a route that grows by 2 stops each time -> O(N^2)
    overall, comfortably tractable past Held-Karp's reach.
    """
    route = [depot, depot]
    for o in sorted(orders, key=lambda o: o.deadline):
        L = len(route)
        best_delta, best_pi, best_di = None, 1, 1
        for pi in range(1, L):
            a, b = route[pi - 1], route[pi]
            d_pickup_alone = dist_from[a][o.pickup] + dist_from[o.pickup][b] - dist_from[a][b]
            # adjacent case: pickup and drop share this same gap
            delta_adj = (dist_from[a][o.pickup] + dist_from[o.pickup][o.drop]
                        + dist_from[o.drop][b] - dist_from[a][b])
            if best_delta is None or delta_adj < best_delta:
                best_delta, best_pi, best_di = delta_adj, pi, pi
            # split case: drop lands in a LATER, disjoint gap -- its delta is
            # independent of the pickup's (different edge entirely), so the
            # combined delta is just their sum.
            for di in range(pi + 1, L):
                c, d = route[di - 1], route[di]
                d_drop_alone = dist_from[c][o.drop] + dist_from[o.drop][d] - dist_from[c][d]
                delta = d_pickup_alone + d_drop_alone
                if delta < best_delta:
                    best_delta, best_pi, best_di = delta, pi, di
        if best_di == best_pi:
            route = route[:best_pi] + [o.pickup, o.drop] + route[best_pi:]
        else:
            route = route[:best_pi] + [o.pickup] + route[best_pi:best_di] + [o.drop] + route[best_di:]
        if tracer is not None:
            tracer.emit("twoopt", "insert", order_id=o.id, delta=round(best_delta, 2))
    return route


def _precedence_ok(route: list[int], order_of_node: dict[int, tuple[str, int]]) -> bool:
    seen_pickup: set[int] = set()
    for node in route:
        info = order_of_node.get(node)
        if info is None:
            continue
        kind, oid = info
        if kind == "pickup":
            seen_pickup.add(oid)
        elif oid not in seen_pickup:
            return False
    return True


def two_opt(
    route: list[int], orders: list[Order], dist_from: dict[int, list[float]],
    max_passes: int = 30, tracer: Tracer | None = None,
) -> list[int]:
    """Local search: try reversing each segment [i:j]; keep the reversal iff
    it shortens the tour AND doesn't break precedence (reversal changes
    relative order only WITHIN the segment, so it's the one thing a plain
    TSP 2-opt doesn't need to check). NOT exact -- a local optimum only, with
    no global guarantee -- so `max_passes` is a hard, explicit cap: each pass
    is O(L^3) (O(L^2) candidate swaps x O(L) precedence check), so total work
    is bounded by O(max_passes * L^3) no matter how many improving moves a
    pathological instance might otherwise offer (deterministic-fallback
    guardrail, same discipline as every heap/DP budget elsewhere in core/).
    """
    order_of_node: dict[int, tuple[str, int]] = {}
    for o in orders:
        order_of_node[o.pickup] = ("pickup", o.id)
        order_of_node[o.drop] = ("drop", o.id)

    L = len(route)
    for _ in range(max_passes):
        improved = False
        for i in range(1, L - 2):
            for j in range(i + 1, L - 1):
                old = dist_from[route[i - 1]][route[i]] + dist_from[route[j]][route[j + 1]]
                trial = route[:i] + route[i:j + 1][::-1] + route[j + 1:]
                new = dist_from[route[i - 1]][trial[i]] + dist_from[trial[j]][route[j + 1]]
                if new < old - 1e-9 and _precedence_ok(trial, order_of_node):
                    route = trial
                    improved = True
                    if tracer is not None:
                        tracer.emit("twoopt", "swap", i=i, j=j, delta=round(new - old, 2))
        if not improved:
            break
    return route


def sequence(
    depot: int, orders: list[Order], dist_from: dict[int, list[float]],
    mode: str = "auto", tracer: Tracer | None = None,
) -> list[int]:
    """Full route: [depot, ...stops..., depot]. Picks Held-Karp when it's
    safe to, else cheapest-insertion + 2-opt. `mode` in {"auto","held_karp",
    "insertion_2opt"} -- "held_karp" still silently falls back once the stop
    count exceeds HELD_KARP_MAX_STOPS: that cap is a correctness/safety
    guardrail against an exponential blow-up, not a preference, so an
    explicit request can't override it.
    """
    if not orders:
        return [depot, depot]
    stop_count = 2 * len(orders)
    if mode in ("auto", "held_karp") and stop_count <= HELD_KARP_MAX_STOPS:
        return [depot] + held_karp(depot, orders, dist_from, tracer) + [depot]
    route = cheapest_insertion(depot, orders, dist_from, tracer)
    return two_opt(route, orders, dist_from, tracer=tracer)
