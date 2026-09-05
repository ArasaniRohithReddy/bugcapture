import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const playerDist = resolve(import.meta.dirname, 'node_modules/rrweb-player/dist');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // The rrweb-player package does not export these files, but the ZIP
      // bundle needs their source inlined so the exported viewer works offline.
      { find: /^virtual:rrweb-player-umd/, replacement: `${playerDist}/rrweb-player.umd.min.cjs` },
      { find: /^virtual:rrweb-player-css/, replacement: `${playerDist}/style.min.css` },
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    sourcemap: process.env.NODE_ENV !== 'production',
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'popup.html'),
        options: resolve(import.meta.dirname, 'options.html'),
        report: resolve(import.meta.dirname, 'report.html'),
        viewer: resolve(import.meta.dirname, 'viewer.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
