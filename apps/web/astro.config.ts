import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import { AstroPWAIntegration } from '@vite-pwa/astro'
import { edgeNavigationDenylist } from './src/app/config'

export default defineConfig({
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  server: { host: 'localhost', port: 5173 },
  vite: {
    plugins: [tailwindcss()],
    server: {
      strictPort: true,
      proxy: Object.fromEntries(['/api', '/mcp', '/.well-known', '/cdn-cgi'].map((path) => [path, 'http://127.0.0.1:8787'])),
    },
  },
  integrations: [AstroPWAIntegration({
    registerType: 'autoUpdate',
    // The glob below already includes the generated icons.
    includeManifestIcons: false,
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
    generateSW: {
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      cleanupOutdatedCaches: true,
      // Each precached page serves its own clean URL; only unknown routes fall back.
      navigateFallback: '/404',
      navigateFallbackDenylist: edgeNavigationDenylist,
      runtimeCaching: [{
        urlPattern: /^https?:\/\/[^/]+\/(?:api(?:[/?#]|$)|mcp|\.well-known(?:[/?#]|$)|cdn-cgi(?:[/?#]|$))/,
        handler: 'NetworkOnly',
      }],
    },
  })],
})
