import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // NEAR Auth's SDK (near-api-js v5) imports Node's `buffer`; resolve it to the browser polyfill.
  resolve: { alias: { buffer: 'buffer/' } },
  define: { global: 'globalThis' },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
});
