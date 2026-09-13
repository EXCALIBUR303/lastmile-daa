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

export const useSolution = create<SolutionStore>((set) => ({
  data: null,
  loading: false,
  error: null,
  run: async (gen, cfg) => {
    set({ loading: true, error: null })
    usePlayback.getState().pause()
    try {
      const data = await solve(gen, cfg)
      set({ data, loading: false })
      usePlayback.getState().reset(data.trace.length)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
      usePlayback.getState().reset(0)
    }
  },
}))
