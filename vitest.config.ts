import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so that tests do not load the React
// Router plugin, which expects to run the whole application.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["app/test-setup.ts"],
    include: ["app/**/*.test.{ts,tsx}"],
  },
});
