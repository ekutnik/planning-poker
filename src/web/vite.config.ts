import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Run as `vite src/web`, so this directory is the root. In development the
// Fastify server runs separately (`npm run dev`) and Vite proxies to it;
// serving the built client from Fastify comes with Docker in Session 8.
const SERVER = "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": SERVER,
      "/ws": { target: SERVER, ws: true },
    },
  },
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
