import { Pause, Play, RotateCcw, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react"
import { usePlayback } from "../../store/playback"
import { IconButton } from "../ui/Field"

/**
 * Playback transport. Rendered inside the control inspector on desktop and as
 * a slim bar under the graph on smaller screens -- one component either way,
 * so there is never a second copy of this state to keep in sync.
 */
export function SimulationControls({ compact = false }: { compact?: boolean }) {
  const { cursor, total, playing, speed, seek, toggle, setSpeed } = usePlayback()
  const disabled = total === 0
  const pct = total > 0 ? (cursor / total) * 100 : 0

  const transport = (
    <div className="flex items-center gap-1">
      <IconButton label="Restart from first step" size="sm" disabled={disabled} onClick={() => seek(0)}>
        <SkipBack size={13} aria-hidden />
      </IconButton>
      <IconButton label="Previous step" size="sm" disabled={disabled} onClick={() => seek(cursor - 1)}>
        <StepBack size={13} aria-hidden />
      </IconButton>
      <IconButton
        label={playing ? "Pause simulation" : "Play simulation"}
        tone="primary"
        disabled={disabled}
        onClick={toggle}
      >
        {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
      </IconButton>
      <IconButton label="Next step" size="sm" disabled={disabled} onClick={() => seek(cursor + 1)}>
        <StepForward size={13} aria-hidden />
      </IconButton>
      <IconButton label="Jump to final step" size="sm" disabled={disabled} onClick={() => seek(total)}>
        <SkipForward size={13} aria-hidden />
      </IconButton>
      {!compact && (
        <IconButton label="Reset playback" size="sm" disabled={disabled} onClick={() => seek(0)}>
          <RotateCcw size={13} aria-hidden />
        </IconButton>
      )}
    </div>
  )

  const timeline = (
    <input
      type="range"
      min={0}
      max={Math.max(0, total)}
      value={cursor}
      disabled={disabled}
      aria-label="Simulation timeline position"
      aria-valuetext={`Step ${cursor} of ${total}`}
      onChange={(e) => seek(Number(e.target.value))}
      className="w-full"
    />
  )

  if (compact) {
    return (
      <div className="flex items-center gap-3 border-t border-line bg-panel px-3 py-2">
        {transport}
        <div className="min-w-0 flex-1">{timeline}</div>
        <span className="mono shrink-0 text-caption text-muted">
          {cursor}/{total}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {transport}

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-caption font-medium text-muted">Timeline</span>
          <span className="mono text-caption text-ink">
            {cursor.toLocaleString()} / {total.toLocaleString()}
          </span>
        </div>
        {timeline}
        <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-line" aria-hidden>
          <div className="h-full w-full origin-left rounded-full bg-accent/60" style={{ transform: `scaleX(${Math.min(1, Math.max(0, pct / 100))})` }} />
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-caption font-medium text-muted">Speed</span>
          <span className="mono text-caption text-ink">{speed} steps/s</span>
        </div>
        <input
          type="range" min={1} max={120} value={speed}
          aria-label="Playback speed in steps per second"
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="mt-1 w-full"
        />
      </div>
    </div>
  )
}
