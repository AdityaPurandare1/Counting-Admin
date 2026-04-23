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
  server: { port: 5173, strictPort: false },
}));
