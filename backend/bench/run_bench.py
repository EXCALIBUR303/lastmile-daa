#!/usr/bin/env python3
"""Step 8: the actual graded experiments -- vary graph size, density, and
capacity constraints; measure runtime AND solution quality (Internal
Assessment PDF's literal wording). Run from `backend/`:

    ./.venv/bin/python -m bench.run_bench

Writes one CSV + one PNG per experiment to bench/results/. Every number in
every chart comes from calling the SAME functions the live API dispatches to
(sweeps.py) -- this script is a batch driver over them, not a separate
implementation that could quietly drift from what `solve()` actually does.
"""
from __future__ import annotations

import csv
import pathlib
import time

import matplotlib

matplotlib.use("Agg")  # headless: never tries to open a GUI window
import matplotlib.pyplot as plt  # noqa: E402

from bench.sweeps import (  # noqa: E402
    sweep_apsp_crossover, sweep_capacity, sweep_selector_quality, sweep_size,
    sweep_zoning_quality,
)

RESULTS_DIR = pathlib.Path(__file__).parent / "results"

SELECTOR_LABEL = {
    "dp_deadline": "DP-3 (deadline)", "dp_01": "DP-1 (blind)",
    "greedy_density": "Greedy G1", "greedy_edd": "Greedy G2",
}
SELECTOR_COLOR = {
    "dp_deadline": "#5ad1ff", "dp_01": "#ff6b6b",
    "greedy_density": "#c084fc", "greedy_edd": "#ffc857",
}
APSP_COLOR = {"dijkstra": "#5ad1ff", "floyd": "#3ddc97", "johnson": "#c084fc"}
ZONING_COLOR = {"prim": "#5ad1ff", "kruskal": "#c084fc", "none": "#7d8aa3"}


def _write_csv(rows: list[dict], path: pathlib.Path) -> None:
    if not rows:
        path.write_text("")
        return
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def _style(ax) -> None:
    ax.set_facecolor("#0b0f16")
    ax.figure.set_facecolor("#0b0f16")
    for spine in ax.spines.values():
        spine.set_color("#33415c")
    ax.tick_params(colors="#9fb0c9")
    ax.title.set_color("#e6ecf7")
    ax.xaxis.label.set_color("#9fb0c9")
    ax.yaxis.label.set_color("#9fb0c9")
    ax.grid(True, color="#1e2839", linewidth=0.6)


# --------------------------------------------------------------------------- #
# 1. APSP crossover: runtime vs density, one panel per n, one line per mode.
# --------------------------------------------------------------------------- #


def run_apsp_crossover() -> None:
    print("Sweep 1/5: APSP crossover (Dijkstra vs Floyd-Warshall vs Johnson)...")
    t0 = time.perf_counter()
    rows = sweep_apsp_crossover()
    print(f"  {len(rows)} rows in {time.perf_counter() - t0:.1f}s")
    _write_csv(rows, RESULTS_DIR / "apsp_crossover.csv")

    ns = sorted({r["n"] for r in rows})
    fig, axes = plt.subplots(1, len(ns), figsize=(4 * len(ns), 3.6), sharey=True)
    if len(ns) == 1:
        axes = [axes]
    for ax, n in zip(axes, ns):
        for mode in ("dijkstra", "floyd", "johnson"):
            pts = sorted((r["density"], r["runtime_ms"]) for r in rows if r["n"] == n and r["mode"] == mode)
            if pts:
                xs, ys = zip(*pts)
                ax.plot(xs, ys, marker="o", color=APSP_COLOR[mode], label=mode, linewidth=2)
        ax.set_title(f"n={n}")
        ax.set_xlabel("density")
        _style(ax)
    axes[0].set_ylabel("runtime (ms)")
    axes[-1].legend(facecolor="#121826", edgecolor="#33415c", labelcolor="#e6ecf7")
    fig.suptitle("S2 metric closure: runtime vs density, by node count", color="#e6ecf7")
    fig.tight_layout()
    fig.savefig(RESULTS_DIR / "apsp_crossover.png", dpi=140, facecolor="#0b0f16")
    plt.close(fig)


# --------------------------------------------------------------------------- #
# 2. Selector quality: mean profit by selector, grouped by n_orders, with the
#    LP bound plotted as a reference ceiling.
# --------------------------------------------------------------------------- #


def run_selector_quality() -> None:
    print("Sweep 2/5: selector quality (DP-3 vs DP-1 vs greedy)...")
    t0 = time.perf_counter()
    rows = sweep_selector_quality()
    print(f"  {len(rows)} rows in {time.perf_counter() - t0:.1f}s")
    _write_csv(rows, RESULTS_DIR / "selector_quality.csv")

    n_orders_vals = sorted({r["n_orders"] for r in rows})
    selectors = ["dp_deadline", "dp_01", "greedy_density", "greedy_edd"]

    # Two panels, one figure: final PROFIT alone doesn't cleanly separate the
    # selectors (Step 7's repair loop corrects deadline mistakes AFTER
    # selection, so a deadline-blind pick that gets partly repaired can land
    # on similar final profit to one that was deadline-aware from the start
    # -- see pipeline.py's Step 7 docstring). What repair CANNOT erase is how
    # much work it had to do: the right panel is the cleaner signal.
    import numpy as np  # matplotlib already pulls this in transitively
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4.5))
    width = 0.18
    x = np.arange(len(n_orders_vals))

    for i, sel in enumerate(selectors):
        means = []
        for n in n_orders_vals:
            vals = [r["profit"] for r in rows if r["n_orders"] == n and r["selector"] == sel]
            means.append(sum(vals) / len(vals) if vals else 0)
        ax1.bar(x + (i - 1.5) * width, means, width, label=SELECTOR_LABEL[sel], color=SELECTOR_COLOR[sel])
    lp_means = [
        sum(r["dp_bound"] for r in rows if r["n_orders"] == n) / max(1, sum(1 for r in rows if r["n_orders"] == n))
        for n in n_orders_vals
    ]
    ax1.plot(x, lp_means, "--", color="#ffffff", marker="D", label="LP bound (ceiling)", linewidth=1.5)
    ax1.set_xticks(x)
    ax1.set_xticklabels([str(n) for n in n_orders_vals])
    ax1.set_xlabel("orders per instance")
    ax1.set_ylabel("mean achieved profit")
    ax1.set_title("Final profit vs the LP bound\n(noisy across selectors -- repair corrects mistakes)")
    ax1.legend(facecolor="#121826", edgecolor="#33415c", labelcolor="#e6ecf7", fontsize=7)
    _style(ax1)

    for i, sel in enumerate(selectors):
        means = []
        for n in n_orders_vals:
            vals = [r["repair_drops"] for r in rows if r["n_orders"] == n and r["selector"] == sel]
            means.append(sum(vals) / len(vals) if vals else 0)
        ax2.bar(x + (i - 1.5) * width, means, width, label=SELECTOR_LABEL[sel], color=SELECTOR_COLOR[sel])
    ax2.set_xticks(x)
    ax2.set_xticklabels([str(n) for n in n_orders_vals])
    ax2.set_xlabel("orders per instance")
    ax2.set_ylabel("mean repair drops needed")
    ax2.set_title("Repair EFFORT\n(the signal that survives -- deadline-blind needs more fixing)")
    _style(ax2)

    fig.tight_layout()
    fig.savefig(RESULTS_DIR / "selector_quality.png", dpi=140, facecolor="#0b0f16")
    plt.close(fig)


# --------------------------------------------------------------------------- #
# 3. Zoning quality: MST (Prim/Kruskal) vs round-robin baseline.
# --------------------------------------------------------------------------- #


def run_zoning_quality() -> None:
    print("Sweep 3/5: zoning quality (MST vs round-robin)...")
    t0 = time.perf_counter()
    rows = sweep_zoning_quality()
    print(f"  {len(rows)} rows in {time.perf_counter() - t0:.1f}s")
    _write_csv(rows, RESULTS_DIR / "zoning_quality.csv")

    zonings = ["prim", "kruskal", "none"]
    means = []
    for z in zonings:
        vals = [r["total_travel_time"] for r in rows if r["zoning"] == z]
        means.append(sum(vals) / len(vals) if vals else 0)

    fig, ax = plt.subplots(figsize=(5, 4))
    bars = ax.bar(zonings, means, color=[ZONING_COLOR[z] for z in zonings])
    baseline = means[zonings.index("none")]
    for b, z, m in zip(bars, zonings, means):
        pct = 100 * (1 - m / baseline) if baseline else 0
        label = f"{m:.0f} min" + (f"\n(-{pct:.0f}%)" if z != "none" and baseline else "")
        ax.text(b.get_x() + b.get_width() / 2, m, label, ha="center", va="bottom",
                color="#e6ecf7", fontsize=9)
    ax.set_ylabel("mean total travel time (min)")
    ax.set_title(f"MST zoning vs round-robin baseline (n={len(rows) // len(zonings)} seeds)")
    _style(ax)
    fig.tight_layout()
    fig.savefig(RESULTS_DIR / "zoning_quality.png", dpi=140, facecolor="#0b0f16")
    plt.close(fig)


# --------------------------------------------------------------------------- #
# 4. Size: end-to-end pipeline runtime and quality as the instance grows.
# --------------------------------------------------------------------------- #


def run_size() -> None:
    print("Sweep 4/5: size scaling...")
    t0 = time.perf_counter()
    rows = sweep_size()
    print(f"  {len(rows)} rows in {time.perf_counter() - t0:.1f}s")
    _write_csv(rows, RESULTS_DIR / "size_scaling.csv")

    ns = sorted({r["n_nodes"] for r in rows})
    means = [sum(r["runtime_ms"] for r in rows if r["n_nodes"] == n) / max(1, sum(1 for r in rows if r["n_nodes"] == n)) for n in ns]

    fig, ax = plt.subplots(figsize=(6, 4))
    ax.plot(ns, means, marker="o", color="#5ad1ff", linewidth=2)
    ax.set_xlabel("graph size (n_nodes)")
    ax.set_ylabel("end-to-end runtime (ms)")
    ax.set_yscale("log")
    ax.set_title("Full pipeline runtime vs instance size")
    _style(ax)
    fig.tight_layout()
    fig.savefig(RESULTS_DIR / "size_scaling.png", dpi=140, facecolor="#0b0f16")
    plt.close(fig)


# --------------------------------------------------------------------------- #
# 5. Capacity: how binding the capacity constraint is.
# --------------------------------------------------------------------------- #


def run_capacity() -> None:
    print("Sweep 5/5: capacity sweep...")
    t0 = time.perf_counter()
    rows = sweep_capacity()
    print(f"  {len(rows)} rows in {time.perf_counter() - t0:.1f}s")
    _write_csv(rows, RESULTS_DIR / "capacity_sweep.csv")

    caps = sorted({r["capacity"] for r in rows})
    profit_means = [sum(r["profit"] for r in rows if r["capacity"] == c) / max(1, sum(1 for r in rows if r["capacity"] == c)) for c in caps]
    util_means = [sum(r["avg_utilisation"] for r in rows if r["capacity"] == c) / max(1, sum(1 for r in rows if r["capacity"] == c)) for c in caps]

    fig, ax1 = plt.subplots(figsize=(6.5, 4))
    ax1.plot(caps, profit_means, marker="o", color="#5ad1ff", linewidth=2, label="profit")
    ax1.set_xlabel("vehicle capacity")
    ax1.set_ylabel("mean profit", color="#5ad1ff")
    _style(ax1)
    ax2 = ax1.twinx()
    ax2.plot(caps, [u * 100 for u in util_means], marker="s", color="#ffc857", linewidth=2, label="utilisation")
    ax2.set_ylabel("mean utilisation (%)", color="#ffc857")
    ax2.tick_params(colors="#9fb0c9")
    ax1.set_title("Profit and fleet utilisation vs capacity")
    fig.tight_layout()
    fig.savefig(RESULTS_DIR / "capacity_sweep.png", dpi=140, facecolor="#0b0f16")
    plt.close(fig)


def main() -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    run_apsp_crossover()
    run_selector_quality()
    run_zoning_quality()
    run_size()
    run_capacity()
    print(f"\nAll 5 experiments done in {time.perf_counter() - t0:.1f}s -> {RESULTS_DIR}/")


if __name__ == "__main__":
    main()
