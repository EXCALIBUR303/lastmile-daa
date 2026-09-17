import { motion } from "motion/react"
import { X } from "lucide-react"
import { minutes, money } from "../../lib/format"
import { useTokens, vehicleColorFor } from "../../lib/tokens"
import type { Selection } from "../../store/ui"
import type { Instance, VehiclePlan } from "../../types"

function Line({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className="mono text-[11px] text-ink" style={tone ? { color: tone } : undefined}>{v}</dd>
    </div>
  )
}

/**
 * Details for whatever is selected on the canvas. Anchored bottom-right and
 * narrow so it never sits on top of the network the operator is reading.
 */
export function SelectionCard({
  selection, inst, plans, onClose,
}: {
  selection: Selection
  inst: Instance
  plans: VehiclePlan[]
  onClose: () => void
}) {
  const t = useTokens()
  const { nodeFill } = t
  const vehicleColor = (i: number) => vehicleColorFor(t, i)

  let title = ""
  let accent = t.text.muted
  const rows: React.ReactNode[] = []
  if (!selection) return null

  if (selection.kind === "node") {
    const node = inst.nodes.find((n) => n.id === selection.id)
    if (!node) return null
    accent = nodeFill[node.kind as keyof typeof nodeFill]
    title = node.label || `Junction n${node.id}`
    rows.push(<Line key="id" k="Node id" v={`n${node.id}`} />)
    rows.push(<Line key="kind" k="Role" v={node.kind} tone={accent} />)

    const order = inst.orders.find((o) => o.pickup === node.id || o.drop === node.id)
    if (order) {
      const isPickup = order.pickup === node.id
      rows.push(<Line key="ord" k="Order" v={`#${order.id} (${isPickup ? "pickup" : "drop"})`} />)
      rows.push(<Line key="prof" k="Profit" v={money(order.profit)} />)
      rows.push(<Line key="qty" k="Quantity" v={`${order.qty} units`} />)
      rows.push(<Line key="dl" k="Deadline" v={minutes(order.deadline)} />)
      rows.push(<Line key="rel" k="Release" v={minutes(order.release)} />)
      rows.push(<Line key="svc" k="Service time" v={minutes(order.service)} />)
      const carrier = plans.find((p) => p.selected.includes(order.id))
      rows.push(
        <Line key="veh" k="Assigned to"
              v={carrier ? `Vehicle ${carrier.vehicle_id}` : "unserved"}
              tone={carrier ? vehicleColor(carrier.vehicle_id) : undefined} />,
      )
    } else if (node.kind === "depot") {
      rows.push(<Line key="fleet" k="Vehicles based here" v={inst.vehicles.length} />)
    }
  } else {
    const edge = inst.edges.find(
      (e) => (e.u === selection.u && e.v === selection.v) || (e.u === selection.v && e.v === selection.u),
    )
    if (!edge) return null
    title = `Road n${edge.u} – n${edge.v}`
    rows.push(<Line key="tau" k="Travel time τ" v={minutes(edge.tau)} />)
    rows.push(<Line key="cuv" k={`Cost n${edge.u}→n${edge.v}`} v={money(edge.cost)}
                    tone={edge.cost < 0 ? t.status.warn : undefined} />)
    rows.push(<Line key="cvu" k={`Cost n${edge.v}→n${edge.u}`} v={money(edge.cost_vu)}
                    tone={edge.cost_vu < 0 ? t.status.warn : undefined} />)
    if (edge.cost < 0 || edge.cost_vu < 0) {
      rows.push(
        <p key="note" className="pt-1 text-[10px] leading-snug text-warn">
          Subsidised in one direction — the negative cost is why Bellman-Ford is needed here.
        </p>,
      )
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      role="region"
      aria-label="Selection details"
      className="pointer-events-auto w-[222px] rounded-md border border-line bg-panel/95 p-3 backdrop-blur-sm"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
        <span className="truncate text-[12px] font-semibold text-ink">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close selection details"
          className="-m-2 ml-auto shrink-0 rounded p-2 text-faint transition-colors hover:text-ink
                     focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X size={13} aria-hidden />
        </button>
      </div>
      <dl className="space-y-1">{rows}</dl>
    </motion.div>
  )
}
