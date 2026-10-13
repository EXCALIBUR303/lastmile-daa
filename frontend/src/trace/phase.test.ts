import { describe, expect, it } from "vitest"
import { milestones, phaseAt } from "./phase"

const trace = ["build", "dijkstra", "dijkstra", "mst", "knapsack", "heldkarp", "sim", "knapsack", "sim"]
  .map((stage) => ({ stage }))
const m = milestones(trace)

describe("phaseAt", () => {
  it("finds the first zoning and route steps", () => {
    expect(m).toEqual({ zoningFrom: 3, routesFrom: 5 })
  })

  it("walks idle, search, zoning, routes", () => {
    expect(phaseAt(m, 0, trace.length)).toBe("idle")
    expect(phaseAt(m, 2, trace.length)).toBe("search")
    expect(phaseAt(m, 4, trace.length)).toBe("zoning")
    expect(phaseAt(m, 6, trace.length)).toBe("routes")
  })

  it("stays in routes when a later step is a selection step again", () => {
    expect(phaseAt(m, 8, trace.length)).toBe("routes") // step 8 is knapsack
  })

  it("always shows routes on the final frame", () => {
    const noRoutes = milestones([{ stage: "build" }, { stage: "dijkstra" }])
    expect(phaseAt(noRoutes, 2, 2)).toBe("routes")
  })
})
