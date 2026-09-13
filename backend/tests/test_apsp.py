"""Floyd-Warshall and Johnson: cross-validated against Dijkstra (already
trusted from Step 3) and against each other, since all three must agree on
the same true delta[u][v] -- the whole point of offering algorithm choice is
that the ANSWER doesn't change, only how it's computed.
"""
from __future__ import annotations

import math

import pytest

from app.core.apsp import floyd_warshall, johnson, reconstruct_path_fw
from app.core.bellman import bellman_ford
from app.core.graph import Graph
from app.core.sssp import dijkstra, reconstruct_path
from app.core.trace import Tracer
from app.data.generator import generate
from app.models import GenerateRequest


def _three_node_negative_cycle() -> Graph:
    adj: list[list[tuple[int, float, float]]] = [[], [], []]
    adj[0].append((1, 1.0, -3.0))
    adj[1].append((2, 1.0, -3.0))
    adj[2].append((0, 1.0, 2.0))
    return Graph(n=3, adj=adj, xy=[(0.0, 0.0), (1.0, 0.0), (0.5, 1.0)], m=3, directed=True)


@pytest.mark.parametrize("topo", ["radial", "grid", "scale_free"])
@pytest.mark.parametrize("seed", [1, 7, 42])
def test_floyd_matches_dijkstra(topo, seed):
    inst = generate(GenerateRequest(topology=topo, seed=seed, n_nodes=30, n_orders=6))
    g = Graph.from_instance(inst)
    dist, _ = floyd_warshall(g, metric="tau")
    for src in (0, 5, 20):
        dk, _ = dijkstra(g, src)
        for v in range(g.n):
            assert dist[src][v] == pytest.approx(dk[v], abs=1e-6)


@pytest.mark.parametrize("topo", ["radial", "grid", "scale_free"])
@pytest.mark.parametrize("seed", [1, 7, 42])
def test_johnson_matches_dijkstra(topo, seed):
    inst = generate(GenerateRequest(topology=topo, seed=seed, n_nodes=30, n_orders=6))
    g = Graph.from_instance(inst)
    dist, _, neg = johnson(g, metric="tau")
    assert neg is False
    for src in (0, 5, 20):
        dk, _ = dijkstra(g, src)
        for v in range(g.n):
            assert dist[src][v] == pytest.approx(dk[v], abs=1e-6)


def test_floyd_and_johnson_agree_with_each_other():
    inst = generate(GenerateRequest(seed=9, n_nodes=40, n_orders=8, density=0.3))
    g = Graph.from_instance(inst)
    fw_dist, _ = floyd_warshall(g, metric="tau")
    jn_dist, _, neg = johnson(g, metric="tau")
    assert neg is False
    for i in range(g.n):
        for j in range(g.n):
            assert fw_dist[i][j] == pytest.approx(jn_dist[i][j], abs=1e-6)


def test_floyd_path_reconstruction_is_walkable_and_matches_distance():
    inst = generate(GenerateRequest(seed=15, n_nodes=30, n_orders=6))
    g = Graph.from_instance(inst)
    dist, next_hop = floyd_warshall(g, metric="tau")
    edge_set = {(u, v) for u in range(g.n) for v, _, _ in g.adj[u]}
    for i in range(g.n):
        for j in range(g.n):
            if dist[i][j] == math.inf or i == j:
                continue
            path = reconstruct_path_fw(next_hop, i, j)
            assert path[0] == i and path[-1] == j
            for a, b in zip(path, path[1:]):
                assert (a, b) in edge_set
            total = sum(
                next(tau for vv, tau, _ in g.adj[a] if vv == b)
                for a, b in zip(path, path[1:])
            )
            assert total == pytest.approx(dist[i][j], abs=1e-6)


def test_johnson_path_reconstruction_matches_distance():
    inst = generate(GenerateRequest(seed=16, n_nodes=30, n_orders=6))
    g = Graph.from_instance(inst)
    dist, prev_by_src, _ = johnson(g, metric="tau")
    for src in (0, 3, 10):
        for target in range(g.n):
            if dist[src][target] == math.inf or src == target:
                continue
            path = reconstruct_path(prev_by_src[src], src, target)
            assert path[0] == src and path[-1] == target
            total = sum(
                next(tau for vv, tau, _ in g.adj[a] if vv == b)
                for a, b in zip(path, path[1:])
            )
            assert total == pytest.approx(dist[src][target], abs=1e-6)


def test_floyd_on_cost_metric_independently_confirms_negative_cycle():
    """A second, structurally different algorithm agreeing with Bellman-Ford
    on cycle detection (via the classic dist[i][i] < 0 check) is much
    stronger evidence than either algorithm alone."""
    g = _three_node_negative_cycle()
    dist, _ = floyd_warshall(g, metric="cost")
    _, _, bf_neg = bellman_ford(g, 0, metric="cost")
    fw_neg = any(dist[i][i] < 0 for i in range(g.n))
    assert fw_neg is True
    assert fw_neg == bf_neg


def test_floyd_on_cost_metric_clean_graph_has_no_negative_diagonal():
    inst = generate(GenerateRequest(seed=11, neg_cost_frac=0.0))
    g = Graph.from_instance(inst)
    dist, _ = floyd_warshall(g, metric="cost")
    assert all(dist[i][i] >= 0 for i in range(g.n))


def test_johnson_reports_negative_cycle_and_returns_infinite_matrix():
    g = _three_node_negative_cycle()
    dist, prev_by_src, neg = johnson(g, metric="cost")
    assert neg is True
    assert prev_by_src == {}
    assert all(x == math.inf for row in dist for x in row)


def test_k_phase_trace_is_on_not_on3():
    """Regression guard: floyd_warshall must not go back to per-cell tracing,
    which is O(n^3) events and would blow the tracer's buffer."""
    inst = generate(GenerateRequest(seed=20, n_nodes=40, n_orders=8))
    g = Graph.from_instance(inst)
    t = Tracer()
    floyd_warshall(g, metric="tau", tracer=t)
    assert len(t) == g.n  # exactly one k_phase event per k
    # n^3 for the inner loop (added once, not counted live) + n for the
    # k_phase emits themselves, which also bump the same stage's counter.
    assert t.op_counts["floyd"] == g.n ** 3 + g.n


def test_dijkstra_rejects_a_negative_edge_directly():
    """Focused unit test for the guardrail added in Step 4: dijkstra() must
    refuse a negative weight loudly rather than silently miscompute -- this
    is what protects against a future Johnson reweighting bug."""
    adj: list[list[tuple[int, float, float]]] = [[(1, -1.0, -1.0)], [(0, -1.0, -1.0)]]
    g = Graph(n=2, adj=adj, xy=[(0.0, 0.0), (1.0, 0.0)], m=1)
    with pytest.raises(ValueError, match="non-negative"):
        dijkstra(g, 0)
