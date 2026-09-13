"""Minimum spanning tree: Prim and Kruskal, plus the k-way cut that turns an
MST into k zones for vehicle assignment.

Both run over a GEOMETRICALLY MEANINGFUL "stop closure" graph, not the raw
road network: a complete graph over stops (depot/pickup/drop nodes) whose
edge weight is real shortest-path travel time, already known from S2
(Dijkstra/Floyd-Warshall/Johnson). Cutting the k-1 heaviest edges of that
MST produces EXACTLY the same k clusters as single-linkage agglomerative
clustering would -- this is the standard reason DAA courses pair "MST" with
"clustering", and it does the job in O(n log n) instead of a full
hierarchical-clustering pass.
"""
from __future__ import annotations

from heapq import heappop, heappush
from typing import NamedTuple

from app.core.trace import Tracer

INF = float("inf")


class StopEdge(NamedTuple):
    u: int
    v: int
    w: float


def stop_closure(dist_from: dict[int, list[float]], stops: list[int]) -> list[StopEdge]:
    """Complete graph over `stops`: edge weight = shortest-path travel time,
    already known from S2. O(k^2) pairs, k = stop count (<= 81 at the
    sliders' max) -- cheap even fully materialised.
    """
    edges: list[StopEdge] = []
    for i, u in enumerate(stops):
        for v in stops[i + 1:]:
            edges.append(StopEdge(u, v, dist_from[u][v]))
    return edges


def prim(stops: list[int], edges: list[StopEdge], tracer: Tracer | None = None) -> list[StopEdge]:
    """Grow a tree from stops[0], always adding the cheapest edge crossing
    the cut (tree, non-tree). O(m log n) with a binary heap and lazy
    deletion -- structurally the same shape as Dijkstra (Step 3), except the
    priority is raw EDGE weight, not cumulative path distance, so it needs
    its own correctness argument rather than reusing Dijkstra's.

    Correctness (cut property): for any partition of the nodes into (S, not
    S), the minimum-weight edge crossing it belongs to SOME minimum spanning
    tree. If an MST omitted it, adding it would close a cycle that must
    cross the cut again via some other, strictly more expensive edge (ours
    was the minimum crosser); swapping the two yields a spanning tree no
    heavier -- so an MST containing the minimum crossing edge always exists.
    Applying this once per node added is safe by induction on tree size.
    """
    n = len(stops)
    if n <= 1:
        return []
    adj: dict[int, list[tuple[int, float]]] = {s: [] for s in stops}
    for e in edges:
        adj[e.u].append((e.v, e.w))
        adj[e.v].append((e.u, e.w))

    in_tree = {stops[0]}
    mst: list[StopEdge] = []
    pq: list[tuple[float, int, int]] = []  # (weight, from, to)
    for v, w in adj[stops[0]]:
        heappush(pq, (w, stops[0], v))
        if tracer is not None:
            tracer.emit("mst", "edge_consider", u=stops[0], v=v, w=round(w, 3))

    max_pops = 2 * len(edges) + 8  # same style of guard as Dijkstra's (Step 3)
    pops = 0
    while pq and len(mst) < n - 1:
        pops += 1
        if pops > max_pops:
            raise RuntimeError(f"prim exceeded its pop budget ({max_pops})")
        w, u, v = heappop(pq)
        if v in in_tree:
            if tracer is not None:
                tracer.emit("mst", "edge_reject", u=u, v=v, w=round(w, 3), reason="stale")
            continue
        in_tree.add(v)
        mst.append(StopEdge(u, v, w))
        if tracer is not None:
            tracer.emit("mst", "edge_accept", u=u, v=v, w=round(w, 3))
        for v2, w2 in adj[v]:
            if v2 not in in_tree:
                heappush(pq, (w2, v, v2))
                if tracer is not None:
                    tracer.emit("mst", "edge_consider", u=v, v=v2, w=round(w2, 3))
    return mst


class DSU:
    """Union-find, path halving + union by size: O(alpha(n)) amortised per
    operation (inverse Ackermann -- constant for any n that fits in memory).
    This is what lets Kruskal check "would u,v already be connected?" in one
    find() call instead of an explicit cycle search.
    """

    def __init__(self, items: list[int]) -> None:
        self.parent = {x: x for x in items}
        self.size = {x: 1 for x in items}

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]  # path halving
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> bool:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.size[ra] < self.size[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.size[ra] += self.size[rb]
        return True


def kruskal(stops: list[int], edges: list[StopEdge], tracer: Tracer | None = None) -> list[StopEdge]:
    """Sort all edges ascending, greedily accept any that doesn't close a
    cycle (checked via DSU), until n-1 edges are chosen. O(m log m), the sort
    dominates the O(m*alpha(n)) union-find scan.

    Correctness (cycle property): among the edges of any cycle, the heaviest
    one can never be in an MST (swap it for a lighter tree edge crossing the
    same cut -- that can only help). Processing smallest-first and rejecting
    anything that would close a cycle is exactly "never pick a cycle's
    heaviest edge", which is why this is safe.
    """
    dsu = DSU(stops)
    mst: list[StopEdge] = []
    target = len(stops) - 1
    for e in sorted(edges, key=lambda e: e.w):
        if tracer is not None:
            tracer.emit("mst", "edge_consider", u=e.u, v=e.v, w=round(e.w, 3))
        if dsu.union(e.u, e.v):
            mst.append(e)
            if tracer is not None:
                tracer.emit("mst", "edge_accept", u=e.u, v=e.v, w=round(e.w, 3))
        elif tracer is not None:
            tracer.emit("mst", "edge_reject", u=e.u, v=e.v, w=round(e.w, 3), reason="would_cycle")
        if len(mst) == target:
            break
    return mst


def cut_k_zones(
    stops: list[int], mst: list[StopEdge], k: int, tracer: Tracer | None = None,
) -> tuple[dict[int, int], list[StopEdge]]:
    """Remove the k-1 heaviest MST edges. A tree has no alternate path
    between any two nodes, so each removal splits exactly one component into
    two and can never accidentally reconnect an earlier split -- removing
    k-1 DISTINCT edges from one tree therefore yields EXACTLY k components,
    never fewer, never more.

    Returns ({stop_id: zone_id}, kept_forest_edges). Zone ids are 0..k'-1
    where k' = min(k, len(stops)): with more vehicles than stops there is
    nothing left to cut apart, so the extra vehicles simply get no zone
    (an idle vehicle, not a crash).
    """
    k_actual = max(1, min(k, len(stops)))
    if k_actual <= 1 or not mst:
        keep, cut = list(mst), []
    else:
        by_weight = sorted(mst, key=lambda e: e.w)
        n_cut = k_actual - 1
        keep, cut = by_weight[:-n_cut], by_weight[-n_cut:]
    for e in cut:
        if tracer is not None:
            tracer.emit("mst", "cut", u=e.u, v=e.v, w=round(e.w, 3))

    dsu = DSU(stops)
    for e in keep:
        dsu.union(e.u, e.v)
    roots = sorted({dsu.find(s) for s in stops})  # deterministic zone-id order
    root_to_zone = {r: i for i, r in enumerate(roots)}
    return {s: root_to_zone[dsu.find(s)] for s in stops}, keep


def mst_total_weight(edges: list[StopEdge]) -> float:
    """The classic TSP lower bound: removing any one edge from an optimal
    Hamiltonian tour yields a Hamiltonian PATH, which is a spanning tree (not
    necessarily minimum). So MST_weight <= that path's weight = tour_weight -
    (one edge's weight) <= tour_weight (edge weights are >= 0 here). No tour
    over these stops can beat this sum.
    """
    return sum(e.w for e in edges)
