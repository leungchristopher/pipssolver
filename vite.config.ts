import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { puzzleApi } from './server.mjs';

export default defineConfig({
  plugins: [react(), { name: 'daily-pips', configureServer(server) { server.middlewares.use(puzzleApi); } }],
});
