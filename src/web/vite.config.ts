import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Run as `vite src/web`, so this directory is the root. In development the
// Fastify server runs separately (`npm run dev`) and Vite proxies to it. The
// build goes to dist/web, which the Fastify server serves when it is there.
const SERVER = "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    // Trailing slashes: proxy keys match by prefix, and "/api" would also
    // swallow a module such as /api.ts.
    proxy: {
      "/api/": SERVER,
      "/ws/": { target: SERVER, ws: true },
    },
  },
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
