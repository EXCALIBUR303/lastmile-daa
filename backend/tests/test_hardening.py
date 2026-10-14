"""Public-API hardening: every request below used to crash (500), hang, or be
silently accepted. They must now be rejected quickly with a 422."""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

BAD_GENERATE = [
    {"n_vehicles": 0}, {"n_vehicles": 99}, {"capacity": -5}, {"capacity": 0},
    {"horizon": -10}, {"density": 5}, {"density": -0.1}, {"n_orders": 0},
    {"n_nodes": 100000}, {"n_orders": 500}, {"neg_cost_frac": 2}, {"seed": -1},
]


@pytest.mark.parametrize("gen", BAD_GENERATE)
def test_solve_rejects_out_of_range_generator_params(gen):
    assert client.post("/api/solve", json={"generate": gen}).status_code == 422


def _instance(**patch):
    inst = {
        "seed": 1, "topology": "radial",
        "nodes": [{"id": 0, "x": 0, "y": 0, "kind": "depot"},
                  {"id": 1, "x": 1, "y": 0, "kind": "pickup"},
                  {"id": 2, "x": 0, "y": 1, "kind": "drop"}],
        "edges": [{"u": 0, "v": 1, "tau": 5, "cost": 1, "cost_vu": 1},
                  {"u": 1, "v": 2, "tau": 5, "cost": 1, "cost_vu": 1}],
        "orders": [{"id": 0, "pickup": 1, "drop": 2, "deadline": 100, "qty": 1, "profit": 10, "service": 1}],
        "vehicles": [{"id": 0, "depot": 0, "capacity": 5, "shift_start": 0, "shift_end": 200}],
    }
    inst.update(patch)
    return inst


def test_a_well_formed_custom_instance_still_solves():
    assert client.post("/api/solve", json={"instance": _instance()}).status_code == 200


@pytest.mark.parametrize("patch", [
    {"edges": [{"u": 0, "v": 9, "tau": 1, "cost": 1, "cost_vu": 1}]},      # dangling node
    {"edges": [{"u": 1, "v": 1, "tau": 1, "cost": 1, "cost_vu": 1}]},      # self-loop
    {"edges": [{"u": 0, "v": 1, "tau": -1, "cost": 1, "cost_vu": 1}]},     # negative time
    {"vehicles": []},                                                       # empty fleet
    {"orders": [{"id": 0, "pickup": 7, "drop": 2, "deadline": 9, "qty": 1, "profit": 1, "service": 1}]},
    {"orders": [{"id": 0, "pickup": 1, "drop": 1, "deadline": 9, "qty": 1, "profit": 1, "service": 1}]},
    {"orders": [{"id": 0, "pickup": 1, "drop": 2, "deadline": 9, "qty": 0, "profit": 1, "service": 1}]},
    {"vehicles": [{"id": 0, "depot": 0, "capacity": 0, "shift_start": 0, "shift_end": 5}]},
    {"nodes": [{"id": 5, "x": 0, "y": 0, "kind": "depot"}]},                # ids not 0..n-1
])
def test_solve_rejects_malformed_custom_instances(patch):
    assert client.post("/api/solve", json={"instance": _instance(**patch)}).status_code == 422


@pytest.mark.parametrize("params", [
    {"node_counts": [100000]}, {"node_counts": ["a"]}, {"node_counts": [True]},
    {"seeds": [-5]}, {"node_counts": [20] * 13},
    {"node_counts": [20, 30, 40, 50, 60, 70], "seeds": [1, 2, 3, 4, 5, 6, 7]},  # 42 combos
])
def test_bench_rejects_unbounded_or_oversized_params(params):
    r = client.post("/api/bench", json={"experiment": "size", "params": params})
    assert r.status_code == 422


def test_bench_still_runs_the_dashboards_own_request():
    r = client.post("/api/bench", json={"experiment": "apsp_crossover",
                                        "params": {"node_counts": [80], "densities": [0.05, 0.15, 0.3, 0.5, 0.7]}})
    assert r.status_code == 200 and len(r.json()["rows"]) == 15
