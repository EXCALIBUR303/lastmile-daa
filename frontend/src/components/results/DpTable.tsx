import { useEffect, useRef } from "react"

function heat(v: number | undefined, max: number): string {
  if (v === undefined) return "#161e2c"          // no entry recorded yet
  const t = max > 0 ? Math.min(1, v / max) : 0
  const l = 12 + t * 46
  const s = 45 + t * 35
  return `hsl(268 ${s}% ${l}%)`                   // dark panel -> violet, matches the
}                                                  // "knapsack" stage colour used elsewhere

/** T (time) is always in the hundreds -- unlike ApspMatrix's n x n, there is
 * no small-N case worth a DOM grid here, so this is canvas-only. Redraws
 * only when the underlying data actually changes (React deps), not per
 * animation frame -- cheap regardless of table size. */
export function DpTable({
  dpRow, dpCells, T, Q, totalOrders,
}: { dpRow: number; dpCells: Map<string, number>; T: number; Q: number; totalOrders: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const width = 320
  const height = Math.max(120, Math.min(320, Math.round((width * (Q + 1)) / (T + 1)) || 160))

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    let max = 0
    for (const v of dpCells.values()) if (v > max) max = v

    const cw = canvas.width / (T + 1)
    const ch = canvas.height / (Q + 1)
    for (const [key, value] of dpCells) {
      const [t, c] = key.split(",").map(Number)
      ctx.fillStyle = heat(value, max)
      ctx.fillRect(t * cw, canvas.height - (c + 1) * ch, Math.max(1, cw), Math.max(1, ch))
    }
  }, [dpCells, T, Q])

  if (dpRow < 0 && dpCells.size === 0) {
    return (
      <p className="rounded border border-line bg-raised/40 px-3 py-6 text-center text-[11px] leading-relaxed text-muted">
        The DP table fills in during playback. Choose a dynamic-programming selector under{" "}
        <span className="text-ink">Order selection</span>, then play the simulation to watch the
        knapsack-with-deadlines table build up.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium text-ink">Knapsack DP table</span>
        <span className="mono text-[10px] text-faint">
          {dpRow >= 0 ? `order ${dpRow} / ${totalOrders}` : "not started"}
        </span>
      </div>

      <div className="flex gap-1.5">
        <div className="flex w-3 shrink-0 items-center justify-center">
          <span className="whitespace-nowrap text-[10px] text-faint"
                style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
            load used (units) →
          </span>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <canvas ref={ref} width={width} height={height}
                  className="w-full rounded border border-line"
                  aria-label="Dynamic programming table: reachable states by elapsed time and load used" />
          <div className="flex items-center justify-between text-[10px] text-faint">
            <span className="mono">0</span>
            <span>elapsed time (min) →</span>
            <span className="mono">{T}</span>
          </div>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-faint">
        Each lit cell is a state (elapsed time, load used) the DP proved reachable; brighter means a
        higher profit is achievable from it. Cells appear as orders are considered, earliest deadline first.
      </p>
    </div>
  )
}
