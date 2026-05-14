import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// When built for GitHub Pages, assets are served from the repo name path
// (https://<user>.github.io/Counting-Admin/). In dev we serve from root
// so `npm run dev` stays at http://localhost:5173/.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/Counting-Admin/' : '/',
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  // counting-admin doesn't use PostCSS. Pin the config locally so Vite
  // doesn't walk up the monorepo and load the root postcss.config.mjs
  // (which is for member-app and pulls in tailwindcss).
  css: { postcss: { plugins: [] } },
  server: { port: 5173, strictPort: false },
}));
