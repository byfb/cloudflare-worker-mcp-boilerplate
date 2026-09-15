import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { edgeNavigationDenylist, isEdgePath } from './src/edge-routing.ts'

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['icon.svg', 'apple-touch-icon.png'],
    manifest: {
      name: 'App Starter', short_name: 'Starter',
      description: 'A reusable application foundation.',
      theme_color: '#16332c', background_color: '#f5f7f5',
      display: 'standalone', start_url: '/', scope: '/',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      cleanupOutdatedCaches: true,
      navigateFallbackDenylist: edgeNavigationDenylist,
      runtimeCaching: [{
        // Workbox serializes this function; it must have no module closure.
        urlPattern: ({ url }) => /^(?:\/api(?:\/|$)|\/mcp|\/\.well-known(?:\/|$)|\/cdn-cgi(?:\/|$))/.test(url.pathname),
        handler: 'NetworkOnly',
      }],
    },
  })],
  server: {
    host: 'localhost', port: 5173, strictPort: true,
    proxy: Object.fromEntries(['/api', '/mcp', '/.well-known'].map((path) => [path, 'http://127.0.0.1:8787'])),
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
})

export { isEdgePath }
