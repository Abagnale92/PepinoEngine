import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@runtime": resolve("src/runtime") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
