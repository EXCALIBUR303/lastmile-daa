import type { GenerateRequest, SolveConfig, SolveResponse } from "./types"

// In dev, Vite's proxy (vite.config.ts) forwards relative /api/* to the local
// backend, so this stays empty. In prod there's no such proxy -- the built
// site is static files with no backend attached -- so VITE_API_BASE (set at
// build time, e.g. in Vercel's project settings) must point at the deployed
// FastAPI URL instead.
const API_BASE = import.meta.env.VITE_API_BASE ?? ""

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
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

export const solve = (generate: GenerateRequest, config: SolveConfig) =>
  post<SolveResponse>("/api/solve", { generate, config })
