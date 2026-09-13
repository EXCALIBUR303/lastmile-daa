import { Fragment, useEffect, useRef } from "react"
import { motion } from "motion/react"
import type { ApspMatrixData } from "../types"

const DOM_GRID_MAX_N = 48

function heat(v: number | null, min: number, max: number): string {
  if (v === null) return "#1e2839"
  const t = max > min ? (v - min) / (max - min) : 0
  // dark panel -> accent cyan, low(close)=dark, high(far)=bright
  const l = 14 + t * 40
  const s = 55 + t * 15
  return `hsl(198 ${s}% ${l}%)`
}

function CanvasHeatmap({ apsp, k }: { apsp: ApspMatrixData; k: number }) {
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
    const cell = canvas.width / n
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = heat(apsp.matrix[i][j], min, max)
        ctx.fillRect(j * cell, i * cell, cell + 0.5, cell + 0.5)
      }
    }
    if (k >= 0) {
      ctx.fillStyle = "rgba(255,200,87,0.22)"
      ctx.fillRect(0, k * cell, canvas.width, cell)
      ctx.fillRect(k * cell, 0, cell, canvas.height)
    }
  }, [apsp, k, n, min, max])

  return <canvas ref={ref} width={320} height={320} className="w-full rounded-md" />
}

function DomGrid({ apsp, k }: { apsp: ApspMatrixData; k: number }) {
  const n = apsp.node_ids.length
  const finite = apsp.matrix.flat().filter((x): x is number => x !== null)
  const min = finite.length ? Math.min(...finite) : 0
  const max = finite.length ? Math.max(...finite) : 1
  const cellPx = Math.max(14, Math.min(24, Math.floor(300 / (n + 1))))

  return (
    <div className="overflow-auto rounded-md border border-line" style={{ maxHeight: 340 }}>
      <div
        className="grid w-max"
        style={{ gridTemplateColumns: `repeat(${n + 1}, ${cellPx}px)` }}
      >
        <div style={{ height: cellPx }} />
        {apsp.node_ids.map((id, j) => (
          <div
            key={`h${id}`}
            className="tabular flex items-center justify-center text-[9px]"
            style={{ height: cellPx, background: j === k ? "#3a2f1a" : "transparent", color: "#7d8aa3" }}
          >{id}</div>
        ))}
        {apsp.node_ids.map((rid, i) => (
          <Fragment key={`row${rid}`}>
            <div
              className="tabular flex items-center justify-center text-[9px]"
              style={{ width: cellPx, background: i === k ? "#3a2f1a" : "transparent", color: "#7d8aa3" }}
            >{rid}</div>
            {apsp.node_ids.map((_, j) => {
              const v = apsp.matrix[i][j]
              const onBand = i === k || j === k
              return (
                <motion.div
                  key={`c${i}-${j}`}
                  initial={false}
                  animate={{ outline: onBand ? "1px solid #ffc857" : "1px solid transparent" }}
                  transition={{ duration: 0.2 }}
                  title={`${apsp.node_ids[i]}→${apsp.node_ids[j]} = ${v ?? "∞"}`}
                  className="tabular flex items-center justify-center text-[8px] text-ink/80"
                  style={{ height: cellPx, background: heat(v, min, max) }}
                />
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

export function ApspMatrix({ apsp, k }: { apsp: ApspMatrixData | null; k: number }) {
  if (!apsp) {
    return (
      <div className="rounded-md border border-line bg-bg px-3 py-6 text-center text-[11px] text-muted">
        Select Floyd-Warshall or Johnson (Algorithms panel) to see the all-pairs distance matrix.
      </div>
    )
  }
  const n = apsp.node_ids.length
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-muted">
        <span className="uppercase tracking-wider">{apsp.algorithm === "floyd" ? "Floyd-Warshall" : "Johnson"} · {n}×{n}</span>
        {apsp.algorithm === "floyd" && (
          <span className="tabular">{k >= 0 ? `k=${k}` : "not started"}</span>
        )}
      </div>
      {/* Johnson has no k-phase sweep -- it's n independent Dijkstra runs,
          not a shared intermediate-node loop -- so the highlight band only
          ever applies to Floyd-Warshall; passing k=-1 here just keeps it off. */}
      {n > DOM_GRID_MAX_N
        ? <CanvasHeatmap apsp={apsp} k={apsp.algorithm === "floyd" ? k : -1} />
        : <DomGrid apsp={apsp} k={apsp.algorithm === "floyd" ? k : -1} />}
    </div>
  )
}
