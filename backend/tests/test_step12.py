"""Step 1-2 invariants.

These are the properties every later stage is allowed to assume. When the real
solver lands in Steps 4-7, these tests must still pass unchanged -- that is how
we know the contract did not drift.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.graph import Graph
from app.core.trace import Tracer
from app.data.generator import generate
from app.main import app
from app.models import GenerateRequest

TOPOLOGIES = ["radial", "grid", "scale_free"]
client = TestClient(app)


# ---- generator ----------------------------------------------------------- #

@pytest.mark.parametrize("topo", TOPOLOGIES)
def test_graph_is_connected_and_valid(topo):
    inst = generate(GenerateRequest(topology=topo, seed=3))
    g = Graph.from_instance(inst)
    assert g.validate() == []
    assert all(g.connected_component(0))


@pytest.mark.parametrize("seed", [1, 7, 42, 999])
def test_generation_is_deterministic(seed):
    a = generate(GenerateRequest(seed=seed))
    b = generate(GenerateRequest(seed=seed))
    assert a.model_dump_json() == b.model_dump_json()


def test_density_monotonically_increases_edge_count():
    ms = [generate(GenerateRequest(n_nodes=60, density=d, n_orders=12)).meta["m"]
          for d in (0.05, 0.2, 0.5)]
    assert ms == sorted(ms) and len(set(ms)) == 3


def test_travel_time_never_negative_but_cost_may_be():
    inst = generate(GenerateRequest(seed=5, neg_cost_frac=0.3))
    assert all(e.tau >= 0 for e in inst.edges)
    assert any(e.cost < 0 for e in inst.edges), "need negative costs to motivate Bellman-Ford"


def test_orders_have_distinct_pickup_and_drop():
    inst = generate(GenerateRequest(seed=11))
    for o in inst.orders:
        assert o.pickup != o.drop
        assert o.deadline > 0 and o.qty >= 1


def test_rejects_instance_too_small_for_order_count():
    with pytest.raises(ValueError, match="need at least"):
        generate(GenerateRequest(n_nodes=10, n_orders=12))


# ---- tracer -------------------------------------------------------------- #

def test_tracer_buffer_is_bounded_and_counts_every_op():
    t = Tracer(max_steps=16)
    for i in range(5_000):
        t.emit("build", "x", i=i)
    assert len(t) <= 16, "trace buffer must never grow past its cap"
    assert t.truncated and t.stride > 1
    assert t.ops == 5_000, "op counter must reflect ALL work, not just sampled steps"


def test_disabled_tracer_records_nothing_but_still_counts():
    t = Tracer(enabled=False)
    for _ in range(100):
        t.emit("build", "x")
    assert len(t) == 0 and t.ops == 100


# ---- api / pipeline invariants ------------------------------------------- #

def test_solve_returns_wellformed_response():
    r = client.post("/api/solve", json={"generate": {"seed": 7}, "config": {}})
    assert r.status_code == 200
    d = r.json()
    assert d["stub"] is True, "flag must stay True until the real pipeline lands"
    assert len(d["trace"]) > 0
    assert d["result"]["metrics"]["orders_total"] == 12


@pytest.mark.parametrize("seed", [1, 7, 42])
def test_capacity_is_never_exceeded(seed):
    r = client.post("/api/solve", json={"generate": {"seed": seed, "capacity": 10}, "config": {}})
    d = r.json()
    for plan in d["result"]["plans"]:
        assert plan["peak_load"] <= 10
        assert all(v["load"] >= 0 for v in plan["visits"])


@pytest.mark.parametrize("seed", [1, 7, 42])
def test_every_order_is_either_committed_or_unserved_exactly_once(seed):
    r = client.post("/api/solve", json={"generate": {"seed": seed}, "config": {}})
    d = r.json()
    committed = [oid for p in d["result"]["plans"] for oid in p["selected"]]
    assert len(committed) == len(set(committed)), "an order cannot be assigned twice"
    assert set(committed) | set(d["result"]["unserved"]) == set(range(12))


def test_pickup_always_precedes_its_drop():
    d = client.post("/api/solve", json={"generate": {"seed": 7}, "config": {}}).json()
    for plan in d["result"]["plans"]:
        seen: set[int] = set()
        for v in plan["visits"]:
            if v["action"] == "pickup":
                seen.add(v["order_id"])
            elif v["action"] == "drop":
                assert v["order_id"] in seen, "drop before pickup violates precedence"


def test_late_flag_agrees_with_arrival_versus_deadline():
    d = client.post("/api/solve", json={"generate": {"seed": 7}, "config": {}}).json()
    deadlines = {o["id"]: o["deadline"] for o in d["instance"]["orders"]}
    for plan in d["result"]["plans"]:
        for v in plan["visits"]:
            if v["action"] == "drop":
                assert v["late"] == (v["arrive"] > deadlines[v["order_id"]])


def test_trace_disabled_yields_empty_trace_but_same_result():
    body = {"generate": {"seed": 7}, "config": {"trace": False}}
    off = client.post("/api/solve", json=body).json()
    on = client.post("/api/solve", json={"generate": {"seed": 7}, "config": {"trace": True}}).json()
    assert off["trace"] == []
    assert off["result"]["metrics"]["total_profit"] == on["result"]["metrics"]["total_profit"]


def test_bad_request_is_rejected_with_422():
    assert client.post("/api/solve", json={}).status_code == 422
    assert client.post("/api/solve",
                       json={"generate": {"n_nodes": 10, "n_orders": 12}}).status_code == 422
