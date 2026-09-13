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
