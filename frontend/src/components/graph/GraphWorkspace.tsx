import { AnimatePresence, motion } from "motion/react"
import { AlertTriangle, Crosshair, Loader2, Maximize2, Minus, Plus, Tag, TagsIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  clampZoom, clientToUnits, expandToAspect, fitViewBox, pixelsToUnits, zoomAt, type ViewBox,
} from "../../lib/geometry"
import { minutes } from "../../lib/format"
import { stageColor } from "../../lib/tokens"
import { useUi } from "../../store/ui"
import type { ViewState } from "../../trace/reducer"
import type { Instance, VehiclePlan } from "../../types"
import { IconButton } from "../ui/Field"
import { CanvasStage } from "./CanvasStage"
import { GraphLegend } from "./GraphLegend"
import { SelectionCard } from "./SelectionCard"

const ZOOM_STEP = 1.3

/** Pointer travel before a press counts as a pan rather than a click. */
const DRAG_THRESHOLD_PX = 4

/** Auto-hide labels once the network is too dense for them to be readable. */
const LABEL_AUTO_LIMIT = 70

export function GraphWorkspace({
  inst, plans, view, showRoutes, loading, error, stage, stepLabel,
}: {
  inst: Instance | null
  plans: VehiclePlan[]
  view: ViewState
  showRoutes: boolean
  loading: boolean
  error: string | null
  stage: string | null
  stepLabel: string
}) {
  const selection = useUi((s) => s.selection)
  const select = useUi((s) => s.select)
  const focusedVehicle = useUi((s) => s.focusedVehicle)

  const containerRef = useRef<HTMLDivElement>(null)
  const [labelsOn, setLabelsOn] = useState<boolean | null>(null) // null = automatic
  const [aspect, setAspect] = useState(1)

  // Track the stage's shape so the viewBox can fill it instead of being
  // letterboxed into a square in the middle of a wide panel.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setAspect(width / height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const baseBox = useMemo<ViewBox>(
    () => fitViewBox(inst ? inst.nodes : []),
    [inst],
  )
  const [box, setBox] = useState<ViewBox>(baseBox)
  const [lastBase, setLastBase] = useState(baseBox)

  // A new instance always starts fitted -- otherwise a zoomed-in view from the
  // previous graph would silently hide most of the new one. Done during render
  // so the canvas never paints one frame at the old zoom first.
  if (lastBase !== baseBox) {
    setLastBase(baseBox)
    setBox(baseBox)
  }

  // Stored box stays aspect-free so a window resize never disturbs the user's
  // zoom; the aspect correction is applied on the way out to the SVG. It is
  // idempotent, so feeding a corrected box back into state cannot drift.
  const renderBox = useMemo(() => expandToAspect(box, aspect), [box, aspect])
  const baseRenderBox = useMemo(() => expandToAspect(baseBox, aspect), [baseBox, aspect])

  const labelsVisible = labelsOn ?? (inst ? inst.nodes.length <= LABEL_AUTO_LIMIT : true)
  const zoomPct = Math.round((baseRenderBox.w / renderBox.w) * 100)

  const zoomBy = useCallback((factor: number) => {
    setBox((b) => {
      const centred = zoomAt(b, factor, { x: b.x + b.w / 2, y: b.y + b.h / 2 })
      return clampZoom(centred, baseBox)
    })
  }, [baseBox])

  const fit = useCallback(() => setBox(baseBox), [baseBox])

  // ---- wheel zoom anchored at the cursor
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      setBox((b) => {
        // Anchor against the box actually painted on screen, not the stored
        // one, or the cursor drifts on non-square stages.
        const painted = expandToAspect(b, aspect)
        const anchor = clientToUnits(e.clientX, e.clientY, painted, rect)
        const factor = e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP
        return clampZoom(zoomAt(painted, factor, anchor), baseBox)
      })
    }
    // non-passive so preventDefault actually stops the page from scrolling
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [baseBox, aspect])

  // ---- drag to pan
  //
  // Pointer capture is deliberately NOT taken on pointerdown. Capturing
  // retargets the following `click` to the capturing element, which swallowed
  // every node and edge selection. Capture only once the pointer has actually
  // travelled past a threshold, so a plain click (with the usual hand jitter)
  // still reaches the glyph underneath while a real drag still pans smoothly.
  const drag = useRef<{ x: number; y: number; active: boolean } | null>(null)
  const [panning, setPanning] = useState(false)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, active: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const start = drag.current
    const el = containerRef.current
    if (!start || !el) return

    if (!start.active) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD_PX) return
      start.active = true
      setPanning(true)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }

    const rect = el.getBoundingClientRect()
    setBox((b) => {
      const painted = expandToAspect(b, aspect)
      const d = pixelsToUnits(e.clientX - start.x, e.clientY - start.y, painted, rect)
      return { ...painted, x: painted.x - d.x, y: painted.y - d.y }
    })
    start.x = e.clientX
    start.y = e.clientY
  }
  const endPan = () => { drag.current = null; setPanning(false) }

  // ---- keyboard: zoom and fit without a mouse
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1 / ZOOM_STEP) }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(ZOOM_STEP) }
    if (e.key === "0") { e.preventDefault(); fit() }
    if (e.key === "Escape") select(null)
  }

  return (
    <div className="relative min-h-0 min-w-0 flex-1 bg-canvas">
      {/* ---- the stage itself */}
      <div
        ref={containerRef}
        role="application"
        aria-label="Delivery network canvas. Drag to pan, scroll to zoom, plus and minus to zoom, 0 to fit."
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onKeyDown={onKeyDown}
        onClick={(e) => { if (e.target === e.currentTarget) select(null) }}
        className={`h-full w-full outline-none focus-visible:ring-1 focus-visible:ring-inset
                    focus-visible:ring-accent ${panning ? "cursor-grabbing" : "cursor-grab"}`}
      >
        {inst && !error && (
          <CanvasStage
            inst={inst} plans={plans} view={view} showRoutes={showRoutes}
            viewBox={renderBox} selection={selection} focusedVehicle={focusedVehicle}
            onSelect={select} labelsVisible={labelsVisible}
          />
        )}
      </div>

      {/* ---- empty / error / busy states */}
      {!inst && !loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <Crosshair size={22} className="text-faint" aria-hidden />
          <p className="text-[13px] text-muted">No instance loaded</p>
          <p className="max-w-[260px] text-[11px] text-faint">
            Set the dataset parameters, then choose Run to generate a network and solve it.
          </p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div role="alert" className="max-w-[340px] rounded-md border border-bad/40 bg-bad/10 p-4">
            <div className="mb-1.5 flex items-center gap-2 text-bad">
              <AlertTriangle size={15} aria-hidden />
              <span className="text-[12px] font-semibold">Solve failed</span>
            </div>
            <p className="text-[11px] leading-relaxed text-muted">{error}</p>
            <p className="mt-2 text-[11px] text-faint">
              The last successful result is no longer shown. Adjust the parameters and run again.
            </p>
          </div>
        </div>
      )}

      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-canvas/55 backdrop-blur-[1px]"
          >
            <div className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2">
              <Loader2 size={14} className="animate-spin text-accent" aria-hidden />
              <span className="text-[12px] text-ink" role="status">Solving…</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- status readout (top-left) */}
      {inst && !error && (
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-md
                        border border-line bg-panel/88 px-2.5 py-1.5 backdrop-blur-sm">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: stage ? (stageColor[stage] ?? "#93a1bb") : "#6b7893" }}
          />
          <span className="text-[11px] text-muted">{stage ?? "idle"}</span>
          <span className="mono text-[11px] text-accent">{minutes(view.clock)}</span>
          <span className="mono text-[10px] text-faint">{stepLabel}</span>
          {view.late.size > 0 && (
            <span className="mono rounded bg-bad/20 px-1.5 py-px text-[10px] text-bad">
              {view.late.size} late
            </span>
          )}
        </div>
      )}

      {/* ---- graph toolbar (top-right) */}
      {inst && !error && (
        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md border border-line
                        bg-panel/88 p-1 backdrop-blur-sm">
          <IconButton label="Zoom in" size="sm" onClick={() => zoomBy(1 / ZOOM_STEP)}>
            <Plus size={14} aria-hidden />
          </IconButton>
          <IconButton label="Zoom out" size="sm" onClick={() => zoomBy(ZOOM_STEP)}>
            <Minus size={14} aria-hidden />
          </IconButton>
          <IconButton label="Fit network to view" size="sm" onClick={fit}>
            <Maximize2 size={14} aria-hidden />
          </IconButton>
          <IconButton
            label={labelsVisible ? "Hide stop labels" : "Show stop labels"}
            size="sm"
            active={labelsVisible}
            onClick={() => setLabelsOn(!labelsVisible)}
          >
            {labelsVisible ? <Tag size={14} aria-hidden /> : <TagsIcon size={14} aria-hidden />}
          </IconButton>
          <span className="mono px-1 text-[10px] text-faint" aria-live="polite">{zoomPct}%</span>
        </div>
      )}

      {/* ---- legend (bottom-left) and selection (bottom-right) */}
      {inst && !error && (
        <div className="pointer-events-none absolute bottom-3 left-3">
          <GraphLegend vehicleCount={plans.length} />
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 right-3">
        <AnimatePresence>
          {inst && selection && (
            <SelectionCard selection={selection} inst={inst} plans={plans} onClose={() => select(null)} />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
