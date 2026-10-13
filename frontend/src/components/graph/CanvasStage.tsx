import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useMemo } from "react"
import { dur, ease, spring } from "../../motion/presets"
import { useTokens, vehicleColorFor } from "../../lib/tokens"
import { viewBoxString, type ViewBox } from "../../lib/geometry"
import { usePlayback } from "../../store/playback"
import type { Selection } from "../../store/ui"
import type { Phase } from "../../trace/phase"
import type { ViewState } from "../../trace/reducer"
import type { Instance, VehiclePlan } from "../../types"

/** Half-size of each stop glyph, in nominal pixels (see `u`). */
const HALF: Record<string, number> = { depot: 9, pickup: 6.5, drop: 6, junction: 3 }


/** What a stop's status ring says. One meaning per colour. */
type Mark = "none" | "frontier" | "onboard" | "delivered" | "late" | "repaired"

/** Routes shorter than this (nominal px) get no direction arrow. */
const ARROW_MIN_SEGMENT = 34

export interface CanvasProps {
  inst: Instance
  plans: VehiclePlan[]
  view: ViewState
  /** What to foreground: the search wave, the MST zoning, or the routes. */
  phase: Phase
  viewBox: ViewBox
  /** On-screen width of the stage in CSS pixels, for glyph sizing. */
  stagePx: number
  selection: Selection
  focusedVehicle: number | null
  onSelect: (s: Selection) => void
  labelsVisible: boolean
}

export function CanvasStage({
  inst, plans, view, phase, viewBox, stagePx,
  selection, focusedVehicle, onSelect, labelsVisible,
}: CanvasProps) {
  const t = useTokens()
  const { edgeStroke, nodeFill } = t
  const vehicleColor = (i: number) => vehicleColorFor(t, i)

  const playing = usePlayback((s) => s.playing)
  const reduceMotion = useReducedMotion()
  const pulse = playing && !reduceMotion

  const searchPhase = phase === "search"
  const zoningPhase = phase === "zoning"
  const routePhase = phase === "routes"

  const ring: Record<Mark, string> = {
    none: "transparent",
    frontier: t.status.accent,
    onboard: t.status.warn,
    delivered: t.status.good,
    late: t.status.bad,
    repaired: t.status.bad,
  }

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

  // Glyph and stroke sizes are authored in pixels and converted to viewBox
  // units against the CURRENT box and the stage's real width. Zooming in
  // shrinks the box, so a node keeps the same size on screen at every zoom
  // level; a narrow phone stage no longer shrinks every glyph to a speck.
  // The 1.2 keeps desktop sizing where it was tuned.
  const u = (px: number) => (px / (Math.max(stagePx, 1) * 1.2)) * viewBox.w

  // Stop id -> status ring, derived purely from the folded view. Later rules
  // win: an order's outcome overrides the search state of the same stop.
  const marks = useMemo(() => {
    const m = new Map<number, Mark>()
    if (searchPhase) for (const id of view.frontier) m.set(id, "frontier")
    for (const oid of view.pickedUp) {
      const o = orderOf.get(oid)
      if (o && !view.dropped.has(oid)) m.set(o.pickup, "onboard")
    }
    for (const oid of view.dropped) {
      const o = orderOf.get(oid)
      if (o) m.set(o.drop, view.late.has(oid) ? "late" : "delivered")
    }
    // An order the repair loop removed is never picked up or dropped, so it is
    // marked on both of its stops, a beat before a live deadline miss would be.
    for (const oid of view.repaired) {
      const o = orderOf.get(oid)
      if (o) { m.set(o.pickup, "repaired"); m.set(o.drop, "repaired") }
    }
    return m
  }, [view, orderOf, searchPhase])

  const isSelectedNode = (id: number) => selection?.kind === "node" && selection.id === id
  const isSelectedEdge = (a: number, b: number) =>
    selection?.kind === "edge" &&
    ((selection.u === a && selection.v === b) || (selection.u === b && selection.v === a))

  // How loud each backdrop layer is. Once routes are on screen, everything
  // that is not a route steps back so the answer reads first.
  const roadOpacity = routePhase ? 0.35 : 0.6
  const subsidyOpacity = routePhase ? 0.3 : 0.8
  const mstOpacity = routePhase ? 0.15 : zoningPhase ? 0.95 : 0.55

  return (
    <svg
      viewBox={viewBoxString(viewBox)}
      className="h-full w-full touch-none select-none"
      role="img"
      aria-label={`Delivery network: ${inst.nodes.length} nodes, ${inst.edges.length} edges, ${plans.length} vehicle routes`}
    >
      {/* ---- road network: the backdrop */}
      <g>
        {inst.edges.map((e) => {
          const a = pos.get(e.u)!, b = pos.get(e.v)!
          const key = e.u < e.v ? `${e.u}-${e.v}` : `${e.v}-${e.u}`
          const relaxed = !routePhase && view.relaxed.has(key)
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
              strokeWidth={u(chosen ? 3 : relaxed ? 2 : 1.2)}
              strokeDasharray={subsidised && !relaxed && !chosen ? `${u(4)} ${u(4)}` : undefined}
              initial={false}
              animate={{ opacity: chosen || relaxed ? 1 : subsidised ? subsidyOpacity : roadOpacity }}
              transition={{ duration: dur.base, ease: ease.out }}
              style={{ cursor: "pointer" }}
              onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: "edge", u: e.u, v: e.v }) }}
            />
          )
        })}
        {/* Transparent hit-lines: a 1.2px road is far too thin to click. */}
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

      {/* ---- MST zone links: stop-to-stop pairings from the clustering MST,
           NOT roads. Neutral dotted lines, so they never read as a route. */}
      <g>
        {[...view.mstEdges].map((key) => {
          const [us, vs] = key.split("-")
          const a = pos.get(Number(us)), b = pos.get(Number(vs))
          if (!a || !b) return null
          return (
            <motion.line
              key={`mst-${key}`}
              x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
              stroke={edgeStroke.mst} strokeWidth={u(1.8)}
              strokeDasharray={`${u(1)} ${u(5)}`} strokeLinecap="round"
              initial={{ opacity: 0 }} animate={{ opacity: mstOpacity }} exit={{ opacity: 0 }}
              transition={{ duration: dur.slow, ease: ease.out }}
            />
          )
        })}
      </g>

      {/* ---- vehicle routes: dark casing + colour line + direction arrows */}
      <AnimatePresence>
        {routePhase && plans.map((p) => {
          const pts = p.route.map((n) => pos.get(n)).filter((q): q is [number, number] => !!q)
          if (pts.length < 2) return null
          const color = vehicleColor(p.vehicle_id)
          const focused = focusedVehicle === p.vehicle_id
          const dimmed = focusedVehicle !== null && !focused
          const width = focused ? 4 : 3
          const points = pts.map(([x, y]) => `${x},${y}`).join(" ")

          const arrows: { x: number; y: number; deg: number }[] = []
          for (let i = 0; i < pts.length - 1; i++) {
            const [ax, ay] = pts[i], [bx, by] = pts[i + 1]
            if (Math.hypot(bx - ax, by - ay) < u(ARROW_MIN_SEGMENT)) continue
            arrows.push({
              x: (ax + bx) / 2, y: (ay + by) / 2,
              deg: (Math.atan2(by - ay, bx - ax) * 180) / Math.PI,
            })
          }
          const s = u(6.5)

          return (
            <motion.g
              key={`route-${p.vehicle_id}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: dimmed ? 0.12 : p.feasible ? 1 : 0.65 }}
              exit={{ opacity: 0, transition: { duration: dur.fast, ease: ease.in } }}
              transition={{ duration: dur.slow, ease: ease.out }}
              style={{ pointerEvents: "none" }}
            >
              <polyline points={points} fill="none" stroke={t.surface.canvas}
                        strokeWidth={u(width + 3.5)} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
              <polyline points={points} fill="none" stroke={color}
                        strokeWidth={u(width)} strokeLinejoin="round" strokeLinecap="round"
                        strokeDasharray={p.feasible ? undefined : `${u(8)} ${u(6)}`} />
              {arrows.map((a, i) => (
                <path
                  key={i}
                  d={`M${s} 0L${-s} ${s * 0.85}L${-s * 0.45} 0L${-s} ${-s * 0.85}Z`}
                  transform={`translate(${a.x} ${a.y}) rotate(${a.deg})`}
                  fill={color} stroke={t.surface.canvas} strokeWidth={u(1.2)} strokeLinejoin="round"
                />
              ))}
            </motion.g>
          )
        })}
      </AnimatePresence>

      {/* ---- stops. Shape says the role (circle pickup, square drop-off,
           large square depot, dot junction); the ring says the status. */}
      <g>
        {inst.nodes.map((n) => {
          const [x, y] = pos.get(n.id)!
          const h = u(HALF[n.kind] ?? 4)
          const mark = marks.get(n.id) ?? "none"
          const chosen = isSelectedNode(n.id)
          const quiet = mark === "repaired"
            || (searchPhase && !view.settled.has(n.id) && !view.frontier.has(n.id))
          const fill = mark === "late" ? t.status.bad : nodeFill[n.kind as keyof typeof nodeFill]
          const border = { stroke: t.surface.canvas, strokeWidth: u(n.kind === "junction" ? 1 : 2) }
          return (
            <motion.g
              key={n.id}
              initial={false}
              animate={{ opacity: quiet ? 0.4 : 1 }}
              transition={{ duration: dur.base, ease: ease.out }}
              style={{ cursor: "pointer" }}
              onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: "node", id: n.id }) }}
            >
              {n.kind !== "junction" && (
                <motion.circle
                  cx={x} cy={y} r={h + u(5)} fill="none" stroke={ring[mark]} strokeWidth={u(2.2)}
                  strokeDasharray={mark === "repaired" ? `${u(3)} ${u(2.5)}` : undefined}
                  initial={false} animate={{ opacity: mark === "none" ? 0 : 1 }}
                  transition={{ duration: dur.base, ease: ease.out }}
                />
              )}
              {chosen && (
                <circle cx={x} cy={y} r={h + u(9)} fill="none"
                        stroke={edgeStroke.selected} strokeWidth={u(1.5)} />
              )}
              {n.kind === "pickup" || n.kind === "junction" ? (
                <circle cx={x} cy={y} r={h} fill={fill} {...border} />
              ) : (
                <rect x={x - h} y={y - h} width={2 * h} height={2 * h}
                      rx={u(n.kind === "depot" ? 3 : 1.5)} fill={fill} {...border} />
              )}
            </motion.g>
          )
        })}
      </g>

      {/* ---- vehicles in motion: a solid chip with the vehicle number */}
      <g>
        {[...view.at.entries()].map(([vid, node]) => {
          const p = pos.get(node)
          if (!p) return null
          const color = vehicleColor(vid)
          const dimmed = focusedVehicle !== null && focusedVehicle !== vid
          return (
            <motion.g key={`veh-${vid}`}
                      animate={{ x: p[0], y: p[1], opacity: dimmed ? 0.15 : 1 }}
                      initial={false} transition={spring}
                      style={{ pointerEvents: "none" }}>
              {pulse && (
                <motion.circle
                  r={u(11)} fill="none" stroke={color} strokeWidth={u(2)}
                  initial={{ scale: 1, opacity: 0.8 }}
                  animate={{ scale: [1, 1.6, 1], opacity: [0.8, 0, 0.8] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
              <circle r={u(9)} fill={color} stroke={t.surface.canvas} strokeWidth={u(2)} />
              <text y={u(3.4)} textAnchor="middle" fontSize={u(10)} fontWeight={700}
                    fill={t.surface.canvas} className="mono">{vid}</text>
            </motion.g>
          )
        })}
      </g>

      {/* ---- labels on top of everything, with a canvas-coloured halo so a
           route or road passing behind never cuts through the text */}
      {labelsVisible && (
        <g style={{ pointerEvents: "none" }}>
          {inst.nodes.map((n) => {
            if (!n.label || n.kind === "junction") return null
            const [x, y] = pos.get(n.id)!
            const h = u(HALF[n.kind] ?? 4)
            const depot = n.kind === "depot"
            return (
              <text
                key={`lbl-${n.id}`}
                x={x} y={depot ? y + h + u(16) : y - h - u(8)}
                textAnchor="middle" fontSize={u(depot ? 12 : 11)} fontWeight={depot ? 700 : 500}
                fill={depot ? t.text.ink : t.text.muted}
                stroke={t.surface.canvas} strokeWidth={u(3.5)} strokeLinejoin="round"
                paintOrder="stroke" className="mono"
              >{n.label}</text>
            )
          })}
        </g>
      )}
    </svg>
  )
}
