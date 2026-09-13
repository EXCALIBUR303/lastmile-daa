// The ONLY store that moves during animation.
import { create } from "zustand"

interface PlaybackStore {
  cursor: number
  total: number
  playing: boolean
  speed: number // steps per second
  reset: (total: number) => void
  advance: (n: number) => void
  seek: (cursor: number) => void
  play: () => void
  pause: () => void
  toggle: () => void
  setSpeed: (speed: number) => void
}

export const usePlayback = create<PlaybackStore>((set, get) => ({
  cursor: 0,
  total: 0,
  playing: false,
  speed: 24,
  reset: (total) => set({ cursor: 0, total, playing: false }),
  advance: (n) => set((s) => ({ cursor: Math.min(s.total, s.cursor + n) })),
  seek: (cursor) => set((s) => ({ cursor: Math.max(0, Math.min(s.total, cursor)) })),
  play: () => set((s) => ({ playing: s.cursor < s.total })),
  pause: () => set({ playing: false }),
  toggle: () => (get().playing ? get().pause() : get().play()),
  setSpeed: (speed) => set({ speed }),
}))
