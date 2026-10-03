import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
  // Vite only exposes VITE_-prefixed variables to client code and does not put anything into
  // process.env. The server functions read their settings (including the service role key,
  // which must never be VITE_-prefixed) from process.env, so load .env.local into it here.
  const env = loadEnv(mode, process.cwd(), "");
  for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }

  return {
    plugins: [
      tsconfigPaths(),
      tailwindcss(),
      tanstackStart({ server: { entry: "server" } }),
      react(),
    ],
    // The 3D and map chunks are lazy, so Vite would otherwise discover these mid-session,
    // re-bundle and force a full page reload. Pre-bundling them up front means one optimizer
    // pass at startup instead of several, which matters on a machine short on memory.
    optimizeDeps: {
      include: [
        "@tanstack/router-core",
        "@tanstack/router-core/isServer",
        "@tanstack/router-core/ssr/client",
        "seroval",
        "three",
        "@react-three/fiber",
        "@react-three/drei",
        "motion/react",
        "recharts",
        "leaflet",
        "react-leaflet",
      ],
    },
  };
});
