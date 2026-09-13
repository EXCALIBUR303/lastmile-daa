"""MST correctness: Prim and Kruskal must agree with each other (unique MST
weight), the k-way cut must produce exactly k components, and the DSU must
behave like a textbook union-find.
"""
from __future__ import annotations

import itertools

import pytest

from app.core.mst import DSU, StopEdge, cut_k_zones, kruskal, mst_total_weight, prim, stop_closure
from app.core.graph import Graph
from app.core.sssp import dijkstra
from app.data.generator import generate
from app.models import GenerateRequest


def _stop_graph(seed: int, n_orders: int = 8, n_nodes: int = 30):
    inst = generate(GenerateRequest(seed=seed, n_orders=n_orders, n_nodes=n_nodes))
    g = Graph.from_instance(inst)
    stops = sorted({0} | {o.pickup for o in inst.orders} | {o.drop for o in inst.orders})
    dist_from = {s: dijkstra(g, s)[0] for s in stops}
    edges = stop_closure(dist_from, stops)
    return stops, edges


def _naive_mst_weight(stops: list[int], edges: list[StopEdge]) -> float:
    """Brute-force reference for tiny instances: try every spanning subset
    of n-1 edges via Kruskal-style greedy on EVERY possible ordering is
    infeasible in general, but for a SMALL stop count we can instead trust
    the well-known fact that MST weight equals the minimum over ALL spanning
    trees -- checked here by exhaustively trying every combination of n-1
    edges that happens to form a tree (fine for stops <= 7 or so).
    """
    n = len(stops)
    best = float("inf")
    for combo in itertools.combinations(edges, n - 1):
        dsu = DSU(stops)
        if all(dsu.union(e.u, e.v) for e in combo):
            w = sum(e.w for e in combo)
            best = min(best, w)
    return best


@pytest.mark.parametrize("seed", [1, 7, 42])
def test_prim_and_kruskal_agree_on_total_weight(seed):
    stops, edges = _stop_graph(seed)
    prim_mst = prim(stops, edges)
    kruskal_mst = kruskal(stops, edges)
    assert len(prim_mst) == len(stops) - 1
    assert len(kruskal_mst) == len(stops) - 1
    assert mst_total_weight(prim_mst) == pytest.approx(mst_total_weight(kruskal_mst), abs=1e-6)


def test_matches_brute_force_on_a_tiny_graph():
    stops = [0, 1, 2, 3, 4, 5]
    dist_from = {
        0: [0, 4, 1, 9, 9, 9], 1: [4, 0, 2, 5, 9, 9], 2: [1, 2, 0, 3, 6, 9],
        3: [9, 5, 3, 0, 2, 7], 4: [9, 9, 6, 2, 0, 1], 5: [9, 9, 9, 7, 1, 0],
    }
    edges = stop_closure(dist_from, stops)
    want = _naive_mst_weight(stops, edges)
    assert mst_total_weight(prim(stops, edges)) == pytest.approx(want, abs=1e-9)
    assert mst_total_weight(kruskal(stops, edges)) == pytest.approx(want, abs=1e-9)


def test_single_stop_has_empty_mst():
    assert prim([5], []) == []
    assert kruskal([5], []) == []


@pytest.mark.parametrize("k", [1, 2, 3, 5])
def test_cut_k_zones_produces_exactly_k_components(k):
    stops, edges = _stop_graph(seed=3, n_orders=15, n_nodes=40)
    mst = kruskal(stops, edges)
    zone_of, forest = cut_k_zones(stops, mst, k)
    k_actual = min(k, len(stops))
    assert len(set(zone_of.values())) == k_actual
    assert len(forest) == len(stops) - k_actual
    assert set(zone_of.keys()) == set(stops)


def test_cut_more_zones_than_stops_caps_gracefully():
    stops, edges = _stop_graph(seed=3, n_orders=2)  # few stops
    mst = kruskal(stops, edges)
    zone_of, forest = cut_k_zones(stops, mst, k=999)
    assert len(set(zone_of.values())) == len(stops)  # one stop per zone, capped
    assert len(forest) == 0


def test_cut_k1_keeps_the_whole_tree():
    stops, edges = _stop_graph(seed=5, n_orders=6)
    mst = kruskal(stops, edges)
    zone_of, forest = cut_k_zones(stops, mst, k=1)
    assert len(set(zone_of.values())) == 1
    assert len(forest) == len(mst)


def test_zone_forest_never_crosses_zones():
    stops, edges = _stop_graph(seed=9, n_orders=12)
    mst = prim(stops, edges)
    zone_of, forest = cut_k_zones(stops, mst, k=3)
    for e in forest:
        assert zone_of[e.u] == zone_of[e.v]


def test_dsu_basic_union_find():
    dsu = DSU([1, 2, 3, 4, 5])
    assert dsu.find(1) != dsu.find(2)
    assert dsu.union(1, 2) is True
    assert dsu.find(1) == dsu.find(2)
    assert dsu.union(1, 2) is False  # already connected
    assert dsu.union(3, 4) is True
    assert dsu.find(1) != dsu.find(3)
    dsu.union(2, 3)
    assert dsu.find(1) == dsu.find(4)  # transitively connected


def test_prim_pop_budget_does_not_false_trigger_on_dense_stop_graph():
    stops, edges = _stop_graph(seed=11, n_orders=30, n_nodes=80)
    mst = prim(stops, edges)  # must not raise
    assert len(mst) == len(stops) - 1
