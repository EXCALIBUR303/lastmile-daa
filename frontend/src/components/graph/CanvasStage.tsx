import { AnimatePresence, motion } from "motion/react"
import { useMemo } from "react"
import { easeOutExpo, nodeVariants, spring } from "../../motion/presets"
import type { NodeVariantName } from "../../motion/presets"
import { useTokens, vehicleColorFor } from "../../lib/tokens"
import { viewBoxString, type ViewBox } from "../../lib/geometry"
import type { Selection } from "../../store/ui"
import type { ViewState } from "../../trace/reducer"
import type { Instance, VehiclePlan } from "../../types"

/** Radii in viewBox units are useless (the box is fit to the data), so glyphs
 *  are sized in a fixed pixel space and counter-scaled by the current zoom. */
const KIND_R: Record<string, number> = { depot: 12, pickup: 8, drop: 8, junction: 4.5 }

export interface CanvasProps {
  inst: Instance
  plans: VehiclePlan[]
  view: ViewState
  showRoutes: boolean
  viewBox: ViewBox
  selection: Selection
  focusedVehicle: number | null
  onSelect: (s: Selection) => void
  labelsVisible: boolean
}

export function CanvasStage({
  inst, plans, view, showRoutes, viewBox,
  selection, focusedVehicle, onSelect, labelsVisible,
}: CanvasProps) {
  const t = useTokens()
  const { edgeStroke, nodeFill } = t
  const vehicleColor = (i: number) => vehicleColorFor(t, i)

  const pos = useMemo(() => {
    const m = new Map<number, [number, number]>()
    for (const n of inst.nodes) m.set(n.id, [n.x, n.y])
    return m
  }, [inst])

  const orderOf = useMemo(() => {
    const m = new Map<number, { pickup: number; drop: number }>()
    for (const o of inst.orders) m.set(o.id, { pickup: o.pickup, drop: o.drop })
    return m
  }, [inst])

  // Glyph and stroke sizes are authored in pixels against a nominal 1000px-wide
  // stage, then converted to viewBox units against the CURRENT box. Because the
  // box shrinks as you zoom in, a node keeps the same size on screen at every
  // zoom level instead of ballooning.
  const u = (px: number) => (px / 1000) * viewBox.w

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
    // Step 7: an order the repair loop dropped never gets picked up or
    // dropped for real, so it would otherwise sit at "idle" -- visually
    // indistinguishable from an order that was simply never zoned here.
    // Reusing "violated" tells the same story ("this one didn't make it")
    // a beat earlier than a live deadline miss would.
    for (const oid of view.repaired) {
      const o = orderOf.get(oid)
      if (o) { st.set(o.pickup, "violated"); st.set(o.drop, "violated") }
    }
    for (const [, node] of view.at) st.set(node, "active")
    return st
  }, [view, orderOf])

  const isSelectedNode = (id: number) => selection?.kind === "node" && selection.id === id
  const isSelectedEdge = (a: number, b: number) =>
    selection?.kind === "edge" &&
    ((selection.u === a && selection.v === b) || (selection.u === b && selection.v === a))

  return (
    <svg
      viewBox={viewBoxString(viewBox)}
      className="h-full w-full touch-none select-none"
      role="img"
      aria-label={`Delivery network: ${inst.nodes.length} nodes, ${inst.edges.length} edges, ${plans.length} vehicle routes`}
    >
      {/* ---- road network. Kept deliberately quiet: routes, MST links and
           relaxed edges are the signal, this is the backdrop. */}
      <g>
        {inst.edges.map((e) => {
          const a = pos.get(e.u)!, b = pos.get(e.v)!
          const key = e.u < e.v ? `${e.u}-${e.v}` : `${e.v}-${e.u}`
          const relaxed = view.relaxed.has(key)
          const subsidised = e.cost < 0 || e.cost_vu < 0
          const chosen = isSelectedEdge(e.u, e.v)
          return (
            <motion.line
              key={key}
              x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
              stroke={chosen ? edgeStroke.selected
                : relaxed ? edgeStroke.relaxed
                : subsidised ? edgeStroke.subsidised
                : edgeStroke.network}
              strokeWidth={u(chosen ? 3 : relaxed ? 2.2 : 1.4)}
              strokeDasharray={subsidised && !relaxed && !chosen ? `${u(5)} ${u(5)}` : undefined}
              initial={false}
              animate={{ opacity: chosen ? 1 : relaxed ? 1 : subsidised ? 0.75 : 0.55 }}
              transition={{ duration: 0.28, ease: easeOutExpo }}
              style={{ cursor: "pointer" }}
              onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: "edge", u: e.u, v: e.v }) }}
            />
          )
        })}
        {/* Transparent hit-lines: a 1.4px road is far too thin to click. */}
        {inst.edges.map((e) => {
          const a = pos.get(e.u)!, b = pos.get(e.v)!
          const key = e.u < e.v ? `${e.u}-${e.v}` : `${e.v}-${e.u}`
          return (
            <line
              key={`hit-${key}`}
              x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
              stroke="transparent" strokeWidth={u(9)} style={{ cursor: "pointer" }}
              onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: "edge", u: e.u, v: e.v }) }}
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
              stroke={edgeStroke.mst} strokeWidth={u(2.2)}
              strokeDasharray={`${u(2)} ${u(6)}`} strokeLinecap="round"
              initial={{ opacity: 0 }} animate={{ opacity: 0.85 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: easeOutExpo }}
            />
          )
        })}
      </g>

      {/* ---- vehicle routes */}
      <AnimatePresence>
        {showRoutes && plans.map((p) => {
          const dimmed = focusedVehicle !== null && focusedVehicle !== p.vehicle_id
          const pts = p.route.map((n) => pos.get(n)!).map(([x, y]) => `${x},${y}`).join(" ")
          return (
            <motion.polyline
              key={`route-${p.vehicle_id}`}
              points={pts} fill="none"
              stroke={vehicleColor(p.vehicle_id)}
              strokeWidth={u(focusedVehicle === p.vehicle_id ? 3.4 : 2.4)}
              strokeLinejoin="round" strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{
                pathLength: 1,
                opacity: dimmed ? 0.12 : p.feasible ? 0.9 : 0.5,
              }}
              exit={{ opacity: 0 }}
              strokeDasharray={p.feasible ? undefined : `${u(8)} ${u(6)}`}
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
          const r = u(KIND_R[n.kind])
          const chosen = isSelectedNode(n.id)
          return (
            <motion.g key={n.id} style={{ originX: `${x}px`, originY: `${y}px`, cursor: "pointer" }}
                      variants={nodeVariants} animate={state} transition={spring}
                      onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: "node", id: n.id }) }}>
              {chosen && (
                <circle cx={x} cy={y} r={r * 1.9} fill="none"
                        stroke={edgeStroke.selected} strokeWidth={u(1.5)} opacity={0.9} />
              )}
              <circle
                cx={x} cy={y} r={r}
                fill={state === "violated" ? t.status.bad : nodeFill[n.kind as keyof typeof nodeFill]}
                stroke={t.surface.canvas} strokeWidth={u(n.kind === "junction" ? 1 : 2)}
              />
              {n.label && labelsVisible && (
                <text x={x} y={y - r - u(5)} textAnchor="middle"
                      fontSize={u(12)} fill={t.text.muted} className="mono"
                      style={{ pointerEvents: "none" }}>{n.label}</text>
              )}
            </motion.g>
          )
        })}
      </g>

      {/* ---- vehicles in motion */}
      <g>
        {[...view.at.entries()].map(([vid, node]) => {
          const p = pos.get(node)
          if (!p) return null
          const dimmed = focusedVehicle !== null && focusedVehicle !== vid
          return (
            <motion.g key={`veh-${vid}`}
                      animate={{ x: p[0], y: p[1], opacity: dimmed ? 0.15 : 1 }}
                      initial={false} transition={spring}
                      style={{ pointerEvents: "none" }}>
              {/* `initial` must state r explicitly. With only a static r prop
                  plus an animated r keyframe, Motion has no resolved starting
                  value on the first frame and writes r="undefined", which the
                  SVG parser rejects ("Expected length"). */}
              <motion.circle
                fill="none" stroke={vehicleColor(vid)} strokeWidth={u(2)}
                initial={{ r: u(14), opacity: 0.9 }}
                animate={{ opacity: [0.9, 0.25, 0.9], r: [u(14), u(20), u(14)] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} />
              <circle r={u(5.5)} fill={vehicleColor(vid)} stroke={t.surface.canvas} strokeWidth={u(2)} />
            </motion.g>
          )
        })}
      </g>
    </svg>
  )
}
