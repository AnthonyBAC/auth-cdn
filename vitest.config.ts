import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "workers/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url))
    }
  }
});
