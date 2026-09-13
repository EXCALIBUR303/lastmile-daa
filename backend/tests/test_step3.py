"""Step 3 pipeline integration: real Dijkstra distances feed the simulation,
and the dashboard's route polylines now follow actual graph edges instead of
cutting straight through empty space.
"""
from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _edge_set(instance: dict) -> set[tuple[int, int]]:
    s: set[tuple[int, int]] = set()
    for e in instance["edges"]:
        s.add((e["u"], e["v"]))
        s.add((e["v"], e["u"]))
    return s


def _solve(seed: int = 7) -> dict:
    r = client.post("/api/solve", json={"generate": {"seed": seed}, "config": {}})
    assert r.status_code == 200
    return r.json()


def test_trace_contains_real_dijkstra_events():
    d = _solve()
    stages = {s["stage"] for s in d["trace"]}
    assert "dijkstra" in stages
    kinds = {s["kind"] for s in d["trace"] if s["stage"] == "dijkstra"}
    assert {"pop", "settle", "relax_ok"} <= kinds


def test_route_polylines_follow_real_edges_not_straight_lines():
    d = _solve()
    edges = _edge_set(d["instance"])
    for plan in d["result"]["plans"]:
        route = plan["route"]
        # route == [depot] (length 1) is legitimate: a vehicle with an empty
        # zone (possible since Step 5's MST clustering can be imbalanced)
        # correctly never leaves. len(route) >= 1 always holds; the
        # edge-following check below is vacuously true when there's nothing
        # to check, via zip(route, route[1:]) being empty.
        assert len(route) >= 1
        for a, b in zip(route, route[1:]):
            assert (a, b) in edges, f"vehicle {plan['vehicle_id']}: {a}->{b} not a real edge"


def test_route_edge_weights_sum_to_reported_travel_time():
    d = _solve()
    tau: dict[tuple[int, int], float] = {}
    for e in d["instance"]["edges"]:
        tau[(e["u"], e["v"])] = e["tau"]
        tau[(e["v"], e["u"])] = e["tau"]
    for plan in d["result"]["plans"]:
        route = plan["route"]
        summed = sum(tau[(a, b)] for a, b in zip(route, route[1:]))
        assert summed == pytest.approx(plan["travel_time"], abs=1e-6)


def test_graph_shortest_path_respects_generators_speed_floor():
    """Triangle inequality, scaled by the generator's own speed floor: every
    edge's tau is at least 0.9x its straight-line time (generator.py:
    `tau = d * TIME_SCALE * rng.uniform(0.9, 1.25)`), so by the triangle
    inequality no real leg can beat 0.9x crow-flies. A leg beating full (1.0x)
    crow-flies is expected and fine -- that's a direct near-floor edge, not a
    bug. If this weaker bound ever fails, Dijkstra or `tau` itself is broken.
    """
    d = _solve()
    pos = {n["id"]: (n["x"], n["y"]) for n in d["instance"]["nodes"]}
    TIME_SCALE = 120.0
    SPEED_FLOOR = 0.9
    checked = 0
    for plan in d["result"]["plans"]:
        visits = plan["visits"]
        for a, b in zip(visits, visits[1:]):
            leg_time = b["arrive"] - a["depart"]
            ax, ay = pos[a["node"]]
            bx, by = pos[b["node"]]
            euclid_time = math.hypot(ax - bx, ay - by) * TIME_SCALE
            assert leg_time >= SPEED_FLOOR * euclid_time - 1e-6, (
                f"{a['node']}->{b['node']} beats even the 0.9x floor on crow-flies"
            )
            checked += 1
    assert checked > 0
