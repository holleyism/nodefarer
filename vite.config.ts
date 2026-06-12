import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Listen on all interfaces so the prototype is reachable from other
  // machines on the LAN.
  server: { host: true },
  preview: { host: true },
})
