// Written ONLY by user input. Never touched by playback.
import { create } from "zustand"
import type { GenerateRequest, SolveConfig } from "../types"

interface InstanceStore {
  gen: GenerateRequest
  cfg: SolveConfig
  setGen: (p: Partial<GenerateRequest>) => void
  setCfg: (p: Partial<SolveConfig>) => void
}

export const useInstance = create<InstanceStore>((set) => ({
  gen: {
    seed: 7, n_nodes: 32, density: 0.18, topology: "radial",
    n_orders: 12, n_vehicles: 3, capacity: 10, horizon: 480, neg_cost_frac: 0.08,
  },
  cfg: {
    apsp: "dijkstra", selector: "dp_deadline",
    sequencer: "auto", zoning: "prim", trace: true,
  },
  setGen: (p) => set((s) => ({ gen: { ...s.gen, ...p } })),
  setCfg: (p) => set((s) => ({ cfg: { ...s.cfg, ...p } })),
}))
