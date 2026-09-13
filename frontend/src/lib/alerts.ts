// Feasibility analysis of a solved plan. Pure logic, kept out of the component
// that renders it so the two can be reasoned about (and reused) separately.
import { count } from "./format"
import type { Metrics, VehiclePlan } from "../types"

export type Severity = "info" | "warn" | "error"

export interface Alert {
  id: string
  severity: Severity
  title: string
  detail: string
}

/**
 * Every message is tied to the specific result it affects and says what the
 * consequence is, so nothing here is a decorative banner.
 */
export function collectAlerts(metrics: Metrics, plans: VehiclePlan[]): Alert[] {
  const alerts: Alert[] = []

  if (metrics.negative_cost_cycle) {
    alerts.push({
      id: "negative-cycle",
      severity: "info",
      title: "Cost model contains a negative cycle",
      detail:
        "Some loop of subsidised roads is net-negative, so a cheapest-cost path is undefined and the " +
        "Total cost figure is a plan valuation, not an optimum. Routing here is chosen by travel time, " +
        "which is always non-negative, so the routes themselves remain well defined.",
    })
  }

  const infeasible = plans.filter((p) => !p.feasible)
  if (infeasible.length > 0) {
    alerts.push({
      id: "infeasible",
      severity: "error",
      title: `${count(infeasible.length)} vehicle${infeasible.length > 1 ? "s" : ""} ended infeasible`,
      detail:
        `Vehicle ${infeasible.map((p) => p.vehicle_id).join(", ")} still breaks a deadline or the shift ` +
        "horizon after the repair loop finished. Its route is drawn dashed on the canvas.",
    })
  }

  const late = plans.reduce((n, p) => n + p.visits.filter((v) => v.late).length, 0)
  if (late > 0) {
    alerts.push({
      id: "late",
      severity: "warn",
      title: `${count(late)} delivery${late > 1 ? "ies" : ""} past deadline`,
      detail: "Affected drop stops are marked red on the canvas and in the vehicle rows.",
    })
  }

  const unservedCount = metrics.orders_total - metrics.orders_served
  if (unservedCount > 0) {
    alerts.push({
      id: "unserved",
      severity: "info",
      title: `${count(unservedCount)} order${unservedCount > 1 ? "s" : ""} not served`,
      detail:
        "Either the selection stage judged them unprofitable against capacity and deadlines, or the " +
        "repair loop dropped them to restore feasibility. This is an outcome of the policy, not a failure.",
    })
  }

  if (metrics.net_profit < 0) {
    alerts.push({
      id: "net-loss",
      severity: "warn",
      title: "Plan runs at a net loss",
      detail:
        "Travel cost exceeds the profit collected. Routing minimises travel time rather than cost, so " +
        "this is expected on instances with a high subsidised-edge fraction.",
    })
  }

  return alerts
}
