import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.ARENA_API_URL || 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  // NEAR Auth's SDK (near-api-js v5) imports Node's `buffer`; resolve it to the browser polyfill.
  resolve: { alias: { buffer: 'buffer/' } },
  define: { global: 'globalThis' },
  server: {
    // Dev proxy to the arena API; override with ARENA_API_URL when 8787 is taken.
    proxy: {
      '/api': api,
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
});
