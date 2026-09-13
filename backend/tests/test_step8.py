"""Step 8 API integration: /api/bench dispatches to the right sweep, honours
overrides, and enforces the size guardrail that keeps a live, repeatedly-
callable endpoint from being handed an unboundedly expensive request.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

EXPERIMENTS = ["apsp_crossover", "selector_quality", "zoning_quality", "size", "capacity"]


def test_all_five_experiments_run_with_default_params():
    for exp in EXPERIMENTS:
        r = client.post("/api/bench", json={"experiment": exp, "params": {}})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["experiment"] == exp
        assert len(d["rows"]) > 0
        assert d["runtime_ms"] >= 0


def test_params_override_the_sweep_defaults():
    small = client.post("/api/bench", json={
        "experiment": "apsp_crossover",
        "params": {"node_counts": [20], "densities": [0.1]},
    }).json()
    assert len(small["rows"]) == 3  # 1 n x 1 density x 3 modes
    assert {r["n"] for r in small["rows"]} == {20}


def test_oversized_param_list_is_rejected_not_silently_run():
    r = client.post("/api/bench", json={
        "experiment": "selector_quality",
        "params": {"n_orders_list": list(range(20)), "seeds": [1]},
    })
    assert r.status_code == 422
    assert "max" in r.json()["detail"].lower()


def test_invalid_experiment_name_is_rejected_by_schema():
    r = client.post("/api/bench", json={"experiment": "not_a_real_experiment", "params": {}})
    assert r.status_code == 422


def test_unknown_param_name_is_rejected_not_silently_ignored():
    r = client.post("/api/bench", json={
        "experiment": "capacity",
        "params": {"this_param_does_not_exist": [1, 2]},
    })
    assert r.status_code == 422


def test_bench_endpoint_does_not_affect_solve_endpoint_state():
    """Sweeps use their own throwaway Tracer per call (bench/sweeps.py) --
    confirms a /api/bench call can't leak trace state into a later /api/solve."""
    client.post("/api/bench", json={"experiment": "size", "params": {"node_counts": [20], "seeds": [1]}})
    d = client.post("/api/solve", json={"generate": {"seed": 7}, "config": {}}).json()
    assert d["stub"] is False
    assert len(d["trace"]) > 0
