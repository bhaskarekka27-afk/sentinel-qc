import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5188,
    strictPort: true,
    // Proxy API calls to the QC backend so the browser never hits CORS.
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
    watch: {
      ignored: ['**/dist.zip', '**/dist/**']
    }
  }
})
