import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Relative base so the static build also works from file://-style hosts
// (GitHub Pages sub-paths, Electron/Tauri wrappers, etc.).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
});
