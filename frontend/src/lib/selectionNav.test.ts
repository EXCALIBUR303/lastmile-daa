import { describe, expect, it } from "vitest"
import { describeSelection, stepSelection } from "./selectionNav"

const graph = {
  nodes: [
    { id: 0, x: 0, y: 0, kind: "depot", label: "DEPOT" },
    { id: 1, x: 1, y: 0, kind: "pickup", label: "P1" },
    { id: 2, x: 0, y: 1, kind: "junction", label: "" },
  ],
  edges: [
    { u: 0, v: 1, tau: 1, cost: 1, cost_vu: 1 },
    { u: 1, v: 2, tau: 1, cost: 1, cost_vu: 1 },
  ],
} as unknown as Parameters<typeof stepSelection>[0]

describe("stepSelection", () => {
  it("starts at the first item going forward and the last going back", () => {
    expect(stepSelection(graph, null, "node", 1)).toEqual({ kind: "node", id: 0 })
    expect(stepSelection(graph, null, "node", -1)).toEqual({ kind: "node", id: 2 })
  })

  it("wraps at both ends", () => {
    expect(stepSelection(graph, { kind: "node", id: 2 }, "node", 1)).toEqual({ kind: "node", id: 0 })
    expect(stepSelection(graph, { kind: "node", id: 0 }, "node", -1)).toEqual({ kind: "node", id: 2 })
  })

  it("treats a road as the same road in either direction", () => {
    expect(stepSelection(graph, { kind: "edge", u: 1, v: 0 }, "edge", 1)).toEqual({ kind: "edge", u: 1, v: 2 })
  })

  it("starts over when stepping a different kind than is selected", () => {
    expect(stepSelection(graph, { kind: "node", id: 1 }, "edge", 1)).toEqual({ kind: "edge", u: 0, v: 1 })
  })

  it("leaves the selection alone on an empty graph", () => {
    const empty = { nodes: [], edges: [] } as unknown as Parameters<typeof stepSelection>[0]
    expect(stepSelection(empty, null, "node", 1)).toBeNull()
  })
})

describe("describeSelection", () => {
  it("names stops by label and falls back for unlabelled junctions", () => {
    expect(describeSelection(graph, { kind: "node", id: 1 })).toBe("P1, pickup")
    expect(describeSelection(graph, { kind: "node", id: 2 })).toBe("junction 2, junction")
  })

  it("describes a road by its endpoints", () => {
    expect(describeSelection(graph, { kind: "edge", u: 0, v: 1 })).toBe("Road between DEPOT and P1")
  })

  it("is empty with nothing selected", () => {
    expect(describeSelection(graph, null)).toBe("")
  })
})
