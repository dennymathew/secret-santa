import { defineConfig } from 'vite';

// During `npm run dev`, API calls go to `wrangler pages dev` on port 8788.
export default defineConfig({
  server: {
    proxy: { '/api': 'http://127.0.0.1:8788' },
  },
  build: { target: 'es2020' },
});
