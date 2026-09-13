import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const apiProxy = { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: apiProxy },
  // The same proxy for `vite preview`, so the real production bundle can be
  // exercised against the local backend before it is deployed. In production
  // there is no proxy: VITE_API_BASE points the built site at the deployed API.
  preview: { port: 4173, proxy: apiProxy },
})
