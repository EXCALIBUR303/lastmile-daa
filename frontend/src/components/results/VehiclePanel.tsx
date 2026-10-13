import { AnimatePresence, motion } from "motion/react"
import { ChevronRight, Crosshair } from "lucide-react"
import { useState } from "react"
import { count, minutes, money, signedPercent } from "../../lib/format"
import { useTokens, vehicleColorFor } from "../../lib/tokens"
import { useUi } from "../../store/ui"
import type { Order, VehiclePlan } from "../../types"
import { Tooltip } from "../ui/Tooltip"

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div>
      <div className="text-caption text-faint">{label}</div>
      <div className={`mono text-caption ${tone ?? "text-ink"}`}>{value}</div>
    </div>
  )
}

function VehicleRow({
  plan, capacity, orders,
}: {
  plan: VehiclePlan
  capacity: number
  orders: Order[]
}) {
  const [open, setOpen] = useState(false)
  const palette = useTokens()
  const focused = useUi((s) => s.focusedVehicle)
  const focusVehicle = useUi((s) => s.focusVehicle)
  const isFocused = focused === plan.vehicle_id
  const color = vehicleColorFor(palette, plan.vehicle_id)
  const lateCount = plan.visits.filter((v) => v.late).length
  const loadPct = capacity > 0 ? Math.min(100, (plan.peak_load / capacity) * 100) : 0
  const panelId = `vehicle-${plan.vehicle_id}-detail`

  return (
    <li className="rounded border border-line bg-raised/40">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left md:min-h-0
                     focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2
                     focus-visible:outline-accent"
        >
          <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18 }}
                       className="shrink-0 text-faint">
            <ChevronRight size={12} aria-hidden />
          </motion.span>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
          <span className="shrink-0 text-body font-medium text-ink">Vehicle {plan.vehicle_id}</span>

          <span className="mono ml-auto shrink-0 text-caption text-good">{money(plan.profit)}</span>
          <span
            className={`shrink-0 rounded px-1.5 py-px text-caption ${
              plan.feasible ? "bg-good/15 text-good" : "bg-bad/15 text-bad"
            }`}
          >
            {plan.feasible ? "feasible" : "infeasible"}
          </span>
        </button>

        <Tooltip content={isFocused ? "Show all routes" : `Isolate vehicle ${plan.vehicle_id}'s route`}>
          <button
            type="button"
            onClick={() => focusVehicle(isFocused ? null : plan.vehicle_id)}
            aria-label={isFocused ? "Show all routes on the canvas" : `Show only vehicle ${plan.vehicle_id} on the canvas`}
            aria-pressed={isFocused}
            className={`flex w-11 shrink-0 items-center justify-center border-l border-line transition-colors md:w-9
                        focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2
                        focus-visible:outline-accent
                        ${isFocused ? "bg-accent/15 text-accent" : "text-faint hover:text-ink"}`}
          >
            <Crosshair size={13} aria-hidden />
          </button>
        </Tooltip>
      </div>

      {/* load bar doubles as the at-a-glance capacity read */}
      <div className="px-2.5 pb-2">
        <div className="flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
            <motion.div
              className="h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${loadPct}%` }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
              style={{ background: color }}
            />
          </div>
          <span className="mono shrink-0 text-caption text-faint">
            {plan.peak_load}/{capacity} peak load
          </span>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="space-y-2.5 border-t border-line px-2.5 py-2.5">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Orders" value={count(plan.selected.length)} />
                <Stat label="Travel" value={minutes(plan.travel_time)} />
                <Stat label="Cost" value={money(plan.travel_cost)} />
                <Stat label="Gross profit" value={money(plan.profit)} tone="text-good" />
                <Stat label="Net" value={money(plan.profit - plan.travel_cost)}
                      tone={plan.profit - plan.travel_cost >= 0 ? "text-good" : "text-bad"} />
                <Stat label="Late" value={count(lateCount)} tone={lateCount ? "text-bad" : undefined} />
              </div>

              {plan.mst_lower_bound != null && plan.mst_lower_bound > 0 && (
                <div className="flex items-baseline justify-between text-caption">
                  <span className="text-faint">MST lower bound</span>
                  <span className="mono text-muted">
                    {minutes(plan.mst_lower_bound)}
                    <span className="ml-1 text-warn">
                      ({signedPercent(100 * (plan.travel_time / plan.mst_lower_bound - 1))} vs actual)
                    </span>
                  </span>
                </div>
              )}
              {plan.dp_bound > 0 && (
                <div className="flex items-baseline justify-between text-caption">
                  <span className="text-faint">LP profit ceiling</span>
                  <span className="mono text-muted">
                    {money(plan.dp_bound)}
                    <span className="ml-1 text-warn">
                      ({signedPercent(-100 * (1 - plan.profit / plan.dp_bound))} vs achieved)
                    </span>
                  </span>
                </div>
              )}

              <div>
                <div className="mb-1 text-caption text-faint">Selected orders</div>
                {plan.selected.length === 0 ? (
                  <p className="text-caption text-muted">None — every candidate was rejected or repaired away.</p>
                ) : (
                  <ul className="flex flex-wrap gap-1">
                    {plan.selected.map((oid) => {
                      const order = orders.find((o) => o.id === oid)
                      const isLate = plan.visits.some((v) => v.order_id === oid && v.late)
                      return (
                        <li
                          key={oid}
                          className={`mono rounded border px-1.5 py-0.5 text-caption ${
                            isLate ? "border-bad/40 bg-bad/10 text-bad" : "border-line bg-canvas text-muted"
                          }`}
                          title={order ? `profit ${money(order.profit)}, deadline ${minutes(order.deadline)}` : undefined}
                        >
                          #{oid}{isLate ? " late" : ""}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

export function VehiclePanel({
  plans, capacity, orders, unserved,
}: {
  plans: VehiclePlan[]
  capacity: number
  orders: Order[]
  unserved: number[]
}) {
  const focused = useUi((s) => s.focusedVehicle)
  const focusVehicle = useUi((s) => s.focusVehicle)

  return (
    <div className="space-y-3">
      {focused !== null && (
        <button
          type="button"
          onClick={() => focusVehicle(null)}
          className="w-full rounded border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-caption text-accent
                     transition-colors hover:bg-accent/15 focus-visible:outline focus-visible:outline-2
                     focus-visible:outline-accent"
        >
          Showing vehicle {focused} only — select to show all routes
        </button>
      )}

      <ul className="space-y-1.5">
        {plans.map((p) => (
          <VehicleRow key={p.vehicle_id} plan={p} capacity={capacity} orders={orders} />
        ))}
      </ul>

      <div className="rounded border border-line bg-raised/40 px-2.5 py-2">
        <div className="text-caption font-medium text-muted">
          Unserved orders <span className="mono text-faint">({count(unserved.length)})</span>
        </div>
        {unserved.length === 0 ? (
          <p className="mt-1 text-caption text-good">Every order was accepted and delivered.</p>
        ) : (
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {unserved.map((oid) => {
              const order = orders.find((o) => o.id === oid)
              return (
                <li key={oid}
                    className="mono rounded border border-line bg-canvas px-1.5 py-0.5 text-caption text-faint"
                    title={order ? `profit ${money(order.profit)}, deadline ${minutes(order.deadline)}` : undefined}>
                  #{oid}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
