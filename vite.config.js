import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks: app-code deploys don't re-download React/Supabase,
        // and the browser caches them across versions.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
            if (id.includes('@supabase')) return 'vendor-supabase';
            if (id.includes('leaflet')) return 'vendor-leaflet';
          }
        },
      },
    },
  },
})
