"""Adjacency-list graph + structural validation.

Kept deliberately dumb: no algorithms live here, only representation and the
invariants every later stage is allowed to assume.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from math import hypot

from app.core.trace import Tracer
from app.models import Instance


@dataclass(slots=True)
class Graph:
    n: int
    adj: list[list[tuple[int, float, float]]]  # u -> [(v, tau, cost_u_to_v), ...]
    xy: list[tuple[float, float]]
    m: int = 0
    directed: bool = False
    # (u, v, tau, cost_uv, cost_vu) -- one entry per undirected edge, both
    # directional costs kept so a caller can tell which way a subsidy runs.
    _undirected_edges: list[tuple[int, int, float, float, float]] = field(default_factory=list)

    # -- construction ------------------------------------------------------ #

    @classmethod
    def from_instance(cls, inst: Instance, tracer: Tracer | None = None) -> "Graph":
        n = len(inst.nodes)
        pos = {nd.id: (nd.x, nd.y) for nd in inst.nodes}
        g = cls(
            n=n,
            adj=[[] for _ in range(n)],
            xy=[pos[i] for i in range(n)],
        )
        for e in inst.edges:
            g.adj[e.u].append((e.v, e.tau, e.cost))       # u -> v uses `cost`
            g.adj[e.v].append((e.u, e.tau, e.cost_vu))     # v -> u uses `cost_vu`
            g._undirected_edges.append((e.u, e.v, e.tau, e.cost, e.cost_vu))
            if tracer is not None:
                tracer.emit("build", "edge_add", u=e.u, v=e.v, tau=e.tau,
                            cost=e.cost, cost_vu=e.cost_vu)
        g.m = len(inst.edges)
        return g

    # -- accessors --------------------------------------------------------- #

    def edges(self) -> list[tuple[int, int, float, float, float]]:
        """Each undirected edge exactly once -- what MST consumes."""
        return list(self._undirected_edges)

    def cost_of(self, u: int, v: int) -> float:
        """Directional cost of traversing u -> v. O(degree(u))."""
        for vv, _tau, cost in self.adj[u]:
            if vv == v:
                return cost
        raise ValueError(f"no edge {u}->{v}")

    def euclid(self, u: int, v: int) -> float:
        (ax, ay), (bx, by) = self.xy[u], self.xy[v]
        return hypot(ax - bx, ay - by)

    def has_negative_cost(self) -> bool:
        return any(cuv < 0 or cvu < 0 for _, _, _, cuv, cvu in self._undirected_edges)

    # -- validation -------------------------------------------------------- #

    def connected_component(self, src: int = 0) -> list[bool]:
        seen = [False] * self.n
        seen[src] = True
        q = deque([src])
        while q:
            u = q.popleft()
            for v, _, _ in self.adj[u]:
                if not seen[v]:
                    seen[v] = True
                    q.append(v)
        return seen

    def validate(self, tracer: Tracer | None = None) -> list[str]:
        """Structural problems a later stage is NOT expected to survive.

        Negative-*cycle* detection deliberately isn't here: that needs a full
        Bellman-Ford pass over `cost`, which pipeline.py runs (traced) as its
        own S1 step so the guard is visible in the dashboard, not buried
        inside this cheap structural check.
        """
        problems: list[str] = []
        if any(tau < 0 for _, _, tau, _, _ in self._undirected_edges):
            problems.append("negative travel time on some edge (tau must be >= 0)")
        seen = self.connected_component(0)
        missing = [i for i, s in enumerate(seen) if not s]
        if missing:
            problems.append(f"graph is disconnected; {len(missing)} node(s) unreachable from 0")
        if tracer is not None:
            tracer.emit("build", "validate", problems=problems, n=self.n, m=self.m,
                        negative_cost=self.has_negative_cost())
        return problems
