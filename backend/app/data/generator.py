"""Seeded synthetic instance generator.

Same seed -> byte-identical instance, on any machine.  That property is what
makes the Step-8 benchmark sweeps reproducible and the demo repeatable.

`density` is the knob that drives the Floyd-Warshall vs Johnson crossover
experiment: it sets m relative to n^2, which is exactly what separates
O(n^3) from O(nm + n^2 log n).
"""
from __future__ import annotations

import random
from math import cos, hypot, pi, sin

from app.models import Edge, GenerateRequest, Instance, Node, Order, Vehicle

TIME_SCALE = 120.0  # unit distance in [0,1] space -> minutes
COST_RATE = 1.2     # money per minute of travel


# --------------------------------------------------------------------------- #
# Topologies -- each returns positions plus a CONNECTED skeleton of edges
# --------------------------------------------------------------------------- #


def _radial(n: int, rng: random.Random) -> tuple[list[tuple[float, float]], set[tuple[int, int]]]:
    pos = [(0.5, 0.5)]
    rings: list[list[int]] = []
    idx = 1
    ring = 1
    while idx < n:
        count = min(n - idx, 5 + 3 * ring)
        r = 0.12 + 0.16 * ring
        members = []
        for k in range(count):
            a = 2 * pi * (k / count) + rng.uniform(-0.12, 0.12)
            rr = r * rng.uniform(0.88, 1.12)
            pos.append((0.5 + rr * cos(a), 0.5 + rr * sin(a)))
            members.append(idx)
            idx += 1
        rings.append(members)
        ring += 1
    skel: set[tuple[int, int]] = set()
    prev = [0]
    for members in rings:
        for i, u in enumerate(members):           # ring road
            v = members[(i + 1) % len(members)]
            if u != v:
                skel.add((min(u, v), max(u, v)))
        for u in members:                          # spoke to nearest inner node
            v = min(prev, key=lambda p: hypot(pos[u][0] - pos[p][0], pos[u][1] - pos[p][1]))
            skel.add((min(u, v), max(u, v)))
        prev = members
    return pos, skel


def _grid(n: int, rng: random.Random) -> tuple[list[tuple[float, float]], set[tuple[int, int]]]:
    cols = max(2, int(round(n ** 0.5)))
    rows = (n + cols - 1) // cols
    pos, skel = [], set()
    for i in range(n):
        r, c = divmod(i, cols)
        pos.append((0.08 + 0.84 * c / max(1, cols - 1) + rng.uniform(-0.02, 0.02),
                    0.08 + 0.84 * r / max(1, rows - 1) + rng.uniform(-0.02, 0.02)))
    for i in range(n):
        r, c = divmod(i, cols)
        if c + 1 < cols and i + 1 < n:
            skel.add((i, i + 1))
        if i + cols < n:
            skel.add((i, i + cols))
    return pos, skel


def _scale_free(n: int, rng: random.Random) -> tuple[list[tuple[float, float]], set[tuple[int, int]]]:
    pos = [(rng.random() * 0.9 + 0.05, rng.random() * 0.9 + 0.05) for _ in range(n)]
    skel, targets = set(), [0]
    for u in range(1, n):
        v = rng.choice(targets)                    # preferential attachment
        skel.add((min(u, v), max(u, v)))
        targets += [u, v]
    return pos, skel


_TOPOLOGIES = {"radial": _radial, "grid": _grid, "scale_free": _scale_free}


# --------------------------------------------------------------------------- #
# Generator
# --------------------------------------------------------------------------- #


def generate(req: GenerateRequest) -> Instance:
    if req.n_orders * 2 + 1 > req.n_nodes:
        raise ValueError(
            f"need at least {req.n_orders * 2 + 1} nodes for {req.n_orders} orders "
            f"(1 depot + 1 pickup + 1 drop each), got {req.n_nodes}"
        )
    rng = random.Random(req.seed)
    n = req.n_nodes
    pos, skel = _TOPOLOGIES[req.topology](n, rng)

    # -- densify: add geometrically plausible chords up to the target edge count
    m_target = int(n - 1 + req.density * n * (n - 1) / 2)
    pairs = sorted(
        ((hypot(pos[u][0] - pos[v][0], pos[u][1] - pos[v][1]), u, v)
         for u in range(n) for v in range(u + 1, n)),
        key=lambda t: t[0],
    )
    for _, u, v in pairs:
        if len(skel) >= m_target:
            break
        if (u, v) not in skel and rng.random() < 0.7:
            skel.add((u, v))

    # -- edges: tau always >= 0, same both directions. A minority of arcs
    #    carry a ONE-WAY subsidy (e.g. inbound-to-depot pricing): the subsidy
    #    direction gets a negative cost, the other direction pays the normal
    #    positive rate. The discount is capped at 0.96x the normal rate, so a
    #    round trip on any single edge always nets >= 0 -- a genuine negative
    #    cycle can only arise from several chained subsidies around a real
    #    multi-edge loop, which is what makes Bellman-Ford's guard meaningful
    #    instead of firing on every subsidised edge trivially (see Edge in
    #    models.py for the full reasoning).
    edges: list[Edge] = []
    for u, v in sorted(skel):
        d = hypot(pos[u][0] - pos[v][0], pos[u][1] - pos[v][1])
        tau = round(max(0.5, d * TIME_SCALE * rng.uniform(0.9, 1.25)), 1)
        base_cost = round(tau * COST_RATE, 2)
        cost_uv, cost_vu = base_cost, base_cost
        if rng.random() < req.neg_cost_frac:
            discount = -round(rng.uniform(0.4, 1.6) * tau * COST_RATE * 0.6, 2)
            if rng.random() < 0.5:
                cost_uv = discount
            else:
                cost_vu = discount
        edges.append(Edge(u=u, v=v, tau=tau, cost=cost_uv, cost_vu=cost_vu))

    # -- roles: node 0 is the depot, then n_orders pickups and n_orders drops
    others = list(range(1, n))
    rng.shuffle(others)
    pickups = others[: req.n_orders]
    drops = others[req.n_orders: 2 * req.n_orders]
    junctions = others[2 * req.n_orders:]

    nodes = [Node(id=0, x=pos[0][0], y=pos[0][1], kind="depot", label="DEPOT")]
    for i, u in enumerate(pickups):
        nodes.append(Node(id=u, x=pos[u][0], y=pos[u][1], kind="pickup", label=f"P{i}"))
    for i, u in enumerate(drops):
        nodes.append(Node(id=u, x=pos[u][0], y=pos[u][1], kind="drop", label=f"D{i}"))
    for u in junctions:
        nodes.append(Node(id=u, x=pos[u][0], y=pos[u][1], kind="junction", label=""))
    nodes.sort(key=lambda nd: nd.id)

    # -- orders: deadline is a multiple of the straight-line lower bound, so a
    #    tightness factor < ~1.5 is genuinely hard and > ~3 is slack.
    max_qty = max(1, req.capacity // 3)
    orders: list[Order] = []
    for i, (p, d) in enumerate(zip(pickups, drops)):
        direct = hypot(pos[p][0] - pos[d][0], pos[p][1] - pos[d][1]) * TIME_SCALE
        from_depot = hypot(pos[0][0] - pos[p][0], pos[0][1] - pos[p][1]) * TIME_SCALE
        service = round(rng.uniform(4, 12), 1)
        lower = from_depot + direct + service
        deadline = round(min(req.horizon, lower * rng.uniform(1.35, 3.2)), 1)
        qty = rng.randint(1, max_qty)
        profit = round(direct * rng.uniform(0.8, 1.9) + qty * rng.uniform(6, 18), 2)
        orders.append(Order(id=i, pickup=p, drop=d, release=0.0, deadline=deadline,
                            qty=qty, profit=profit, service=service))

    vehicles = [
        Vehicle(id=k, depot=0, capacity=req.capacity, shift_start=0.0, shift_end=req.horizon)
        for k in range(req.n_vehicles)
    ]

    return Instance(
        seed=req.seed, topology=req.topology, nodes=nodes, edges=edges,
        orders=orders, vehicles=vehicles,
        meta={
            "n": n, "m": len(edges),
            "density": round(2 * len(edges) / (n * (n - 1)), 4),
            "avg_degree": round(2 * len(edges) / n, 2),
            "negative_cost_edges": sum(1 for e in edges if e.cost < 0 or e.cost_vu < 0),
            "horizon": req.horizon,
            "total_profit_available": round(sum(o.profit for o in orders), 2),
            "total_qty": sum(o.qty for o in orders),
            "fleet_capacity": req.capacity * req.n_vehicles,
        },
    )
