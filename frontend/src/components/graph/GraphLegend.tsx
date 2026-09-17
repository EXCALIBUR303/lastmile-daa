import { AnimatePresence, motion } from "motion/react"
import { ChevronDown } from "lucide-react"
import { useTokens, vehicleColorFor } from "../../lib/tokens"
import { useUi } from "../../store/ui"

function Dot({ color, ring = false }: { color: string; ring?: boolean }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: ring ? "transparent" : color, boxShadow: ring ? `inset 0 0 0 2px ${color}` : undefined }}
    />
  )
}

function Dash({ color, dashed = false, width = 2 }: { color: string; dashed?: boolean; width?: number }) {
  return (
    <svg width="18" height="8" className="shrink-0" aria-hidden>
      <line x1="0" y1="4" x2="18" y2="4" stroke={color} strokeWidth={width}
            strokeDasharray={dashed ? "3 3" : undefined} strokeLinecap="round" />
    </svg>
  )
}

function Row({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5 text-[10px] leading-tight text-muted">
      {swatch}
      <span className="truncate">{children}</span>
    </li>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-faint">{title}</p>
      <ul className="space-y-1">{children}</ul>
    </div>
  )
}

export function GraphLegend({ vehicleCount }: { vehicleCount: number }) {
  const t = useTokens()
  const { edgeStroke, nodeFill, status, text } = t
  const vehicleColor = (i: number) => vehicleColorFor(t, i)
  const open = useUi((s) => s.legendOpen)
  const toggle = useUi((s) => s.toggleLegend)

  return (
    <div className="pointer-events-auto w-[212px] rounded-md border border-line bg-panel/92 backdrop-blur-sm">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="graph-legend"
        className="flex min-h-[44px] w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-ink md:min-h-0
                   focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2
                   focus-visible:outline-accent"
      >
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.18 }} className="text-faint">
          <ChevronDown size={12} aria-hidden />
        </motion.span>
        Legend
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="graph-legend"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-2.5 pb-2.5">
              <Group title="Stops">
                <Row swatch={<Dot color={nodeFill.depot} />}>Depot</Row>
                <Row swatch={<Dot color={nodeFill.pickup} />}>Pickup</Row>
                <Row swatch={<Dot color={nodeFill.drop} />}>Drop-off</Row>
                <Row swatch={<Dot color={nodeFill.junction} />}>Junction</Row>
              </Group>

              <Group title="Edges">
                <Row swatch={<Dash color={edgeStroke.network} width={1.5} />}>Road</Row>
                <Row swatch={<Dash color={edgeStroke.subsidised} dashed />}>Subsidised</Row>
                <Row swatch={<Dash color={edgeStroke.relaxed} />}>Relaxed</Row>
                <Row swatch={<Dash color={edgeStroke.mst} dashed />}>MST link</Row>
              </Group>

              <Group title="Routes">
                {Array.from({ length: Math.min(vehicleCount, 5) }, (_, i) => (
                  <Row key={i} swatch={<Dash color={vehicleColor(i)} width={2.5} />}>
                    Vehicle {i}
                  </Row>
                ))}
                <Row swatch={<Dash color={text.muted} dashed width={2.5} />}>Infeasible</Row>
              </Group>

              <Group title="State">
                <Row swatch={<Dot color={status.bad} />}>Late / dropped</Row>
                <Row swatch={<Dot color={edgeStroke.selected} ring />}>Selected</Row>
                <Row swatch={<Dot color={status.warn} />}>In transit</Row>
              </Group>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
