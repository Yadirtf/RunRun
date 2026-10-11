import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = process.env.RANRAN_SERVER ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': { target: SERVER, ws: true },
      '/healthz': SERVER,
    },
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('rapier3d')) return 'rapier';
          if (id.includes('node_modules/react') || id.includes('socket.io') || id.includes('engine.io')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
