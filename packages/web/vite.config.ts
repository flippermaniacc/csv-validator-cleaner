import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API checks Origin on writes against WEB_ORIGIN (default http://localhost:5173).
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
  build: { outDir: 'dist', sourcemap: true },
});
