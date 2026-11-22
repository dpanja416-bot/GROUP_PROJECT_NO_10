import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The backend runs on the same computer as this dev server.
const BACKEND = 'http://127.0.0.1:8000'

const proxy = {
  '/api': {
    target: BACKEND,
    changeOrigin: true,
    timeout: 300000,
    proxyTimeout: 300000,
  },
  '/health': { target: BACKEND, changeOrigin: true },
  '/ready': { target: BACKEND, changeOrigin: true },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,          // also reachable from other devices / tunnels
    allowedHosts: true,  // accept any host name (VS Code tunnels, LAN IP, ngrok...)
    proxy,
  },
  preview: {
    host: true,
    allowedHosts: true,
    proxy,
  },
})