import { Fragment, useEffect, useRef } from "react"
import { motion } from "motion/react"
import { minutes } from "../../lib/format"
import { useTokens, type Palette } from "../../lib/tokens"
import type { ApspMatrixData } from "../../types"

const DOM_GRID_MAX_N = 48

/** Ramp runs dark->bright on the dark theme and bright->dark on the light one,
 *  so "further away" always reads as more contrast against the surface. */
function heatFor(p: Palette) {
  return (v: number | null, min: number, max: number): string => {
    if (v === null) return p.surface.line
    const t = max > min ? (v - min) / (max - min) : 0
    const l = p.heat.lightFrom + t * (p.heat.lightTo - p.heat.lightFrom)
    const s = 55 + t * 15
    return `hsl(${p.heat.apspHue} ${s}% ${l}%)`
  }
}

function Scale({ min, max }: { min: number; max: number }) {
  const heat = heatFor(useTokens())
  return (
    <div className="flex items-center gap-2">
      <span className="mono text-[10px] text-faint">{minutes(min)}</span>
      <div
        className="h-1.5 flex-1 rounded-full"
        style={{ background: `linear-gradient(90deg, ${heat(min, min, max)}, ${heat(max, min, max)})` }}
        aria-hidden
      />
      <span className="mono text-[10px] text-faint">{minutes(max)}</span>
    </div>
  )
}

function CanvasHeatmap({ apsp, k }: { apsp: ApspMatrixData; k: number }) {
  const palette = useTokens()
  const ref = useRef<HTMLCanvasElement>(null)
  const n = apsp.node_ids.length
  const finite = apsp.matrix.flat().filter((x): x is number => x !== null)
  const min = finite.length ? Math.min(...finite) : 0
  const max = finite.length ? Math.max(...finite) : 1

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const heat = heatFor(palette)
    const cell = canvas.width / n
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = heat(apsp.matrix[i][j], min, max)
        ctx.fillRect(j * cell, i * cell, cell + 0.5, cell + 0.5)
      }
    }
    if (k >= 0) {
      ctx.fillStyle = `color-mix(in srgb, ${palette.status.warn} 22%, transparent)`
      ctx.fillRect(0, k * cell, canvas.width, cell)
      ctx.fillRect(k * cell, 0, cell, canvas.height)
    }
  }, [apsp, k, n, min, max, palette])

  return (
    <div className="space-y-1.5">
      <canvas ref={ref} width={320} height={320}
              className="w-full rounded border border-line"
              aria-label={`${n} by ${n} all-pairs distance heatmap`} />
      <Scale min={min} max={max} />
    </div>
  )
}

function DomGrid({ apsp, k }: { apsp: ApspMatrixData; k: number }) {
  const palette = useTokens()
  const heat = heatFor(palette)
  const band = `color-mix(in srgb, ${palette.status.warn} 22%, transparent)`
  const n = apsp.node_ids.length
  const finite = apsp.matrix.flat().filter((x): x is number => x !== null)
  const min = finite.length ? Math.min(...finite) : 0
  const max = finite.length ? Math.max(...finite) : 1
  const cellPx = Math.max(14, Math.min(24, Math.floor(300 / (n + 1))))

  return (
    <div className="space-y-1.5">
      <div className="scroll-thin overflow-auto rounded border border-line" style={{ maxHeight: 320 }}>
        <div className="grid w-max" style={{ gridTemplateColumns: `repeat(${n + 1}, ${cellPx}px)` }}>
          <div style={{ height: cellPx }} />
          {apsp.node_ids.map((id, j) => (
            <div
              key={`h${id}`}
              className="mono flex items-center justify-center text-[10px] text-faint"
              style={{ height: cellPx, background: j === k ? band : "transparent" }}
            >{id}</div>
          ))}
          {apsp.node_ids.map((rid, i) => (
            <Fragment key={`row${rid}`}>
              <div
                className="mono flex items-center justify-center text-[10px] text-faint"
                style={{ width: cellPx, background: i === k ? band : "transparent" }}
              >{rid}</div>
              {apsp.node_ids.map((_, j) => {
                const v = apsp.matrix[i][j]
                const onBand = i === k || j === k
                return (
                  <motion.div
                    key={`c${i}-${j}`}
                    initial={false}
                    animate={{ outline: onBand ? `1px solid ${palette.status.warn}` : "1px solid transparent" }}
                    transition={{ duration: 0.2 }}
                    title={`n${apsp.node_ids[i]} → n${apsp.node_ids[j]} = ${v === null ? "unreachable" : minutes(v)}`}
                    style={{ height: cellPx, background: heat(v, min, max) }}
                  />
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <Scale min={min} max={max} />
    </div>
  )
}

export function ApspMatrix({ apsp, k }: { apsp: ApspMatrixData | null; k: number }) {
  if (!apsp) {
    return (
      <p className="rounded border border-line bg-raised/40 px-3 py-6 text-center text-[11px] leading-relaxed text-muted">
        No all-pairs matrix for this run. Choose <span className="text-ink">Floyd-Warshall</span> or{" "}
        <span className="text-ink">Johnson</span> under Shortest paths, then Run — targeted Dijkstra
        only computes distances from stop nodes, so it produces no full n×n matrix.
      </p>
    )
  }

  const n = apsp.node_ids.length
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium text-ink">
          {apsp.algorithm === "floyd" ? "Floyd-Warshall" : "Johnson"}
        </span>
        <span className="mono text-[10px] text-faint">
          {n}×{n}
          {apsp.algorithm === "floyd" && (k >= 0 ? ` · k=${k}` : " · not started")}
        </span>
      </div>
      {/* Johnson has no k-phase sweep -- it's n independent Dijkstra runs,
          not a shared intermediate-node loop -- so the highlight band only
          ever applies to Floyd-Warshall; passing k=-1 here just keeps it off. */}
      {n > DOM_GRID_MAX_N
        ? <CanvasHeatmap apsp={apsp} k={apsp.algorithm === "floyd" ? k : -1} />
        : <DomGrid apsp={apsp} k={apsp.algorithm === "floyd" ? k : -1} />}
      <p className="text-[10px] leading-relaxed text-faint">
        Cell (i, j) is the shortest travel time from node i to node j; brighter means further.
        {apsp.algorithm === "floyd" && " The amber band is the current intermediate node k."}
      </p>
    </div>
  )
}
