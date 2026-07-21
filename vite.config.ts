/**
 * Build for the Telegram Mini App front end.
 *
 * Output goes straight into `src/miniapp/public`, which the server serves and
 * `copy-miniapp-assets.mjs` copies into `dist/` — so the same directory works
 * under `npm run dev` (tsx, reading from src) and in a built install.
 */
import path from 'path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = import.meta.dirname;

export default defineConfig({
  root: path.join(here, 'miniapp-ui'),
  // Assets are served from the app's own origin at /assets/…
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.join(here, 'miniapp-ui/src') },
  },
  build: {
    outDir: path.join(here, 'src/miniapp/public'),
    emptyOutDir: true,
    // A Mini App is opened on a phone over mobile data; keep the payload honest.
    chunkSizeWarningLimit: 400,
  },
});
