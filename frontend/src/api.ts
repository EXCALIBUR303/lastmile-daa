import type { BenchExperiment, BenchResponse, GenerateRequest, SolveConfig, SolveResponse } from "./types"

// In dev, Vite's proxy (vite.config.ts) forwards relative /api/* to the local
// backend, so this stays empty. In prod there's no such proxy -- the built
// site is static files with no backend attached -- so VITE_API_BASE (set at
// build time, e.g. in Vercel's project settings) must point at the deployed
// FastAPI URL instead.
const API_BASE = import.meta.env.VITE_API_BASE ?? ""

/** A serverless backend can take a while to wake; past this the call is
 *  abandoned so the UI can offer a retry instead of spinning forever. */
const TIMEOUT_MS = 60_000

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS)
  // Either the caller cancelling or the timeout firing aborts the request.
  const merged = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: merged,
    })
  } catch (e) {
    if (signal?.aborted) throw e // caller cancelled on purpose: not an error to report
    if (timeout.signal.aborted) {
      throw new Error(
        `The server did not answer within ${TIMEOUT_MS / 1000} s. It may be starting up, so try again.`,
      )
    }
    throw new Error("Could not reach the server. Check the connection and try again.")
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    // `res.statusText` is "" over HTTP/2 (no reason phrase on the wire), and
    // a non-FastAPI error page (e.g. a host's own 404, which is plain text,
    // not JSON) won't have `.detail` either -- falling back to either alone
    // can produce an EMPTY error message, which App.tsx's `{error && ...}`
    // then treats as falsy and silently shows nothing. Always fall through
    // to a guaranteed-non-empty `HTTP <status>` as the last resort.
    const body = await res.json().catch(() => null)
    const message = (body && typeof body.detail === "string" && body.detail)
      || res.statusText
      || `HTTP ${res.status} calling ${path} -- is VITE_API_BASE set correctly?`
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export const solve = (generate: GenerateRequest, config: SolveConfig, signal?: AbortSignal) =>
  post<SolveResponse>("/api/solve", { generate, config }, signal)

export const runBench = (
  experiment: BenchExperiment, params: Record<string, unknown> = {}, signal?: AbortSignal,
) => post<BenchResponse>("/api/bench", { experiment, params }, signal)
