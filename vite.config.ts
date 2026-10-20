import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { devAuth } from "./dev-auth";

// The backend's CORS whitelist allows http://localhost:5173 but only GET/POST, so admin PATCH
// calls (close chat, chat settings) would be blocked cross-origin. Proxying /api through the
// dev/preview server keeps every call same-origin.
//
// Production (`npm start` = `vite preview` over the built dist/) serves the same proxy and, only
// when QUICK_LOGIN=true, the /dev-auth sign-in endpoints.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const target = env.VITE_API_TARGET || "http://localhost:3000";
  const proxy = { "/api": { target, changeOrigin: true } };
  const allowedHosts = (env.ALLOWED_HOSTS || ".onrender.com").split(",").map((h) => h.trim()).filter(Boolean);
  return {
    plugins: [
      react(),
      // Signs sign-in tokens server-side; JWT_PRIVATE_KEY has no VITE_ prefix so it never reaches the bundle.
      devAuth({
        privateKey: env.JWT_PRIVATE_KEY,
        apiTarget: target,
        tokenHours: Number(env.DEV_TOKEN_HOURS) || 8,
        inPreview: env.QUICK_LOGIN === "true",
      }),
    ],
    server: {
      port: 5173,
      strictPort: true,
      proxy,
    },
    preview: {
      host: true,
      port: Number(env.PORT) || 4173,
      strictPort: true,
      allowedHosts,
      proxy,
    },
  };
});
