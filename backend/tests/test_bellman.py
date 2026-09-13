"""Bellman-Ford correctness: agreement with Dijkstra on the non-negative
`tau` metric, real negative-cycle detection on hand-built graphs, and a
regression guard on the directional-cost fix that makes the guard meaningful
instead of vacuous.
"""
from __future__ import annotations

import math

import pytest

from app.core.bellman import bellman_ford
from app.core.graph import Graph
from app.core.sssp import dijkstra
from app.data.generator import generate
from app.models import GenerateRequest


def _two_node_graph(cost_uv: float, cost_vu: float) -> Graph:
    """One undirected edge, asymmetric cost -- the exact shape the Edge model
    now enforces (see models.py) to avoid a trivial 2-hop negative cycle."""
    adj: list[list[tuple[int, float, float]]] = [[], []]
    adj[0].append((1, 5.0, cost_uv))
    adj[1].append((0, 5.0, cost_vu))
    return Graph(n=2, adj=adj, xy=[(0.0, 0.0), (1.0, 0.0)], m=1)


def _three_node_negative_cycle() -> Graph:
    """0->1->2->0 with directed costs -3, -3, +2: round trip = -4 < 0."""
    adj: list[list[tuple[int, float, float]]] = [[], [], []]
    adj[0].append((1, 1.0, -3.0))
    adj[1].append((2, 1.0, -3.0))
    adj[2].append((0, 1.0, 2.0))
    return Graph(n=3, adj=adj, xy=[(0.0, 0.0), (1.0, 0.0), (0.5, 1.0)], m=3, directed=True)


@pytest.mark.parametrize("topo", ["radial", "grid", "scale_free"])
@pytest.mark.parametrize("seed", [1, 7, 42])
def test_matches_dijkstra_on_nonnegative_tau_metric(topo, seed):
    inst = generate(GenerateRequest(topology=topo, seed=seed, n_nodes=30, n_orders=6))
    g = Graph.from_instance(inst)
    for src in (0, 4, 15):
        bf_dist, _, neg = bellman_ford(g, src, metric="tau")
        dk_dist, _ = dijkstra(g, src)
        assert neg is False, "tau is always >= 0, there is no cycle to find"
        for v in range(g.n):
            assert bf_dist[v] == pytest.approx(dk_dist[v], abs=1e-6)


def test_single_subsidised_edge_does_not_trivially_cycle():
    """THE regression test for the directional-cost fix: a symmetric negative
    edge would make this vacuously true on every subsidised edge; the fixed
    model (one direction discounted, the other normal) must not.
    """
    g = _two_node_graph(cost_uv=-4.0, cost_vu=5.0)  # round trip = +1, fine
    _, _, neg = bellman_ford(g, 0, metric="cost")
    assert neg is False


def test_detects_a_genuine_multi_edge_negative_cycle():
    g = _three_node_negative_cycle()
    _, _, neg = bellman_ford(g, 0, metric="cost")
    assert neg is True


def test_clean_graph_has_no_false_positive():
    inst = generate(GenerateRequest(seed=11, neg_cost_frac=0.0))
    g = Graph.from_instance(inst)
    assert not g.has_negative_cost()
    _, _, neg = bellman_ford(g, 0, metric="cost")
    assert neg is False


def test_generator_negative_cycle_rate_is_not_the_symmetric_bugs_signature():
    """A real cycle needs several subsidised edges to chain around an actual
    loop, so the rate is high but not universal (measured ~65-70% at
    defaults, since a typical instance has m-n+1 independent cycles to
    check). The OLD symmetric-cost bug made EVERY subsidised edge a trivial
    2-hop cycle by itself, which drives this to ~100% deterministically --
    that unmistakable signature is what this guards against, not "low".
    """
    hits = sum(
        bellman_ford(Graph.from_instance(generate(GenerateRequest(seed=s))), 0, metric="cost")[2]
        for s in range(1, 41)
    )
    assert hits / 40 < 0.9, f"rate ({hits}/40) looks like the symmetric-cost bug's signature"


def test_trace_round_count_matches_early_exit_and_done_flag_is_honest():
    inst = generate(GenerateRequest(seed=6, n_nodes=20, n_orders=4))
    g = Graph.from_instance(inst)
    from app.core.trace import Tracer
    t = Tracer()
    _, _, neg = bellman_ford(g, 0, metric="cost", tracer=t)
    rounds = [s for s in t.steps if s.kind == "round_start"]
    assert 0 < len(rounds) <= g.n - 1
    done = [s for s in t.steps if s.kind == "done"]
    assert len(done) == 1
    assert done[0].payload["negative_cycle"] == neg


def test_unreachable_nodes_stay_infinite():
    g = _two_node_graph(cost_uv=1.0, cost_vu=1.0)
    g.n = 3
    g.adj.append([])  # node 2, isolated
    g.xy.append((9.0, 9.0))
    dist, prev, neg = bellman_ford(g, 0, metric="cost")
    assert dist[2] == math.inf
    assert prev[2] == -1
    assert neg is False
