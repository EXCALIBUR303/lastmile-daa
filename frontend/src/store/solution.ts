// Written ONCE per run, then frozen. Playback never mutates it.
import { create } from "zustand"
import { solve } from "../api"
import type { GenerateRequest, SolveConfig, SolveResponse } from "../types"
import { usePlayback } from "./playback"

interface SolutionStore {
  data: SolveResponse | null
  loading: boolean
  error: string | null
  run: (gen: GenerateRequest, cfg: SolveConfig) => Promise<void>
}

// Only the newest run may write results: starting another solve cancels the
// one in flight, so a slow earlier response can never overwrite a later one.
let inflight: AbortController | null = null

export const useSolution = create<SolutionStore>((set) => ({
  data: null,
  loading: false,
  error: null,
  run: async (gen, cfg) => {
    inflight?.abort()
    const ac = new AbortController()
    inflight = ac
    set({ loading: true, error: null })
    usePlayback.getState().pause()
    try {
      const data = await solve(gen, cfg, ac.signal)
      if (ac.signal.aborted) return
      set({ data, loading: false })
      usePlayback.getState().reset(data.trace.length)
    } catch (e) {
      if (ac.signal.aborted) return
      // Drop the previous result: the canvas cannot be drawn from a failed
      // run, and leaving the old numbers beside an error would contradict it.
      set({ data: null, error: e instanceof Error ? e.message : String(e), loading: false })
      usePlayback.getState().reset(0)
    }
  },
}))
