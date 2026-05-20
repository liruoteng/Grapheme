import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["tests/stress/**/*.test.{ts,tsx}"],
    css: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
