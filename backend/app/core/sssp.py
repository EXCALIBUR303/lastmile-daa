"""Single-source shortest paths.

Dijkstra requires non-negative edge weights -- exactly the invariant `tau`
carries by construction (generator.py never emits tau < 0, and graph.py
validates it). The `cost` metric, which CAN go negative, is Bellman-Ford's
job in Step 4.

Explicit `settled` set = the no-infinite-loop guardrail: each node is
finalised at most once, so the heap can only shrink toward empty. The pop
budget below is a second, independent guardrail -- derived from the actual
adjacency structure being walked, not a trusted field on `g` -- that turns a
broken heap invariant into a loud RuntimeError instead of a silent hang.
"""
from __future__ import annotations

import math
from heapq import heappop, heappush

from app.core.graph import Graph
from app.core.trace import Tracer

INF = math.inf


def dijkstra(
    g: Graph, src: int, tracer: Tracer | None = None,
) -> tuple[list[float], list[int]]:
    """Shortest travel time (via `tau`) from `src` to every node.

    Returns (dist, prev); prev[v] == -1 means v is src or unreached.
    O((n + m) log n) with a binary heap and lazy deletion.
    """
    dist = [INF] * g.n
    prev = [-1] * g.n
    dist[src] = 0.0
    settled = [False] * g.n
    pq: list[tuple[float, int]] = [(0.0, src)]

    # Total relax attempts across the whole run = sum of degree(u) over all
    # settled u = 2m (each undirected edge scanned once from each endpoint),
    # so pushes <= 2m and pops <= 2m + 1. Double it for slack.
    max_pops = 2 * sum(len(a) for a in g.adj) + 8
    pops = 0

    while pq:
        pops += 1
        if pops > max_pops:
            raise RuntimeError(
                f"dijkstra exceeded its pop budget ({max_pops}); heap invariant violated"
            )
        d, u = heappop(pq)
        if tracer is not None:
            tracer.emit("dijkstra", "pop", node=u, dist=round(d, 3))
        if settled[u]:
            continue  # stale heap entry from an earlier, since-improved push
        settled[u] = True
        if tracer is not None:
            tracer.emit("dijkstra", "settle", node=u, dist=round(d, 3))
        for v, tau, _cost in g.adj[u]:
            if tau < -1e-9:
                # Dijkstra's correctness depends on this; the generator's tau
                # is always >= 0, so the only realistic way to hit this is a
                # bug in Johnson's edge-reweighting (Step 4) -- fail loudly
                # rather than silently return a wrong distance.
                raise ValueError(f"dijkstra requires non-negative weights; got {tau} on {u}->{v}")
            if tracer is not None:
                tracer.emit("dijkstra", "relax_try", u=u, v=v, w=tau)
            if settled[v]:
                continue
            nd = d + tau
            if nd < dist[v]:
                dist[v] = nd
                prev[v] = u
                heappush(pq, (nd, v))
                if tracer is not None:
                    tracer.emit("dijkstra", "relax_ok", u=u, v=v, new=round(nd, 3))
    return dist, prev


def reconstruct_path(prev: list[int], src: int, target: int) -> list[int]:
    """Node sequence src -> target by walking `prev` backwards.

    Empty list if target is unreached. Singleton [src] if target == src.
    """
    if target != src and prev[target] == -1:
        return []
    path = [target]
    while path[-1] != src:
        path.append(prev[path[-1]])
    path.reverse()
    return path
