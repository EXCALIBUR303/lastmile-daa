"""Solver orchestration.

=============================================================================
 STEP 5 STATE.

 REAL now:    S1 build + validate + a TRACED Bellman-Ford negative-cost-cycle
              guard (on `cost`, from node 0 -- validate() already guarantees
              connectivity, so one source sees every edge). INFORMATIONAL,
              not a rejection: a typical instance has m-n+1 independent
              cycles, so even a modest subsidy fraction usually makes some
              cycle net negative (~65% of seeds at defaults, measured), and
              routing never optimises on `cost` -- every path is chosen by
              `tau`, cost is only summed along an already-fixed route. So
              this is a real, worth-surfacing modelling fact, not a routing
              failure; see metrics.negative_cost_cycle.
              S2 metric closure -- `cfg.apsp` picks how: "dijkstra" (Step 3,
              targeted per-source), "floyd" (Floyd-Warshall, full n x n),
              or "johnson" (Bellman-Ford potentials + Dijkstra x n). All three
              feed the identical `dist_from` / `path_for` interface the
              simulation walk below uses, so switching modes never touches
              the walk itself.
              Route cost (not just time) is now tracked per vehicle, using
              the graph's directional cost -- net_profit = total_profit -
              total_cost is reported alongside the (harmless) cycle flag.
              S3 zoning -- `cfg.zoning` picks "prim", "kruskal" (both: MST
              over the stop-closure graph, cut into len(vehicles) zones by
              removing the k-1 heaviest edges -- exactly single-linkage
              clustering), or "none" (the original round-robin, kept as an
              explicit baseline to contrast against). Orders are zoned by
              PICKUP node. Each zone's kept forest weight is reported as
              VehiclePlan.mst_lower_bound -- a real TSP lower bound (see
              mst.py) for the tour that zone's vehicle is about to attempt.

 STILL FAKE:  S4 selection (EDD + take-while-capacity, not DP -- Step 6).
              S5 sequencing (visit selected orders in EDD order, no route
              optimisation -- Step 7).
              S7 repair (an infeasible vehicle is just reported infeasible,
              nothing is dropped and retried -- Step 7).
=============================================================================
"""
from __future__ import annotations

import math
import time
from typing import Callable

from app.core.apsp import floyd_warshall, johnson, reconstruct_path_fw
from app.core.bellman import bellman_ford
from app.core.graph import Graph
from app.core.mst import cut_k_zones, kruskal, mst_total_weight, prim, stop_closure
from app.core.sssp import dijkstra, reconstruct_path
from app.core.trace import Tracer
from app.models import (
    ApspMatrix, Instance, Metrics, SolveConfig, SolveResult, StopVisit, VehiclePlan,
)

STUB = True

PathFn = Callable[[int, int], list[int]]


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

    # -- S3: MST-based zoning (Step 5), or the Step 1 round-robin fallback
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

    for veh in inst.vehicles:
        zone = zones[veh.id]
        tracer.emit("sim", "vehicle_start", vehicle=veh.id, zone=zone, capacity=veh.capacity)

        # -- S4 placeholder: EDD + take-while-capacity (Step 6 replaces with DP)
        selected: list[int] = []
        load_budget = veh.capacity
        for oid in sorted(zone, key=lambda i: orders[i].deadline):
            if orders[oid].qty <= load_budget:
                selected.append(oid)
                load_budget -= orders[oid].qty

        # -- Step 5 Phase B: TSP lower bound over exactly what's selected
        #    (None when zoning="none", or when nothing was selected).
        mst_lower_bound: float | None = None
        if cfg.zoning != "none" and selected:
            bound_stops = sorted(
                {veh.depot} | {orders[i].pickup for i in selected} | {orders[i].drop for i in selected}
            )
            bound_edges = stop_closure(dist_from, bound_stops)
            bound_mst = zoning_mst_algo(bound_stops, bound_edges, None)
            mst_lower_bound = mst_total_weight(bound_mst)

        # -- S6: feasibility walk over REAL shortest-path legs and REAL paths.
        clock = veh.shift_start
        load = 0
        peak = 0
        travel = 0.0
        profit = 0.0
        cur = veh.depot
        route = [veh.depot]
        visits = [StopVisit(node=veh.depot, action="depart_depot", arrive=clock,
                            depart=clock, load=0)]

        for oid in selected:
            o = orders[oid]
            # leg to pickup
            dt = dist_from[cur][o.pickup]
            _extend_route(route, path_for, cur, o.pickup)
            clock += dt
            travel += dt
            load += o.qty
            peak = max(peak, load)
            clock += o.service / 2
            cur = o.pickup
            visits.append(StopVisit(node=cur, order_id=oid, action="pickup",
                                    arrive=round(clock - o.service / 2, 2),
                                    depart=round(clock, 2), load=load))
            tracer.emit("sim", "pickup", vehicle=veh.id, order=oid, node=cur,
                        clock=round(clock, 2), load=load)

            # leg to drop
            dt = dist_from[cur][o.drop]
            _extend_route(route, path_for, cur, o.drop)
            clock += dt
            travel += dt
            arrive = round(clock, 2)
            late = arrive > o.deadline
            load -= o.qty
            clock += o.service / 2
            cur = o.drop
            visits.append(StopVisit(node=cur, order_id=oid, action="drop", arrive=arrive,
                                    depart=round(clock, 2), load=load,
                                    slack=round(o.deadline - arrive, 2), late=late))
            tracer.emit("sim", "deadline_miss" if late else "drop", vehicle=veh.id,
                        order=oid, node=cur, clock=arrive, deadline=o.deadline,
                        slack=round(o.deadline - arrive, 2))
            if not late:
                profit += o.profit
                served.add(oid)

        dt = dist_from[cur][veh.depot]
        _extend_route(route, path_for, cur, veh.depot)
        clock += dt
        travel += dt
        cur = veh.depot
        visits.append(StopVisit(node=veh.depot, action="return_depot", arrive=round(clock, 2),
                                depart=round(clock, 2), load=0))
        tracer.emit("sim", "vehicle_end", vehicle=veh.id, clock=round(clock, 2),
                    travel=round(travel, 2), profit=round(profit, 2))

        # Directional cost along the ACTUAL path driven (Step 4).
        travel_cost = sum(g.cost_of(a, b) for a, b in zip(route, route[1:]))

        plans.append(VehiclePlan(
            vehicle_id=veh.id, zone=zone, selected=selected, route=route, visits=visits,
            profit=round(profit, 2), travel_time=round(travel, 2),
            travel_cost=round(travel_cost, 2), peak_load=peak,
            mst_lower_bound=round(mst_lower_bound, 2) if mst_lower_bound is not None else None,
            feasible=clock <= veh.shift_end and not any(v.late for v in visits),
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
        dp_bound=None,          # arrives in Step 6
        bound_gap_pct=None,
        runtime_ms=round((time.perf_counter() - t0) * 1000, 3),
        ops=tracer.op_counts,
    )
    result = SolveResult(
        plans=plans,
        unserved=sorted(set(orders) - set(committed)),
        metrics=metrics,
    )
    return result, apsp_export
