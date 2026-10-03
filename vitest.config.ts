import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests do not boot the TanStack Start plugin.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
