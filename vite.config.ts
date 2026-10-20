import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { devAuth } from "./dev-auth";

// The backend's CORS whitelist allows http://localhost:5173 but only GET/POST, so admin PATCH
// calls (close chat, chat settings) would be blocked cross-origin. Proxying /api through the
// dev server keeps every call same-origin.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const target = env.VITE_API_TARGET || "http://localhost:3000";
  return {
    plugins: [
      react(),
      // Signs sign-in tokens server-side; JWT_PRIVATE_KEY has no VITE_ prefix so it never reaches the bundle.
      devAuth({ privateKey: env.JWT_PRIVATE_KEY, apiTarget: target, tokenHours: Number(env.DEV_TOKEN_HOURS) || 8 }),
    ],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target, changeOrigin: true },
      },
    },
    preview: {
      proxy: {
        "/api": { target, changeOrigin: true },
      },
    },
  };
});
