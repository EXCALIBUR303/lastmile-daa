import { useEffect } from "react"
import { usePlayback } from "../store/playback"

const MAX_CATCHUP = 64

/** One setState per animation frame, capped catch-up, self-terminating. */
export function usePlaybackClock() {
  const playing = usePlayback((s) => s.playing)
  const speed = usePlayback((s) => s.speed)
  const total = usePlayback((s) => s.total)

  useEffect(() => {
    if (!playing || total === 0) return
    let raf = 0
    let acc = 0
    let last = performance.now()
    const tick = (now: number) => {
      acc += now - last
      last = now
      const msPerStep = 1000 / speed
      let n = 0
      while (acc >= msPerStep && n < MAX_CATCHUP) { acc -= msPerStep; n++ }
      if (n) usePlayback.getState().advance(n)
      if (usePlayback.getState().cursor < total) raf = requestAnimationFrame(tick)
      else usePlayback.getState().pause()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, total])
}

export function Transport() {
  const { cursor, total, playing, speed, seek, toggle, setSpeed } = usePlayback()
  const disabled = total === 0

  return (
    <div className="flex items-center gap-3 border-t border-line bg-panel px-4 py-2.5">
      <div className="flex items-center gap-1">
        <Btn onClick={() => seek(0)} disabled={disabled} label="⏮" />
        <Btn onClick={() => seek(cursor - 1)} disabled={disabled} label="◀" />
        <button
          onClick={toggle} disabled={disabled}
          className="mx-1 h-8 w-16 rounded-md bg-accent text-[12px] font-semibold text-bg disabled:opacity-30"
        >{playing ? "Pause" : "Play"}</button>
        <Btn onClick={() => seek(cursor + 1)} disabled={disabled} label="▶" />
        <Btn onClick={() => seek(total)} disabled={disabled} label="⏭" />
      </div>

      <input
        type="range" min={0} max={Math.max(0, total)} value={cursor}
        onChange={(e) => seek(Number(e.target.value))} disabled={disabled}
        className="flex-1"
      />
      <span className="tabular w-24 text-right text-[12px] text-muted">
        {cursor} / {total}
      </span>

      <label className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted">Speed</span>
        <input type="range" min={1} max={120} value={speed}
               onChange={(e) => setSpeed(Number(e.target.value))} className="w-28" />
        <span className="tabular w-14 text-[12px] text-muted">{speed}/s</span>
      </label>
    </div>
  )
}

function Btn({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="h-8 w-8 rounded-md border border-line bg-bg text-[12px] text-ink transition-colors hover:border-accent disabled:opacity-30">
      {label}
    </button>
  )
}
