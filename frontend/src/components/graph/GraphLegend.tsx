import { AnimatePresence, motion } from "motion/react"
import { ChevronDown } from "lucide-react"
import { useTokens, vehicleColorFor } from "../../lib/tokens"
import { dur, ease } from "../../motion/presets"
import { useUi } from "../../store/ui"

/** Swatches are drawn with the same shapes the canvas uses, so the legend is
 *  a literal key rather than an approximation of it. */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg width="20" height="14" viewBox="-10 -7 20 14" className="shrink-0" aria-hidden>
      {children}
    </svg>
  )
}

function Line({ color, dashed, dotted, width = 2, arrow = false, casing }: {
  color: string; dashed?: boolean; dotted?: boolean; width?: number; arrow?: boolean; casing?: string
}) {
  return (
    <Glyph>
      {casing && <line x1="-9" y1="0" x2="9" y2="0" stroke={casing} strokeWidth={width + 2.5} strokeLinecap="round" />}
      <line x1="-9" y1="0" x2="9" y2="0" stroke={color} strokeWidth={width} strokeLinecap="round"
            strokeDasharray={dotted ? "0.5 3.5" : dashed ? "3 3" : undefined} />
      {arrow && <path d="M4 0L-2.5 3.4L-0.6 0L-2.5 -3.4Z" fill={color} stroke={casing} strokeWidth="0.8" />}
    </Glyph>
  )
}

function Row({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5 text-caption leading-tight text-muted">
      {swatch}
      <span className="truncate">{children}</span>
    </li>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-caption font-medium text-faint">{title}</p>
      <ul className="space-y-1">{children}</ul>
    </div>
  )
}

export function GraphLegend({ vehicleCount }: { vehicleCount: number }) {
  const t = useTokens()
  const { edgeStroke, nodeFill, status, surface } = t
  const open = useUi((s) => s.legendOpen)
  const toggle = useUi((s) => s.toggleLegend)
  const bg = surface.canvas
  const ring = (color: string, dashed = false) => (
    <Glyph>
      <circle r="5.5" fill="none" stroke={color} strokeWidth="1.6" strokeDasharray={dashed ? "2 1.6" : undefined} />
      <circle r="2.6" fill={nodeFill.pickup} />
    </Glyph>
  )

  return (
    <div className="pointer-events-auto w-[248px] rounded-md border border-line bg-panel">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="graph-legend"
        className="flex min-h-[44px] w-full items-center gap-1.5 px-2.5 py-1.5 text-caption font-semibold text-ink md:min-h-0
                   focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2
                   focus-visible:outline-accent"
      >
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: dur.fast, ease: ease.out }}
                     className="text-faint">
          <ChevronDown size={12} aria-hidden />
        </motion.span>
        Legend
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="graph-legend"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: dur.fast, ease: ease.out }}
          >
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 px-2.5 pb-2.5">
              <Group title="Stop (shape)">
                <Row swatch={<Glyph><rect x="-5" y="-5" width="10" height="10" rx="2" fill={nodeFill.depot} /></Glyph>}>Depot</Row>
                <Row swatch={<Glyph><circle r="4.5" fill={nodeFill.pickup} /></Glyph>}>Pickup</Row>
                <Row swatch={<Glyph><rect x="-4" y="-4" width="8" height="8" rx="1" fill={nodeFill.drop} /></Glyph>}>Drop-off</Row>
                <Row swatch={<Glyph><circle r="2.2" fill={nodeFill.junction} /></Glyph>}>Junction</Row>
              </Group>

              <Group title="Status (ring)">
                <Row swatch={ring(status.accent)}>Searching</Row>
                <Row swatch={ring(status.warn)}>On board</Row>
                <Row swatch={ring(status.good)}>On time</Row>
                <Row swatch={<Glyph><rect x="-4" y="-4" width="8" height="8" rx="1" fill={status.bad} /></Glyph>}>Late</Row>
                <Row swatch={ring(status.bad, true)}>Dropped</Row>
              </Group>

              <Group title="Routes (colour)">
                {Array.from({ length: Math.min(vehicleCount, 5) }, (_, i) => (
                  <Row key={i} swatch={<Line color={vehicleColorFor(t, i)} width={2.5} arrow casing={bg} />}>
                    Vehicle {i}
                  </Row>
                ))}
                <Row swatch={<Line color={t.text.muted} dashed width={2.5} />}>Infeasible</Row>
                <Row swatch={
                  <Glyph>
                    <circle r="5.5" fill={vehicleColorFor(t, 0)} stroke={bg} strokeWidth="1" />
                    <text y="2.6" textAnchor="middle" fontSize="7" fontWeight="700" fill={bg}>0</text>
                  </Glyph>
                }>Vehicle now</Row>
              </Group>

              <Group title="Roads">
                <Row swatch={<Line color={edgeStroke.network} width={1.5} />}>Road</Row>
                <Row swatch={<Line color={edgeStroke.subsidised} dashed />}>Subsidised</Row>
                <Row swatch={<Line color={edgeStroke.relaxed} />}>Relaxed</Row>
                <Row swatch={<Line color={edgeStroke.mst} dotted width={2.2} />}>MST link</Row>
                <Row swatch={<Glyph><circle r="5.5" fill="none" stroke={edgeStroke.selected} strokeWidth="1.2" /></Glyph>}>Selected</Row>
              </Group>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
