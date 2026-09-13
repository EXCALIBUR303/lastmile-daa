"""Correctness tests for Dijkstra: cross-validated against an independent
O(n*m) relaxation oracle, plus trace-fidelity checks on the emitted events.
"""
from __future__ import annotations

import math

import pytest

from app.core.graph import Graph
from app.core.sssp import dijkstra, reconstruct_path
from app.core.trace import Tracer
from app.data.generator import generate
from app.models import GenerateRequest


def _naive_reference(g: Graph, src: int) -> list[float]:
    """Independent O(n*m) repeated-relaxation oracle. NOT the real
    Bellman-Ford (Step 4 adds negative-cost handling and cycle detection) --
    just a numeric cross-check confined to this test file.
    """
    dist = [math.inf] * g.n
    dist[src] = 0.0
    for _ in range(g.n):
        changed = False
        for u in range(g.n):
            if dist[u] == math.inf:
                continue
            for v, tau, _ in g.adj[u]:
                if dist[u] + tau < dist[v] - 1e-9:
                    dist[v] = dist[u] + tau
                    changed = True
        if not changed:
            break
    return dist


def _small_disconnected_graph() -> Graph:
    """Two triangles, no edge between them: nodes 3,4,5 unreachable from 0."""
    xy = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (5.0, 5.0), (6.0, 5.0), (5.0, 6.0)]
    adj: list[list[tuple[int, float, float]]] = [[] for _ in range(6)]

    def link(u: int, v: int, tau: float) -> None:
        adj[u].append((v, tau, tau))
        adj[v].append((u, tau, tau))

    link(0, 1, 1.0); link(1, 2, 1.0); link(0, 2, 1.4)
    link(3, 4, 1.0); link(4, 5, 1.0); link(3, 5, 1.4)
    return Graph(n=6, adj=adj, xy=xy, m=6)


@pytest.mark.parametrize("topo", ["radial", "grid", "scale_free"])
@pytest.mark.parametrize("seed", [1, 7, 42])
def test_matches_naive_relaxation_oracle(topo, seed):
    inst = generate(GenerateRequest(topology=topo, seed=seed, n_nodes=40, n_orders=8))
    g = Graph.from_instance(inst)
    for src in (0, 5, 20):
        got, _ = dijkstra(g, src)
        want = _naive_reference(g, src)
        for v in range(g.n):
            assert got[v] == pytest.approx(want[v], abs=1e-6), f"src={src} v={v}"


def test_distance_to_self_is_zero():
    inst = generate(GenerateRequest(seed=3))
    g = Graph.from_instance(inst)
    dist, prev = dijkstra(g, 0)
    assert dist[0] == 0.0
    assert prev[0] == -1


def test_dijkstra_reachability_matches_bfs():
    inst = generate(GenerateRequest(seed=9, n_nodes=50, n_orders=10))
    g = Graph.from_instance(inst)
    dist, _ = dijkstra(g, 0)
    bfs_reachable = g.connected_component(0)
    for v in range(g.n):
        assert (dist[v] < math.inf) == bfs_reachable[v]


def test_unreachable_nodes_stay_infinite_and_dont_crash():
    g = _small_disconnected_graph()
    dist, prev = dijkstra(g, 0)
    assert dist[0] == pytest.approx(0.0)
    assert dist[1] == pytest.approx(1.0)
    assert dist[2] == pytest.approx(1.4)
    assert all(d == math.inf for d in dist[3:6])
    assert all(p == -1 for p in prev[3:6])


def test_path_reconstruction_is_walkable_and_matches_distance():
    inst = generate(GenerateRequest(seed=15, n_nodes=40, n_orders=8))
    g = Graph.from_instance(inst)
    dist, prev = dijkstra(g, 0)
    edge_set = {(u, v) for u in range(g.n) for v, _, _ in g.adj[u]}
    for target in range(1, g.n):
        if dist[target] == math.inf:
            continue
        path = reconstruct_path(prev, 0, target)
        assert path[0] == 0 and path[-1] == target
        for a, b in zip(path, path[1:]):
            assert (a, b) in edge_set, f"{a}->{b} is not a real edge"
        total = sum(
            next(tau for vv, tau, _ in g.adj[a] if vv == b)
            for a, b in zip(path, path[1:])
        )
        assert total == pytest.approx(dist[target], abs=1e-6)


def test_unreachable_target_returns_empty_path():
    g = _small_disconnected_graph()
    _, prev = dijkstra(g, 0)
    assert reconstruct_path(prev, 0, 4) == []


def test_same_source_and_target_is_singleton_path():
    g = _small_disconnected_graph()
    _, prev = dijkstra(g, 0)
    assert reconstruct_path(prev, 0, 0) == [0]


def test_settle_events_fire_in_nondecreasing_distance_order():
    """Core Dijkstra invariant, checked directly against the emitted trace --
    this is what proves the instrumentation isn't lying about the algorithm.
    """
    inst = generate(GenerateRequest(seed=21, n_nodes=40, n_orders=8))
    g = Graph.from_instance(inst)
    t = Tracer()
    dijkstra(g, 0, t)
    settles = [s.payload["dist"] for s in t.steps if s.kind == "settle"]
    assert settles == sorted(settles)
    assert len(settles) == sum(g.connected_component(0))  # one settle per reachable node


def test_pop_budget_guard_does_not_false_trigger_on_dense_graph():
    inst = generate(GenerateRequest(seed=4, n_nodes=60, density=0.7, n_orders=10))
    g = Graph.from_instance(inst)
    dist, _ = dijkstra(g, 0)  # must not raise
    assert all(d < math.inf for d in dist)  # dense graph is certainly connected


def test_untraced_call_produces_identical_distances_to_traced_call():
    """Same code path with and without a tracer -- no demo-only logic branch."""
    inst = generate(GenerateRequest(seed=17))
    g = Graph.from_instance(inst)
    silent, _ = dijkstra(g, 0, None)
    t = Tracer()
    traced, _ = dijkstra(g, 0, t)
    assert silent == traced
    assert len(t) > 0
