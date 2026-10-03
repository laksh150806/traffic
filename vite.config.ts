import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
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
  preview: {
    allowedHosts: true,
  },
});
