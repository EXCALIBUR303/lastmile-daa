import { describe, expect, it } from "vitest"
import { PALETTES, type Palette } from "./tokens"

// WCAG relative luminance and contrast ratio.
const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const lum = (hex: string) => {
  const h = hex.replace("#", "")
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe.each(Object.entries(PALETTES) as [string, Palette][])("%s palette", (_name, p) => {
  it("keeps every text colour at AA (4.5:1) on both panel and canvas", () => {
    for (const c of Object.values(p.text)) {
      expect(contrast(c, p.surface.panel)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c, p.surface.canvas)).toBeGreaterThanOrEqual(4.5)
    }
    for (const c of Object.values(p.status)) expect(contrast(c, p.surface.panel)).toBeGreaterThanOrEqual(4.5)
  })

  it("keeps drawn graphics (routes, stops, chart series) at 3:1 against their surface", () => {
    for (const c of p.vehicles) expect(contrast(c, p.surface.canvas)).toBeGreaterThanOrEqual(3)
    for (const c of Object.values(p.nodeFill)) expect(contrast(c, p.surface.canvas)).toBeGreaterThanOrEqual(3)
    for (const c of p.series) expect(contrast(c, p.surface.panel)).toBeGreaterThanOrEqual(3)
  })

  it("offers four distinct chart series", () => {
    expect(new Set(p.series).size).toBe(4)
  })
})
