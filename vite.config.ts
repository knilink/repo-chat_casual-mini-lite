import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vite.dev/config/
export default defineConfig({
  base: '/repo-chat_casual-mini-lite/',
  plugins: [
    react(),
    nodePolyfills({
      include: ['path', 'buffer'],
    }),
  ],
});
