import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHandler, optionsFromEnv } from "./api/dev-auth";

// Locally the dev/preview server plays Vercel's part (see vercel.json): it proxies /api/v1 to the
// backend — same-origin, since the backend's CORS only allows GET/POST from localhost — and serves
// the one-click sign-in endpoints from api/dev-auth.ts.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const auth = optionsFromEnv(env);
  const proxy = { "/api/v1": { target: auth.apiTarget, changeOrigin: true } };
  return {
    plugins: [react(), devAuth(createHandler(auth))],
    server: { port: 5173, strictPort: true, proxy },
    preview: { proxy },
  };
});

function devAuth(handler: ReturnType<typeof createHandler>): Plugin {
  return {
    name: "dev-auth",
    configureServer: (server) => void server.middlewares.use("/dev-auth", handler),
    configurePreviewServer: (server) => void server.middlewares.use("/dev-auth", handler),
  };
}
