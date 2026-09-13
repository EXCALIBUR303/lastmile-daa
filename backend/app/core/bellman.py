"""Bellman-Ford: single-source shortest paths that tolerates negative edges,
plus the negative-cycle detector that's the whole reason it exists here.

Runs on `cost` by default (the metric that can go negative -- see Edge in
models.py for why a single undirected edge can no longer trivially fake a
negative cycle). Also accepts `tau` so Johnson (apsp.py) can reuse it for
reweighting potentials without a second implementation.

O(n*m): n-1 relaxation rounds over every edge, plus one more round that only
checks (never applies) a relaxation -- if anything would still improve, some
cycle reachable from `src` has negative total weight.
"""
from __future__ import annotations

import math
from typing import Literal

from app.core.graph import Graph
from app.core.trace import Tracer

INF = math.inf


def bellman_ford(
    g: Graph, src: int, metric: Literal["cost", "tau"] = "cost", tracer: Tracer | None = None,
) -> tuple[list[float], list[int], bool]:
    """Returns (dist, prev, has_negative_cycle).

    When has_negative_cycle is True, dist/prev are NOT meaningful for nodes
    reachable from the cycle (standard Bellman-Ford caveat) -- callers must
    check the flag before trusting the distances.
    """
    w_slot = 1 if metric == "tau" else 2  # (v, tau, cost) -> index into the tuple
    dist = [INF] * g.n
    prev = [-1] * g.n
    dist[src] = 0.0

    # A CLEAN graph converges (no more changes) within a handful of rounds --
    # roughly the graph's diameter, measured at 4-8 rounds for a default-size
    # instance. A graph WITH a negative cycle never converges by definition
    # and burns all n-1 rounds proving it, re-finding the same handful of
    # improving edges around the cycle every round. Detailed relax_ok tracing
    # is capped at DETAIL_ROUNDS so that provably-repetitive cyclic tail
    # doesn't dominate playback (round_start keeps marking progress past it,
    # at near-zero cost, so "still working" stays visible either way).
    DETAIL_ROUNDS = 15

    for i in range(max(0, g.n - 1)):
        detailed = i < DETAIL_ROUNDS
        if tracer is not None:
            tracer.emit("bellman", "round_start", round=i, detailed=detailed)
        changed = False
        for u in range(g.n):
            if dist[u] == INF:
                continue
            for edge in g.adj[u]:
                v, w = edge[0], edge[w_slot]
                # `relax_try` is NOT emitted as a Step: every round rescans
                # every edge (unlike Dijkstra, which visits each edge once),
                # so this is O(n*m) attempts -- tens of thousands of events
                # for a graph that would give Dijkstra only a few hundred.
                # Still counted for accurate op totals, just not recorded.
                if tracer is not None:
                    tracer.count("bellman")
                nd = dist[u] + w
                if nd < dist[v] - 1e-9:
                    dist[v] = nd
                    prev[v] = u
                    changed = True
                    if tracer is not None and detailed:
                        tracer.emit("bellman", "relax_ok", u=u, v=v, new=round(nd, 3))
        if not changed:
            break

    has_negative_cycle = False
    for u in range(g.n):
        if dist[u] == INF:
            continue
        for edge in g.adj[u]:
            v, w = edge[0], edge[w_slot]
            if dist[u] + w < dist[v] - 1e-9:
                has_negative_cycle = True
                break
        if has_negative_cycle:
            break

    if tracer is not None:
        tracer.emit("bellman", "done", negative_cycle=has_negative_cycle)
    return dist, prev, has_negative_cycle
