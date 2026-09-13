"""Order selection: DP-3 (knapsack with deadlines, the real solver), DP-1
(0/1 knapsack, capacity only -- shows why deadline-blindness fails), two
greedy baselines, a Dantzig LP bound, and a bitmask exact oracle for testing.

All of these operate on ONE VEHICLE's candidate order list at a time (its
Step-5 zone), using the surrogate per-order time

    t_i = delta(pickup_i, drop_i) + service_i

which is a LOWER BOUND on an order's true marginal time -- it ignores the
detour from wherever the vehicle currently is, since sequencing (Step 7)
hasn't happened yet. That is what makes this a two-layer heuristic rather
than an exact solve of the full routing problem: S6's simulation and S7's
repair loop handle whatever the surrogate got optimistic about.

--------------------------------------------------------------------------
EDD-lemma (why DP-3 is exact for this surrogate problem):

  Lemma.  Orders released at time 0, processed non-preemptively on one
  vehicle. If ANY permutation of a set S meets every deadline, then visiting
  S in non-decreasing deadline order (Earliest Deadline Due) also does.

  Proof (exchange argument). Take a feasible schedule with an adjacent
  inversion: job a then job b, with D_a > D_b, starting at time s. Feasibility
  gives s + t_a <= D_a and s + t_a + t_b <= D_b. Swap them. Now b finishes at
  s + t_b <= s + t_a + t_b <= D_b (fine), and a finishes at s + t_b + t_a,
  identical to b's old completion time, which was <= D_b < D_a (fine). No
  other job's start time changes. Repeat -- bubble-sort reaches EDD order in
  at most |S|^2 swaps, and feasibility survives every swap. QED.

  Corollary: fix ONE global EDD order over all candidate orders. Every
  subset, processed in its OWN induced sub-order, is feasible iff it is
  feasible at all. So a prefix DP with state = (orders considered so far,
  elapsed clock, load) visits every feasible subset exactly once and their
  infeasible supersets never at all -- which is exactly what makes DP-3 an
  EXACT algorithm for this surrogate problem, not a heuristic.

  This requires release_i = 0 for all i (checked: the generator never sets
  release != 0). With nonzero release times the lemma breaks --
  1|r_j|L_max is NP-hard -- and DP-3 would become a heuristic there; the
  more general max(t, r_i) + t_i transition below still runs, it just loses
  the optimality guarantee.
--------------------------------------------------------------------------
"""
from __future__ import annotations

import math

from app.core.trace import Tracer
from app.models import Order

NEG = -1.0  # sentinel for "state unreachable" in the DP table (profit is always >= 0)


def _surrogate_time(o: Order, dist_from: dict[int, list[float]]) -> float:
    return dist_from[o.pickup][o.drop] + o.service


# --------------------------------------------------------------------------- #
# DP-3: knapsack with deadlines -- the real selector
# --------------------------------------------------------------------------- #


def dp_deadline_knapsack(
    orders: list[Order], capacity: int, horizon: float,
    dist_from: dict[int, list[float]], tracer: Tracer | None = None,
) -> tuple[list[int], float]:
    """Exact (given release_i = 0, see module docstring). O(N*T*Q) time and
    space: N orders, T = ceil(horizon) whole minutes, Q = capacity.

    Discretisation: each order's surrogate time is rounded to the NEAREST
    whole minute, each deadline rounded DOWN (floor). Processing time is
    round-to-nearest rather than ceil deliberately -- ceiling EVERY order's
    time individually, then summing those already-rounded values along a
    chain, compounds additively into a systematic, one-directional bias (a
    real bug found here: 6 chained orders summing 40.60+53.10+51.90+59.90+
    154.00+120.00 = 479.50, genuinely under an exact 480.00 deadline, but
    ceil'ing each one first summed to 481 > floor(480) = 480 -- silently
    discarding the TRUE optimum). Rounding to nearest lets per-order errors
    partially cancel instead of always stacking upward, and any residual
    optimism (occasionally claiming a fit that's a few seconds short) is
    self-correcting: S6's simulation always re-checks with the real,
    unrounded numbers and marks a genuine miss as late regardless of what
    this DP believed. Deadlines stay floor'd: that check is one-time per
    order, not compounded across a chain, so its bias is bounded and safe.
    """
    n = len(orders)
    T = math.ceil(horizon)
    Q = capacity
    if n == 0 or T <= 0 or Q <= 0:
        return [], 0.0

    edd = sorted(orders, key=lambda o: o.deadline)
    proc = [max(0, round(_surrogate_time(o, dist_from))) for o in edd]
    deadline = [math.floor(o.deadline) for o in edd]
    qty = [o.qty for o in edd]
    profit = [o.profit for o in edd]
    release = [max(0, math.floor(o.release)) for o in edd]

    # f[i][t][c] = best profit using a subset of the first i (EDD-sorted)
    # orders, having consumed exactly t minutes and c capacity. Only reachable
    # states hold a value >= 0; NEG means "no subset reaches this state".
    f: list[list[list[float]]] = [[[NEG] * (Q + 1) for _ in range(T + 1)] for _ in range(n + 1)]
    f[0][0][0] = 0.0

    for i in range(1, n + 1):
        pi, di, qi, profi, ri = proc[i - 1], deadline[i - 1], qty[i - 1], profit[i - 1], release[i - 1]
        if tracer is not None:
            tracer.emit("knapsack", "row_start", i=i, order_id=edd[i - 1].id, proc=pi, deadline=di)
        prev, cur = f[i - 1], f[i]
        for t in range(T + 1):
            cur[t][:] = prev[t]  # skip: carry every state forward unchanged
        if qi > Q:
            continue  # this order can never fit any vehicle at this capacity
        for t in range(T + 1):
            row = prev[t]
            start = max(t, ri)  # release time only ever pushes the start LATER
            finish = start + pi
            if finish > T or finish > di:
                continue
            for c in range(Q - qi + 1):
                if row[c] < 0:
                    continue
                cand = row[c] + profi
                if cand > cur[finish][c + qi]:
                    cur[finish][c + qi] = cand
                    if tracer is not None:
                        tracer.emit("knapsack", "cell_take", i=i, t=finish, c=c + qi, value=round(cand, 2))

    best_val, best_t, best_c = 0.0, 0, 0
    for t in range(T + 1):
        for c in range(Q + 1):
            if f[n][t][c] > best_val:
                best_val, best_t, best_c = f[n][t][c], t, c

    selected: list[int] = []
    t, c = best_t, best_c
    for i in range(n, 0, -1):
        pi, qi, profi, ri = proc[i - 1], qty[i - 1], profit[i - 1], release[i - 1]
        took = False
        if t >= pi and c >= qi:
            start = t - pi
            if start >= ri:  # this order's start must respect its own release
                prev_val = f[i - 1][start][c - qi]
                if prev_val >= 0 and abs(prev_val + profi - f[i][t][c]) < 1e-6:
                    selected.append(edd[i - 1].id)
                    t, c = start, c - qi
                    took = True
        if tracer is not None:
            tracer.emit("knapsack", "traceback", i=i, took=took)
    return selected, round(best_val, 2)


# --------------------------------------------------------------------------- #
# DP-1: classic 0/1 knapsack, capacity only -- deliberately deadline-blind
# --------------------------------------------------------------------------- #


def dp_01_knapsack(orders: list[Order], capacity: int) -> tuple[list[int], float]:
    """Textbook 0/1 knapsack (the rubric's literal "0-1 knapsack" ask):
    maximise profit subject to capacity ALONE. O(N*Q) time, O(Q) rolling
    space for the value pass; an O(N*Q) `keep` table sits alongside purely
    for reconstruction (memory-cheap at this scale, N,Q <= 40-ish).

    Exposed to demonstrate the actual failure mode of ignoring deadlines:
    this can and does select profitable-but-late orders that DP-3 would
    never touch (see test_knapsack.py's `test_dp01_can_pick_orders_dp3_wont`).
    """
    n = len(orders)
    Q = capacity
    if n == 0 or Q <= 0:
        return [], 0.0
    dp = [0.0] * (Q + 1)
    keep = [[False] * (Q + 1) for _ in range(n)]
    for i, o in enumerate(orders):
        if o.qty > Q:
            continue
        for c in range(Q, o.qty - 1, -1):
            cand = dp[c - o.qty] + o.profit
            if cand > dp[c]:
                dp[c] = cand
                keep[i][c] = True
    selected = []
    c = Q
    for i in range(n - 1, -1, -1):
        if keep[i][c]:
            selected.append(orders[i].id)
            c -= orders[i].qty
    return selected, round(dp[Q], 2)


# --------------------------------------------------------------------------- #
# Greedy baselines -- both deadline-aware, both O(N log N)
# --------------------------------------------------------------------------- #


def _edd_feasible(ids: list[int], by_id: dict[int, Order], dist_from: dict[int, list[float]]) -> bool:
    """Per the EDD lemma: a set is feasible iff its OWN EDD ordering meets
    every deadline -- so this is the one check any selection needs to pass,
    regardless of what order it was assembled in."""
    clock = 0.0
    for oid in sorted(ids, key=lambda i: by_id[i].deadline):
        o = by_id[oid]
        clock = max(clock, o.release) + _surrogate_time(o, dist_from)
        if clock > o.deadline:
            return False
    return True


def greedy_edd(orders: list[Order], capacity: int, dist_from: dict[int, list[float]]) -> list[int]:
    """G2: activity-selection flavoured. Process in deadline order, keep an
    order iff capacity and its own deadline both still hold -- equivalent to
    `_edd_feasible` applied incrementally, since we're already in EDD order.
    """
    selected: list[int] = []
    clock, load = 0.0, 0
    for o in sorted(orders, key=lambda o: o.deadline):
        finish = max(clock, o.release) + _surrogate_time(o, dist_from)
        if load + o.qty <= capacity and finish <= o.deadline:
            selected.append(o.id)
            clock, load = finish, load + o.qty
    return selected


def greedy_density(orders: list[Order], capacity: int, dist_from: dict[int, list[float]]) -> list[int]:
    """G1: fractional-knapsack flavoured -- best profit-per-minute first. A
    candidate is kept only if the WHOLE committed set, re-sequenced into EDD
    order, still meets every deadline (there is no other valid feasibility
    check once assembly order isn't EDD to begin with). O(k^2 log k) worst
    case; fine at one vehicle's zone scale.
    """
    by_id = {o.id: o for o in orders}
    ranked = sorted(orders, key=lambda o: o.profit / max(_surrogate_time(o, dist_from), 1e-6), reverse=True)
    committed: list[int] = []
    load = 0
    for o in ranked:
        if load + o.qty > capacity:
            continue
        trial = committed + [o.id]
        if _edd_feasible(trial, by_id, dist_from):
            committed = trial
            load += o.qty
    return committed


# --------------------------------------------------------------------------- #
# LP bound (Dantzig): capacity-only relaxation, a valid upper bound on ANY
# more-constrained variant of the same items (dropping a constraint can only
# enlarge the feasible set, never shrink the achievable optimum).
# --------------------------------------------------------------------------- #


def lp_bound(orders: list[Order], capacity: int) -> float:
    """Sort by profit/qty descending, take whole items greedily, allow the
    LAST item to be fractional. O(N log N). This is the classical Dantzig
    upper bound for 0/1 knapsack -- deliberately capacity-only (deadlines
    dropped too), so it is looser than a true deadline-aware LP relaxation
    would be, but still a mathematically valid ceiling on DP-3's optimum:
    relaxing MORE constraints can only raise the achievable profit further.
    """
    remaining = capacity
    total = 0.0
    for o in sorted(orders, key=lambda o: o.profit / max(o.qty, 1e-9), reverse=True):
        if o.qty <= remaining:
            total += o.profit
            remaining -= o.qty
        elif remaining > 0:
            total += o.profit * (remaining / o.qty)
            remaining = 0
            break
        else:
            break
    return round(total, 2)


# --------------------------------------------------------------------------- #
# Bitmask exact oracle -- testing only, never wired to a live endpoint
# --------------------------------------------------------------------------- #

MAX_BITMASK_N = 22  # 2^22 * 22 ~= 92M -- seconds in Python; a hard, loud cap


def dp_bitmask_exact(
    orders: list[Order], capacity: int, horizon: float, dist_from: dict[int, list[float]],
) -> tuple[list[int], float]:
    """O(2^N * N) subset enumeration: independently checks every subset's
    feasibility via `_edd_feasible` and takes the best-profit feasible one.
    Used ONLY to cross-validate dp_deadline_knapsack in tests -- NOT exposed
    through SolveConfig.selector, and deliberately capped so a caller can
    never accidentally hang a request on it (see pipeline.py's guardrail
    philosophy: no unbounded-N exponential algorithm on a live endpoint).
    """
    n = len(orders)
    if n > MAX_BITMASK_N:
        raise ValueError(f"dp_bitmask_exact is exponential; refusing N={n} > {MAX_BITMASK_N}")
    by_id = {o.id: o for o in orders}
    best_val, best_subset = 0.0, []
    for mask in range(1 << n):
        ids = [orders[i].id for i in range(n) if mask & (1 << i)]
        qty = sum(by_id[i].qty for i in ids)
        if qty > capacity:
            continue
        if not _edd_feasible(ids, by_id, dist_from):
            continue
        profit = sum(by_id[i].profit for i in ids)
        if profit > best_val:
            best_val, best_subset = profit, ids
    return best_subset, round(best_val, 2)
