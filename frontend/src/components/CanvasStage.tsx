import { AnimatePresence, motion } from "motion/react"
import { useMemo } from "react"
import { easeOutExpo, nodeVariants, spring, vehicleColor } from "../motion/presets"
import type { NodeVariantName } from "../motion/presets"
import type { ViewState } from "../trace/reducer"
import type { Instance, VehiclePlan } from "../types"

const S = 1000
const KIND_FILL: Record<string, string> = {
  depot: "#ffc857", pickup: "#5ad1ff", drop: "#c084fc", junction: "#5b7099",
}
const KIND_R: Record<string, number> = { depot: 13, pickup: 9, drop: 9, junction: 5.5 }

export function CanvasStage({
  inst, plans, view, showRoutes,
}: {
  inst: Instance; plans: VehiclePlan[]; view: ViewState; showRoutes: boolean
}) {
  const pos = useMemo(() => {
    const m = new Map<number, [number, number]>()
    for (const n of inst.nodes) m.set(n.id, [n.x * S, n.y * S])
    return m
  }, [inst])

  const orderOf = useMemo(() => {
    const m = new Map<number, { pickup: number; drop: number }>()
    for (const o of inst.orders) m.set(o.id, { pickup: o.pickup, drop: o.drop })
    return m
  }, [inst])

  // node id -> visual state, derived purely from the folded view
  const nodeState = useMemo(() => {
    const st = new Map<number, NodeVariantName>()
    for (const id of view.settled) st.set(id, "settled")
    for (const id of view.frontier) st.set(id, "frontier")
    for (const oid of view.pickedUp) {
      const o = orderOf.get(oid); if (o) st.set(o.pickup, "active")
    }
    for (const oid of view.dropped) {
      const o = orderOf.get(oid); if (o) st.set(o.drop, view.late.has(oid) ? "violated" : "settled")
    }
    for (const [, node] of view.at) st.set(node, "active")
    return st
  }, [view, orderOf])

  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="h-full w-full">
      <defs>
        <radialGradient id="vignette" cx="50%" cy="50%" r="75%">
          <stop offset="0%" stopColor="#121826" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0b0f16" stopOpacity="1" />
        </radialGradient>
      </defs>
      <rect width={S} height={S} fill="url(#vignette)" />

      {/* ---- edges: dashed + amber where cost < 0 (the Bellman-Ford motivation) */}
      <g>
        {inst.edges.map((e) => {
          const a = pos.get(e.u)!, b = pos.get(e.v)!
          const key = e.u < e.v ? `${e.u}-${e.v}` : `${e.v}-${e.u}`
          const relaxed = view.relaxed.has(key)
          const subsidised = e.cost < 0
          return (
            <motion.line
              key={key}
              x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
              stroke={relaxed ? "#5ad1ff" : subsidised ? "#ffc857" : "#2f4262"}
              strokeWidth={relaxed ? 2.2 : 1.4}
              strokeDasharray={subsidised && !relaxed ? "5 5" : undefined}
              initial={false}
              animate={{ opacity: relaxed ? 1 : subsidised ? 0.7 : 0.6 }}
              transition={{ duration: 0.28, ease: easeOutExpo }}
            />
          )
        })}
      </g>

      {/* ---- MST zone links (Step 5): stop-to-stop, NOT real roads -- these
           connect a pickup/drop/depot to whichever other stop the clustering
           MST paired it with, which may be many hops away on the actual
           network. Rendered as a distinct dashed-green "logical" line
           (thicker + brighter than the amber subsidy dashes) so it never
           reads as a driveable edge. */}
      <g>
        {[...view.mstEdges].map((key) => {
          const [us, vs] = key.split("-")
          const a = pos.get(Number(us)), b = pos.get(Number(vs))
          if (!a || !b) return null
          return (
            <motion.line
              key={`mst-${key}`}
              x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
              stroke="#3ddc97" strokeWidth={2.2} strokeDasharray="2 6" strokeLinecap="round"
              initial={{ opacity: 0 }} animate={{ opacity: 0.8 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: easeOutExpo }}
            />
          )
        })}
      </g>

      {/* ---- routes */}
      <AnimatePresence>
        {showRoutes && plans.map((p) => {
          const pts = p.route.map((n) => pos.get(n)!).map(([x, y]) => `${x},${y}`).join(" ")
          return (
            <motion.polyline
              key={`route-${p.vehicle_id}`}
              points={pts} fill="none"
              stroke={vehicleColor(p.vehicle_id)} strokeWidth={2.4}
              strokeLinejoin="round" strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: p.feasible ? 0.85 : 0.45 }}
              exit={{ opacity: 0 }}
              strokeDasharray={p.feasible ? undefined : "8 6"}
              transition={{ pathLength: { duration: 0.9, ease: easeOutExpo },
                            opacity: { duration: 0.25 } }}
            />
          )
        })}
      </AnimatePresence>

      {/* ---- nodes */}
      <g>
        {inst.nodes.map((n) => {
          const [x, y] = pos.get(n.id)!
          const state = nodeState.get(n.id) ?? "idle"
          return (
            <motion.g key={n.id} style={{ originX: `${x}px`, originY: `${y}px` }}
                      variants={nodeVariants} animate={state} transition={spring}>
              <circle
                cx={x} cy={y} r={KIND_R[n.kind]}
                fill={state === "violated" ? "#ff6b6b" : KIND_FILL[n.kind]}
                stroke="#0b0f16" strokeWidth={n.kind === "junction" ? 1 : 2}
              />
              {n.label && (
                <text x={x} y={y - KIND_R[n.kind] - 6} textAnchor="middle"
                      fontSize={13} fill="#7d8aa3" className="tabular">{n.label}</text>
              )}
            </motion.g>
          )
        })}
      </g>

      {/* ---- vehicles */}
      <g>
        {[...view.at.entries()].map(([vid, node]) => {
          const [x, y] = pos.get(node)!
          return (
            <motion.g key={`veh-${vid}`}
                      animate={{ x, y }} initial={false} transition={spring}>
              <motion.circle r={17} fill="none" stroke={vehicleColor(vid)} strokeWidth={2}
                             animate={{ opacity: [0.9, 0.25, 0.9], r: [15, 21, 15] }}
                             transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} />
              <circle r={6} fill={vehicleColor(vid)} stroke="#0b0f16" strokeWidth={2} />
            </motion.g>
          )
        })}
      </g>
    </svg>
  )
}
