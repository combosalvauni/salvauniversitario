import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          const uiDeps = [
            'framer-motion',
            'motion-dom',
            'motion-utils',
            'popmotion',
            'style-value-types',
            'hey-listen',
            'framesync',
            'lucide-react',
          ]

          const supabaseDeps = [
            '@supabase',
            '@stablelib',
            '@sinclair',
            'ws',
            'websocket',
            'cross-fetch',
            'whatwg-url',
            'tr46',
            'webidl-conversions',
          ]

          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
            return 'vendor-react'
          }

          if (supabaseDeps.some((dep) => id.includes(dep))) {
            return 'vendor-supabase'
          }

          if (uiDeps.some((dep) => id.includes(dep))) {
            return 'vendor-ui'
          }

          if (id.includes('clsx') || id.includes('tailwind-merge')) {
            return 'vendor-utils'
          }

          return 'vendor-misc'
        },
      },
    },
  },
  server: {
    proxy: {
      '/api/babylon': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/admin': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/public': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
