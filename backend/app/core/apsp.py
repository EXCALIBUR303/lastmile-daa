"""All-pairs shortest paths: Floyd-Warshall and Johnson.

Both answer the same question -- delta[u][v] for every pair -- via different
complexity tradeoffs, which is the point of having both: Floyd-Warshall is
O(n^3) flat, independent of density; Johnson is O(n*m + n*(n+m)*log n), which
wins on sparse graphs and loses to Floyd-Warshall as m -> n^2. Step 8's bench
sweep is what turns that into an actual measured crossover.
"""
from __future__ import annotations

import math
from typing import Literal

from app.core.bellman import bellman_ford
from app.core.graph import Graph
from app.core.sssp import dijkstra
from app.core.trace import Tracer

INF = math.inf


def floyd_warshall(
    g: Graph, metric: Literal["tau", "cost"] = "tau", tracer: Tracer | None = None,
) -> tuple[list[list[float]], list[list[int]]]:
    """Returns (dist, next_hop). next_hop[i][j] is the first node to step to
    on the shortest i->j path (-1 if i==j or unreachable) -- the standard FW
    path-reconstruction trick, since FW itself never tracks predecessors.

    Only `k_phase` events are traced (n of them), not per-cell relaxations:
    those are O(n^3) and would blow the tracer's buffer for anything past a
    trivially small n while adding nothing the dashboard's design actually
    needs (the final matrix is shown from the frozen result, not replayed
    from the trace -- see reducer.ts). The true O(n^3) op count is exact by
    construction, so it's added once at the end rather than counted live.
    """
    n = g.n
    w_slot = 1 if metric == "tau" else 2
    dist = [[INF] * n for _ in range(n)]
    next_hop = [[-1] * n for _ in range(n)]
    for i in range(n):
        dist[i][i] = 0.0
    for u in range(n):
        for edge in g.adj[u]:
            v, w = edge[0], edge[w_slot]
            if w < dist[u][v]:  # keep the cheaper if somehow duplicated
                dist[u][v] = w
                next_hop[u][v] = v

    for k in range(n):
        if tracer is not None:
            tracer.emit("floyd", "k_phase", k=k)
        dk = dist[k]
        for i in range(n):
            dik = dist[i][k]
            if dik == INF:
                continue
            di = dist[i]
            nh_i = next_hop[i]
            for j in range(n):
                nd = dik + dk[j]
                if nd < di[j]:
                    di[j] = nd
                    nh_i[j] = next_hop[i][k]

    if tracer is not None:
        tracer.count("floyd", n ** 3)
    return dist, next_hop


def reconstruct_path_fw(next_hop: list[list[int]], src: int, target: int) -> list[int]:
    """Walk next_hop forward from src to target. Empty if unreachable."""
    if src != target and next_hop[src][target] == -1:
        return []
    path = [src]
    while path[-1] != target:
        path.append(next_hop[path[-1]][target])
    return path


def johnson(
    g: Graph, metric: Literal["tau", "cost"] = "tau",
    tracer: Tracer | None = None, demo_source: int = 0,
) -> tuple[list[list[float]], dict[int, list[int]], bool]:
    """Returns (dist, prev_by_source, has_negative_cycle).

    Textbook Johnson adds a virtual source connected to every node with
    weight-0 edges, runs Bellman-Ford from it for potentials, then Dijkstra
    from every real node on the reweighted (now non-negative) graph. The
    virtual node is skipped here: pipeline.py always calls validate() first,
    which already guarantees the graph is connected, so Bellman-Ford from any
    single real node (node 0) yields the same well-defined potentials a
    virtual source would -- a standard simplification once connectivity is
    already known, not a shortcut around correctness.

    O(n*m) for the potentials + n Dijkstra runs, O(n*(n+m) log n) total --
    better than Floyd-Warshall's O(n^3) when m is small relative to n^2.
    """
    n = g.n
    h, _, has_negative_cycle = bellman_ford(g, 0, metric=metric, tracer=None)
    if has_negative_cycle:
        return [[INF] * n for _ in range(n)], {}, True

    # Reweight: w'(u,v) = w(u,v) + h(u) - h(v) >= 0 whenever h are valid
    # shortest-path potentials and there is no negative cycle (Johnson's
    # theorem). Stash the reweighted value in both slots of a throwaway graph
    # so dijkstra() -- which always reads the tau slot -- works unmodified.
    reweighted = Graph(n=n, adj=[[] for _ in range(n)], xy=g.xy, m=g.m)
    w_slot = 1 if metric == "tau" else 2
    for u in range(n):
        for edge in g.adj[u]:
            v, w = edge[0], edge[w_slot]
            w2 = w + h[u] - h[v]
            reweighted.adj[u].append((v, w2, w2))

    dist = [[INF] * n for _ in range(n)]
    prev_by_source: dict[int, list[int]] = {}
    for src in range(n):
        d2, prev = dijkstra(reweighted, src, tracer if src == demo_source else None)
        prev_by_source[src] = prev
        row = dist[src]
        for v in range(n):
            if d2[v] < INF:
                row[v] = d2[v] - h[src] + h[v]  # undo the reweighting
    return dist, prev_by_source, False
