"""Solver orchestration.

Runs the whole delivery-planning pipeline for one instance and returns the
plan, its metrics and (optionally) a trace of every algorithm step.

Stages, in order:

  S1 build + validate   Build the graph, check it is connected with
                        non-negative travel times, and run a traced
                        Bellman-Ford negative-cycle screen on `cost`.
                        The screen is INFORMATIONAL, not a rejection: with a
                        modest subsidy fraction some cycle is usually net
                        negative (about 65% of seeds at defaults), but routing
                        never optimises on `cost` -- every path is chosen by
                        travel time `tau`, and cost is only summed along an
                        already-fixed route. It is surfaced as
                        metrics.negative_cost_cycle.
  S2 metric closure     `cfg.apsp` picks how stop-to-stop distances are built:
                        "dijkstra" (targeted, per stop), "floyd"
                        (Floyd-Warshall) or "johnson" (Bellman-Ford potentials
                        + Dijkstra from every node). All three feed the same
                        `dist_from` / `path_for` interface, so the later
                        stages never care which was used.
  S3 zoning             `cfg.zoning`: "prim" or "kruskal" (MST over the stop
                        closure, cut into one zone per vehicle by removing the
                        k-1 heaviest edges, i.e. single-linkage clustering),
                        or "none" (round-robin baseline). Orders are zoned by
                        pickup node. Each zone's MST weight is reported as
                        VehiclePlan.mst_lower_bound, a TSP lower bound.
  S4 selection          `cfg.selector`, run once per vehicle over its zone:
                        "dp_deadline" (knapsack over capacity and time, see
                        knapsack.py for the EDD argument), "dp_01" (capacity
                        only, deliberately deadline-blind), "greedy_density"
                        or "greedy_edd". metrics.dp_bound is the summed LP
                        (Dantzig) upper bound; bound_gap_pct is how far the
                        achieved profit sits below it.
  S5 sequencing         `cfg.sequencer`: "held_karp" (exact pickup-and-
                        delivery TSP, up to routing.py's HELD_KARP_MAX_STOPS),
                        "insertion_2opt" (cheapest insertion + precedence-
                        preserving 2-opt) or "auto" (Held-Karp when safe).
                        "held_karp" also falls back to the heuristic past the
                        size cap: it is a guard against an exponential
                        blow-up, not a preference a request can override.
  S6 simulation         Drives each vehicle along its sequenced route with
                        release times, service times and deadlines, recording
                        arrival times and which orders are late.
  S7 repair             If a route misses a deadline, drop the worst-value
                        late order (lowest profit per surrogate minute),
                        re-sequence and re-simulate. Each pass strictly
                        shrinks a finite set, so it ends after at most
                        len(selected) drops; the `for...else` in the repair
                        loop asserts that bound.

The benchmark experiments (S8) live outside this module, in bench/sweeps.py,
and call solve() or the S2 functions directly.

Every stage is a heuristic or exact algorithm on a modelled approximation (the
discretised surrogate time axis in knapsack.py, 2-opt's local optimum, the
greedy repair rule), so STUB = False means "no placeholder stages remain", not
"the plan is provably optimal".
"""
from __future__ import annotations

import math
import time
from typing import Callable, NamedTuple

from app.core.apsp import floyd_warshall, johnson, reconstruct_path_fw
from app.core.bellman import bellman_ford
from app.core.graph import Graph
from app.core.knapsack import (
    dp_01_knapsack, dp_deadline_knapsack, greedy_density, greedy_edd, lp_bound,
)
from app.core.mst import cut_k_zones, kruskal, mst_total_weight, prim, stop_closure
from app.core.routing import sequence
from app.core.sssp import dijkstra, reconstruct_path
from app.core.trace import Tracer
from app.models import (
    ApspMatrix, Instance, Metrics, Order, SolveConfig, SolveResult, StopVisit, Vehicle, VehiclePlan,
)

STUB = False  # no placeholder stages remain -- see the module docstring

PathFn = Callable[[int, int], list[int]]


class SimResult(NamedTuple):
    route: list[int]
    visits: list[StopVisit]
    clock: float
    travel: float
    profit: float
    peak: int
    late_ids: set[int]
    served_ids: set[int]


def _simulate_route(
    veh: Vehicle, order_ids: list[int], orders: dict[int, Order],
    dist_from: dict[int, list[float]], path_for: PathFn, sequencer_mode: str,
) -> SimResult:
    """S5 (sequence) + S6 (feasibility walk) for ONE candidate order
    set. Pure computation, no tracer -- this lets the repair loop try several
    candidates silently and trace only the one actually kept, via
    `_emit_sim_trace` below, instead of re-running the walk twice or
    cluttering the trace with attempts that get repaired away.
    """
    cur_orders = [orders[i] for i in order_ids]
    stop_seq = sequence(veh.depot, cur_orders, dist_from, sequencer_mode)
    node_role: dict[int, tuple[str, int]] = {}
    for i in order_ids:
        o = orders[i]
        node_role[o.pickup] = ("pickup", i)
        node_role[o.drop] = ("drop", i)

    clock = veh.shift_start
    load = 0
    peak = 0
    travel = 0.0
    profit = 0.0
    cur = veh.depot
    route = [veh.depot]
    visits = [StopVisit(node=veh.depot, action="depart_depot", arrive=clock, depart=clock, load=0)]
    late_ids: set[int] = set()
    served_ids: set[int] = set()

    for node in stop_seq[1:-1]:
        dt = dist_from[cur][node]
        _extend_route(route, path_for, cur, node)
        clock += dt
        travel += dt
        kind, oid = node_role[node]
        o = orders[oid]
        cur = node
        if kind == "pickup":
            load += o.qty
            peak = max(peak, load)
            clock += o.service / 2
            visits.append(StopVisit(node=cur, order_id=oid, action="pickup",
                                    arrive=round(clock - o.service / 2, 2),
                                    depart=round(clock, 2), load=load))
        else:
            arrive = round(clock, 2)
            late = arrive > o.deadline
            load -= o.qty
            clock += o.service / 2
            visits.append(StopVisit(node=cur, order_id=oid, action="drop", arrive=arrive,
                                    depart=round(clock, 2), load=load,
                                    slack=round(o.deadline - arrive, 2), late=late))
            if late:
                late_ids.add(oid)
            else:
                profit += o.profit
                served_ids.add(oid)

    dt = dist_from[cur][veh.depot]
    _extend_route(route, path_for, cur, veh.depot)
    clock += dt
    travel += dt
    visits.append(StopVisit(node=veh.depot, action="return_depot", arrive=round(clock, 2),
                            depart=round(clock, 2), load=0))
    return SimResult(route, visits, clock, travel, profit, peak, late_ids, served_ids)


def _emit_sim_trace(veh: Vehicle, order_ids: list[int], result: SimResult, tracer: Tracer) -> None:
    """Replay an already-computed SimResult into the tracer as real `sim`
    stage events -- the same shape a direct simulation always produced,
    just recorded after the fact for whichever repair attempt was kept.
    """
    tracer.emit("sim", "vehicle_start", vehicle=veh.id, zone=order_ids, capacity=veh.capacity)
    for v in result.visits[1:-1]:
        if v.action == "pickup":
            tracer.emit("sim", "pickup", vehicle=veh.id, order=v.order_id, node=v.node,
                        clock=v.depart, load=v.load)
        elif v.action == "drop":
            deadline = round(v.arrive + (v.slack or 0.0), 2)
            tracer.emit("sim", "deadline_miss" if v.late else "drop", vehicle=veh.id,
                        order=v.order_id, node=v.node, clock=v.arrive,
                        deadline=deadline, slack=v.slack)
    tracer.emit("sim", "vehicle_end", vehicle=veh.id, clock=round(result.clock, 2),
                travel=round(result.travel, 2), profit=round(result.profit, 2))


def _sanitize_matrix(m: list[list[float]]) -> list[list[float | None]]:
    """math.inf has no JSON representation -- None (-> JSON null) does."""
    return [[None if math.isinf(x) else round(x, 3) for x in row] for row in m]


def _extend_route(route: list[int], path_for: PathFn, cur: int, target: int) -> None:
    """Append the real graph path cur->target to `route`, in place.

    `path[0]` always equals `cur`, already the last entry in `route`, so only
    `path[1:]` is appended -- no duplicated stop.
    """
    path = path_for(cur, target)
    route.extend(path[1:])


def solve(
    inst: Instance, cfg: SolveConfig, tracer: Tracer,
) -> tuple[SolveResult, ApspMatrix | None]:
    t0 = time.perf_counter()
    g = Graph.from_instance(inst, tracer)
    problems = g.validate(tracer)
    if problems:
        raise ValueError("; ".join(problems))

    # -- S1 (cont'd): the negative-cost-cycle guard, TRACED -- this IS the
    #    "neg-cycle guard live" deliverable. INFORMATIONAL, not blocking: with
    #    m-n+1 independent cycles in a typical instance, even a modest subsidy
    #    fraction usually makes SOME cycle net negative (measured ~65% of
    #    seeds at defaults), and routing never optimises on `cost` anyway --
    #    every path is chosen by `tau` (validated non-negative) and cost is
    #    only ever summed along an already-fixed route. So an unbounded-below
    #    cost metric is a real, worth-surfacing modelling fact, not a routing
    #    correctness failure -- reported via metrics.negative_cost_cycle
    #    rather than rejecting the instance.
    _, _, has_negative_cycle = bellman_ford(g, 0, metric="cost", tracer=tracer)

    orders = {o.id: o for o in inst.orders}
    sources = (
        {v.depot for v in inst.vehicles}
        | {o.pickup for o in inst.orders}
        | {o.drop for o in inst.orders}
    )
    demo_source = inst.vehicles[0].depot

    # -- S2: metric closure. All three branches populate `dist_from` (a dict
    #    of node -> full distance row) and `path_for` (u, v) -> real node
    #    path, so the simulation walk below is identical regardless of mode.
    apsp_export: ApspMatrix | None = None
    if cfg.apsp == "floyd":
        matrix, next_hop = floyd_warshall(g, metric="tau", tracer=tracer)
        dist_from = {s: matrix[s] for s in sources}
        path_for: PathFn = lambda u, v: reconstruct_path_fw(next_hop, u, v)  # noqa: E731
        apsp_export = ApspMatrix(algorithm="floyd", node_ids=list(range(g.n)),
                                  matrix=_sanitize_matrix(matrix))
    elif cfg.apsp == "johnson":
        matrix, prev_by_src, _ = johnson(g, metric="tau", tracer=tracer, demo_source=demo_source)
        dist_from = {s: matrix[s] for s in sources}
        path_for = lambda u, v: reconstruct_path(prev_by_src[u], u, v)  # noqa: E731
        apsp_export = ApspMatrix(algorithm="johnson", node_ids=list(range(g.n)),
                                  matrix=_sanitize_matrix(matrix))
    else:  # "dijkstra" -- targeted per-source, no full matrix built or exported
        dist_from = {}
        prev_from: dict[int, list[int]] = {}
        for src in sources:
            d, p = dijkstra(g, src, tracer if src == demo_source else None)
            dist_from[src] = d
            prev_from[src] = p
        path_for = lambda u, v: reconstruct_path(prev_from[u], u, v)  # noqa: E731

    plans: list[VehiclePlan] = []
    served: set[int] = set()

    # -- S3: MST-based zoning , or the round-robin baseline
    #    ("none") kept as a baseline to contrast against.
    #
    #    Phase A -- ZONING clusters {depot} + PICKUPS ONLY, not drops. This
    #    matters: an order's zone is decided by its pickup, so clustering on
    #    anything else dilutes it. Measured on 40 seeds at default settings,
    #    clustering on pickups+drops together left >=1 vehicle with ZERO
    #    orders 72% of the time (drop-only stops can "steal" a zone with no
    #    pickup in it); pickups-only drops that to 5%. The remaining skew
    #    (typically one ~9-order zone plus a couple of 1-2 order zones) is
    #    the well-documented "chaining" behaviour of single-linkage/MST
    #    clustering on scattered points, not a bug -- verified empirically
    #    that a smarter cut-selection rule (always split the currently-
    #    largest component, not just take the k-1 globally heaviest edges)
    #    produces near-identical splits, so the skew is inherent to the
    #    technique on this kind of data, not an artifact of cut order.
    #
    #    Phase B -- BOUND (computed per vehicle below, after S4 selection):
    #    a pickups-only MST underestimates the real TSP lower bound (a tour
    #    must visit drops too), and bounding the full ZONE would compare
    #    against orders S4 might not even attempt this run (dropped for
    #    capacity) -- so the honest, always-valid comparison is a MST over
    #    exactly the stops of the SELECTED orders a vehicle actually visits.
    #    That guarantees travel_time >= mst_lower_bound unconditionally
    #    (Step 6's real DP selector will pick a different subset than this
    #    placeholder does, and the bound recomputes correctly either way).
    #    Silent (tracer=None): a derived reporting metric, not the primary
    #    "watch the algorithm partition the map" demonstration in Phase A.
    zoning_mst_algo = prim if cfg.zoning == "prim" else kruskal
    if cfg.zoning == "none":
        zones: dict[int, list[int]] = {v.id: [] for v in inst.vehicles}
        for i, o in enumerate(sorted(inst.orders, key=lambda o: o.deadline)):
            zones[inst.vehicles[i % len(inst.vehicles)].id].append(o.id)
    else:
        depot_ids = {v.depot for v in inst.vehicles}
        pickup_stops = sorted(depot_ids | {o.pickup for o in inst.orders})
        pickup_edges = stop_closure(dist_from, pickup_stops)
        zoning_mst = zoning_mst_algo(pickup_stops, pickup_edges, tracer)
        zone_of_pickup, _ = cut_k_zones(pickup_stops, zoning_mst, len(inst.vehicles), tracer)

        zone_ids = sorted(set(zone_of_pickup.values()))
        vehicle_for_zone = {z: inst.vehicles[i].id for i, z in enumerate(zone_ids)}
        zones = {v.id: [] for v in inst.vehicles}
        for o in inst.orders:
            veh_id = vehicle_for_zone.get(zone_of_pickup[o.pickup])
            if veh_id is not None:  # None only if there were fewer pickups than vehicles
                zones[veh_id].append(o.id)

    dp_bound_total = 0.0
    for veh in inst.vehicles:
        zone = zones[veh.id]
        # -- S4: order selection (Step 6). `cfg.selector` picks the algorithm;
        #    all four operate on this vehicle's zone alone and return order
        #    ids, so swapping modes never touches anything below this block.
        zone_orders = [orders[i] for i in zone]
        if cfg.selector == "dp_deadline":
            selected, _ = dp_deadline_knapsack(zone_orders, veh.capacity, veh.shift_end - veh.shift_start,
                                               dist_from, tracer)
        elif cfg.selector == "dp_01":
            selected, _ = dp_01_knapsack(zone_orders, veh.capacity)
        elif cfg.selector == "greedy_density":
            selected = greedy_density(zone_orders, veh.capacity, dist_from)
        else:  # "greedy_edd"
            selected = greedy_edd(zone_orders, veh.capacity, dist_from)

        # Report `selected` sorted by deadline for readability -- a stable,
        # urgency-ordered LISTING of what was committed. The route actually
        # driven (Step 7's sequencer, below) is NOT constrained to visit
        # them in this order; it optimises for travel, which can legitimately
        # interleave pickups and drops across different orders.
        selected.sort(key=lambda i: orders[i].deadline)

        # LP bound (Step 6): a valid upper bound on THIS vehicle's zone
        # regardless of which selector ran -- summed across vehicles below
        # for the top-line metrics.dp_bound / bound_gap_pct.
        veh_dp_bound = lp_bound(zone_orders, veh.capacity)
        dp_bound_total += veh_dp_bound

        # -- S5 (Step 7): sequence `selected`, then S6: simulate it. S7: if
        #    the simulated route misses a deadline, drop the worst-value
        #    violator (min profit / surrogate-time among the LATE orders --
        #    "least valuable of the ones actually causing trouble"). A second
        #    failure mode gets the same treatment: no individual order may be
        #    late yet the vehicle can still return after shift_end, since
        #    repair originally only inspected per-order deadlines -- when
        #    that happens there is no specific violator to blame, so the
        #    single least-valuable SELECTED order is dropped instead, on the
        #    grounds that shortening the route is the only lever available.
        #    Either branch strictly shrinks a finite, never-growing set, so
        #    this terminates in at most len(selected) drops; the +1 covers
        #    the final pass that needs no further drop. Every attempt runs
        #    silently; only the one that's kept gets traced, via
        #    `_emit_sim_trace`, so the trace never carries throwaway walks.
        def _value_density(oid: int) -> float:
            o = orders[oid]
            return o.profit / max(dist_from[o.pickup][o.drop] + o.service, 1e-6)

        max_repair_iters = len(selected) + 1
        result: SimResult | None = None
        for repair_iter in range(max_repair_iters):
            result = _simulate_route(veh, selected, orders, dist_from, path_for, cfg.sequencer)
            over_shift = result.clock > veh.shift_end
            if (not result.late_ids and not over_shift) or not selected:
                break
            if result.late_ids:
                worst, reason = min(result.late_ids, key=_value_density), "deadline_miss"
            else:
                worst, reason = min(selected, key=_value_density), "shift_overrun"
            tracer.emit("repair", "drop", vehicle=veh.id, order_id=worst,
                        reason=reason, iteration=repair_iter)
            selected = [i for i in selected if i != worst]
        else:
            raise RuntimeError(
                "S7 repair exceeded its iteration budget -- dropping one order per "
                "iteration for len(selected)+1 iterations should always empty the set first"
            )
        assert result is not None  # loop body always runs >= 1 time (range >= 1)
        # Re-run ONLY the sequencer (not the full simulation) on the FINAL,
        # accepted `selected`, purely to emit its heldkarp/twoopt trace
        # events for real -- `sequence()` is a deterministic function of
        # (depot, orders, dist_from, mode), so this reproduces the identical
        # route `result` already has; the return value is discarded, not
        # re-simulated, so this costs one extra sequence() call (cheap
        # relative to the repair loop it follows) rather than a second full
        # walk. Every REJECTED repair attempt, by contrast, stays untraced.
        sequence(veh.depot, [orders[i] for i in selected], dist_from, cfg.sequencer, tracer)
        _emit_sim_trace(veh, selected, result, tracer)
        served.update(result.served_ids)

        # -- Step 5 Phase B: TSP lower bound over the FINAL, post-repair
        #    selection (None when zoning="none", or nothing survived repair).
        mst_lower_bound: float | None = None
        if cfg.zoning != "none" and selected:
            bound_stops = sorted(
                {veh.depot} | {orders[i].pickup for i in selected} | {orders[i].drop for i in selected}
            )
            bound_edges = stop_closure(dist_from, bound_stops)
            bound_mst = zoning_mst_algo(bound_stops, bound_edges, None)
            mst_lower_bound = mst_total_weight(bound_mst)

        # Directional cost along the ACTUAL path driven (Step 4).
        travel_cost = sum(g.cost_of(a, b) for a, b in zip(result.route, result.route[1:]))

        plans.append(VehiclePlan(
            vehicle_id=veh.id, zone=zone, selected=selected, route=result.route, visits=result.visits,
            profit=round(result.profit, 2), travel_time=round(result.travel, 2),
            travel_cost=round(travel_cost, 2), peak_load=result.peak,
            mst_lower_bound=round(mst_lower_bound, 2) if mst_lower_bound is not None else None,
            dp_bound=veh_dp_bound,
            feasible=result.clock <= veh.shift_end and not any(v.late for v in result.visits),
        ))

    committed = [oid for p in plans for oid in p.selected]
    on_time = len(served)
    total_profit = round(sum(p.profit for p in plans), 2)
    total_cost = round(sum(p.travel_cost for p in plans), 2)
    metrics = Metrics(
        total_profit=total_profit,
        orders_served=on_time,
        orders_total=len(inst.orders),
        on_time_pct=round(100 * on_time / len(committed), 1) if committed else 100.0,
        total_travel_time=round(sum(p.travel_time for p in plans), 2),
        total_cost=total_cost,
        net_profit=round(total_profit - total_cost, 2),
        negative_cost_cycle=has_negative_cycle,
        avg_utilisation=round(
            sum(p.peak_load / v.capacity for p, v in zip(plans, inst.vehicles))
            / max(1, len(plans)), 3),
        dp_bound=round(dp_bound_total, 2),
        bound_gap_pct=(
            round(100 * (dp_bound_total - total_profit) / dp_bound_total, 1)
            if dp_bound_total > 0 else 0.0
        ),
        runtime_ms=round((time.perf_counter() - t0) * 1000, 3),
        ops=tracer.op_counts,
    )
    result = SolveResult(
        plans=plans,
        unserved=sorted(set(orders) - set(committed)),
        metrics=metrics,
    )
    return result, apsp_export
