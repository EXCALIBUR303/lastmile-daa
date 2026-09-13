"""Step 7 pipeline integration: sequencing actually changes the driven
route (it's no longer just EDD order), repair actually fires and produces
feasible plans, and the sequencer config is wired through correctly.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _solve(sequencer: str = "auto", seed: int = 7, **gen_overrides) -> dict:
    gen = {"seed": seed, **gen_overrides}
    r = client.post("/api/solve", json={"generate": gen, "config": {"sequencer": sequencer}})
    assert r.status_code == 200, r.text
    return r.json()


def test_every_vehicle_is_feasible_after_repair():
    """The actual correctness claim Step 7 makes: repair drives every
    vehicle to a feasible plan (or an empty one), full stop -- checked
    across many seeds since this used to fail ~3% of the time (order
    deadlines fixed by repair, but total route time past shift_end wasn't,
    before repair's shift-overrun branch was added).
    """
    for seed in range(1, 61):
        d = _solve(seed=seed)
        for p in d["result"]["plans"]:
            assert p["feasible"], f"seed={seed} veh={p['vehicle_id']}: infeasible after repair"


def test_visiting_order_can_differ_from_deadline_order():
    """Positive confirmation that real sequencing is happening, not a
    relabelled EDD walk: across enough seeds, at least one vehicle's actual
    visited order (drops, in the order they occur in `visits`) should NOT
    match its own deadline order -- interleaving pickups/drops from
    different orders for travel efficiency is exactly what a real
    sequencer is expected to do sometimes.
    """
    any_reordered = False
    for seed in range(1, 31):
        d = _solve(seed=seed, n_orders=16, n_nodes=40, n_vehicles=2)
        deadlines = {o["id"]: o["deadline"] for o in d["instance"]["orders"]}
        for p in d["result"]["plans"]:
            drop_order = [v["order_id"] for v in p["visits"] if v["action"] == "drop"]
            if len(drop_order) < 2:
                continue
            deadline_order = sorted(drop_order, key=lambda oid: deadlines[oid])
            if drop_order != deadline_order:
                any_reordered = True
                break
        if any_reordered:
            break
    assert any_reordered, "sequencing never diverged from EDD order across 30 seeds"


def test_repair_events_only_appear_when_something_was_actually_dropped():
    d = _solve(seed=7)
    repair_drops = [s for s in d["trace"] if s["stage"] == "repair"]
    for s in repair_drops:
        assert s["kind"] == "drop"
        assert "order_id" in s["payload"]
        assert s["payload"]["reason"] in ("deadline_miss", "shift_overrun")


def test_dropped_orders_are_not_in_the_final_selected_or_committed():
    d = _solve(seed=7)
    dropped_ids = {s["payload"]["order_id"] for s in d["trace"] if s["stage"] == "repair"}
    for p in d["result"]["plans"]:
        assert dropped_ids.isdisjoint(p["selected"]), "a repaired-away order survived into `selected`"


def test_route_visits_every_selected_orders_pickup_and_drop_exactly_once():
    for seed in range(1, 11):
        d = _solve(seed=seed)
        for p in d["result"]["plans"]:
            pickups = [v["node"] for v in p["visits"] if v["action"] == "pickup"]
            drops = [v["node"] for v in p["visits"] if v["action"] == "drop"]
            assert len(pickups) == len(p["selected"])
            assert len(drops) == len(p["selected"])
            assert len(set(v["order_id"] for v in p["visits"] if v["action"] == "pickup")) == len(pickups)


def test_sequencer_modes_all_produce_valid_feasible_plans():
    for seq in ("auto", "held_karp", "insertion_2opt"):
        d = _solve(sequencer=seq, seed=7)
        assert d["stub"] is False
        for p in d["result"]["plans"]:
            assert p["feasible"]


def test_held_karp_forced_on_a_large_zone_does_not_hang_or_error():
    """The safety cap must survive an explicit "held_karp" request even when
    a vehicle's selection is far too large for it -- this is exactly the
    scenario that would hang the server without routing.py's fallback."""
    d = _solve(sequencer="held_karp", seed=1, n_orders=30, n_nodes=70, n_vehicles=1, capacity=30)
    assert d["result"]["plans"][0]["feasible"] or d["result"]["plans"][0]["selected"] == []


def test_trace_contains_heldkarp_or_twoopt_depending_on_zone_size():
    """A small default instance's zones should mostly fit under
    HELD_KARP_MAX_STOPS, so "auto" should show heldkarp trace events."""
    d = _solve(sequencer="auto", seed=7)
    stages = {s["stage"] for s in d["trace"]}
    assert "heldkarp" in stages or "twoopt" in stages
