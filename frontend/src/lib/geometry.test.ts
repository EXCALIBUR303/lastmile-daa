import { describe, expect, it } from "vitest"
import { clampZoom, expandToAspect, fitViewBox, viewBoxString, zoomAt } from "./geometry"
import { minutes, percent, ratioPercent, signedPercent } from "./format"

describe("fitViewBox", () => {
  it("contains coordinates that fall outside the unit square", () => {
    // The regression: the radial generator emits coordinates well outside
    // [0,1] (seed 7 puts 31% of nodes there, seed 1 @ n=60 puts 58%). A
    // hard-coded 0..1 viewBox clipped every one of them off-screen.
    const pts = [
      { x: -0.121, y: -0.058 },
      { x: 1.112, y: 1.11 },
      { x: 0.5, y: 0.5 },
    ]
    const vb = fitViewBox(pts)
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(vb.x)
      expect(p.x).toBeLessThanOrEqual(vb.x + vb.w)
      expect(p.y).toBeGreaterThanOrEqual(vb.y)
      expect(p.y).toBeLessThanOrEqual(vb.y + vb.h)
    }
  })

  it("leaves a margin so glyphs and labels at the extremes are not cut", () => {
    const vb = fitViewBox([{ x: 0, y: 0 }, { x: 1, y: 1 }])
    expect(vb.x).toBeLessThan(0)
    expect(vb.y).toBeLessThan(0)
    expect(vb.x + vb.w).toBeGreaterThan(1)
    expect(vb.y + vb.h).toBeGreaterThan(1)
  })

  it("is square, so a non-square container cannot distort the network", () => {
    const vb = fitViewBox([{ x: 0, y: 0 }, { x: 4, y: 0.2 }])
    expect(vb.w).toBeCloseTo(vb.h)
  })

  it("survives a degenerate single-point instance", () => {
    const vb = fitViewBox([{ x: 3, y: 3 }])
    expect(vb.w).toBeGreaterThan(0)
    expect(vb.h).toBeGreaterThan(0)
    expect(Number.isFinite(vb.x)).toBe(true)
  })

  it("returns a usable box for an empty instance", () => {
    expect(fitViewBox([]).w).toBeGreaterThan(0)
  })
})

describe("expandToAspect", () => {
  it("fills a wide container without clipping either axis", () => {
    const fitted = fitViewBox([{ x: 0, y: 0 }, { x: 1, y: 1 }])
    const wide = expandToAspect(fitted, 2)
    expect(wide.w / wide.h).toBeCloseTo(2)
    expect(wide.w).toBeGreaterThan(fitted.w) // grew
    expect(wide.h).toBeCloseTo(fitted.h)     // never shrank the other axis
    expect(wide.x).toBeLessThanOrEqual(fitted.x)
    expect(wide.x + wide.w).toBeGreaterThanOrEqual(fitted.x + fitted.w)
  })

  it("fills a tall container the same way", () => {
    const fitted = fitViewBox([{ x: 0, y: 0 }, { x: 1, y: 1 }])
    const tall = expandToAspect(fitted, 0.5)
    expect(tall.w / tall.h).toBeCloseTo(0.5)
    expect(tall.h).toBeGreaterThan(fitted.h)
    expect(tall.w).toBeCloseTo(fitted.w)
  })

  it("is idempotent, so re-expanding a stored box cannot drift", () => {
    const once = expandToAspect(fitViewBox([{ x: 0, y: 0 }, { x: 1, y: 1 }]), 1.7)
    const twice = expandToAspect(once, 1.7)
    expect(twice).toEqual(once)
  })

  it("ignores a degenerate container measurement", () => {
    const vb = { x: 0, y: 0, w: 2, h: 2 }
    expect(expandToAspect(vb, 0)).toEqual(vb)
    expect(expandToAspect(vb, Number.NaN)).toEqual(vb)
  })
})

describe("zoomAt", () => {
  it("keeps the anchor point stationary", () => {
    const vb = { x: 0, y: 0, w: 10, h: 10 }
    const anchor = { x: 3, y: 7 }
    const zoomed = zoomAt(vb, 0.5, anchor)
    // the anchor must sit at the same relative position before and after
    expect((anchor.x - zoomed.x) / zoomed.w).toBeCloseTo((anchor.x - vb.x) / vb.w)
    expect((anchor.y - zoomed.y) / zoomed.h).toBeCloseTo((anchor.y - vb.y) / vb.h)
  })
})

describe("clampZoom", () => {
  const base = { x: 0, y: 0, w: 10, h: 10 }
  it("passes through a zoom level inside the limits", () => {
    const vb = { x: 0, y: 0, w: 5, h: 5 }
    expect(clampZoom(vb, base)).toEqual(vb)
  })
  it("stops runaway zoom-in", () => {
    const vb = { x: 0, y: 0, w: 0.001, h: 0.001 }
    expect(clampZoom(vb, base).w).toBeCloseTo(base.w * 0.08)
  })
  it("stops runaway zoom-out", () => {
    const vb = { x: 0, y: 0, w: 900, h: 900 }
    expect(clampZoom(vb, base).w).toBeCloseTo(base.w * 4)
  })
})

describe("viewBoxString", () => {
  it("emits the four SVG numbers in order", () => {
    expect(viewBoxString({ x: 1, y: 2, w: 3, h: 4 })).toBe("1 2 3 4")
  })
})

describe("formatters", () => {
  it("keeps one decimal place on every percentage so columns align", () => {
    expect(percent(100)).toBe("100.0%")
    expect(percent(33.333)).toBe("33.3%")
    expect(ratioPercent(0.333)).toBe("33.3%")
  })
  it("labels durations with their unit", () => {
    expect(minutes(718.5)).toBe("719 min")
  })
  it("uses a real minus sign for negative deltas", () => {
    expect(signedPercent(-12.4)).toBe("−12%")
    expect(signedPercent(70)).toBe("+70%")
  })
})
