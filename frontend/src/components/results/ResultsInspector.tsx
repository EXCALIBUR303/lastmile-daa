import { lazy, Suspense } from "react"
import { Loader2 } from "lucide-react"
import { useUi, type AlgorithmView, type ResultTab } from "../../store/ui"
import type { ViewState } from "../../trace/reducer"
import type { SolveResponse } from "../../types"
import { Segmented } from "../ui/Field"
import { Tabs, type TabDef } from "../ui/Tabs"
import { ApspMatrix } from "./ApspMatrix"
import { collectAlerts } from "../../lib/alerts"
import { DpTable } from "./DpTable"
import { SummaryPanel } from "./SummaryPanel"
import { TracePanel } from "./TracePanel"
import { VehiclePanel } from "./VehiclePanel"

// recharts is a sizeable dependency and only this tab needs it, so it stays
// out of the initial bundle until an experiment is actually opened.
const ExperimentsPanel = lazy(() =>
  import("./ExperimentsPanel").then((m) => ({ default: m.ExperimentsPanel })),
)

const ALGORITHM_VIEWS: readonly AlgorithmView[] = ["trace", "matrix", "dp"]

export function ResultsInspector({
  data, view, capacity, horizon, ordersRequested,
}: {
  data: SolveResponse
  view: ViewState
  capacity: number
  horizon: number
  ordersRequested: number
}) {
  const tab = useUi((s) => s.resultTab)
  const setTab = useUi((s) => s.setResultTab)
  const algorithmView = useUi((s) => s.algorithmView)
  const setAlgorithmView = useUi((s) => s.setAlgorithmView)

  const { metrics, plans, unserved } = data.result
  const alerts = collectAlerts(metrics, plans)
  const worst = alerts.some((a) => a.severity === "error")
    ? ("bad" as const)
    : alerts.some((a) => a.severity === "warn")
      ? ("warn" as const)
      : ("neutral" as const)

  const tabs: readonly TabDef<ResultTab>[] = [
    {
      id: "summary",
      label: "Summary",
      badge: alerts.length > 0 ? { text: String(alerts.length), tone: worst } : undefined,
    },
    { id: "vehicles", label: "Vehicles", badge: { text: String(plans.length), tone: "neutral" } },
    { id: "algorithms", label: "Algorithms" },
    { id: "experiments", label: "Experiments" },
  ]

  return (
    <div className="flex min-h-0 flex-col">
      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Result views" />

      <div
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3"
      >
        {tab === "summary" && (
          <SummaryPanel metrics={metrics} plans={plans} ordersTotal={metrics.orders_total} />
        )}

        {tab === "vehicles" && (
          <VehiclePanel
            plans={plans}
            capacity={capacity}
            orders={data.instance.orders}
            unserved={unserved}
          />
        )}

        {tab === "algorithms" && (
          <div className="space-y-3">
            <Segmented
              id="algorithm-view"
              label="Algorithm inspection view"
              options={ALGORITHM_VIEWS}
              value={algorithmView}
              onChange={setAlgorithmView}
              describe={(v) =>
                v === "trace"
                  ? "Every recorded algorithm event, newest first, as the simulation plays."
                  : v === "matrix"
                    ? "All-pairs shortest-path distance matrix (Floyd-Warshall or Johnson only)."
                    : "The knapsack-with-deadlines DP table filling in, time × capacity."
              }
            />
            {algorithmView === "trace" && <TracePanel view={view} total={data.trace.length} />}
            {algorithmView === "matrix" && <ApspMatrix apsp={data.apsp} k={view.apspK} />}
            {algorithmView === "dp" && (
              <DpTable
                dpRow={view.dpRow}
                dpCells={view.dpCells}
                T={Math.ceil(horizon)}
                Q={capacity}
                totalOrders={ordersRequested}
              />
            )}
          </div>
        )}

        {tab === "experiments" && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-2 py-10" role="status">
                <Loader2 size={14} className="animate-spin text-accent" aria-hidden />
                <span className="text-[11px] text-muted">Loading charts…</span>
              </div>
            }
          >
            <ExperimentsPanel />
          </Suspense>
        )}
      </div>
    </div>
  )
}
