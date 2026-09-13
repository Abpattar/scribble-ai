import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vercelDevApi from './server/vercelDevPlugin.js';

export default defineConfig({
  plugins: [react(), vercelDevApi()],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
  },
});
