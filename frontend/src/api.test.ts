import { afterEach, describe, expect, it, vi } from "vitest"
import { solve } from "./api"

const gen = {} as Parameters<typeof solve>[0]
const cfg = {} as Parameters<typeof solve>[1]

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe("api error messages", () => {
  it("explains an unreachable server in plain words", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    await expect(solve(gen, cfg)).rejects.toThrow(/could not reach the server/i)
  })

  it("gives up after the timeout and says the server may be starting", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))
      })))
    const pending = expect(solve(gen, cfg)).rejects.toThrow(/did not answer within 60 s/i)
    await vi.advanceTimersByTimeAsync(60_000)
    await pending
  })

  it("stays silent when the caller cancels on purpose", async () => {
    const ac = new AbortController()
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))
      })))
    const pending = solve(gen, cfg, ac.signal)
    ac.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  it("never produces an empty message for an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 502, statusText: "", json: () => Promise.reject(new Error("not json")),
    }))
    await expect(solve(gen, cfg)).rejects.toThrow(/HTTP 502/)
  })
})
