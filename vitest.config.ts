import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
      $components: path.resolve("./src/components"),
      $contracts: path.resolve("./src/contracts"),
      $tokens: path.resolve("./src/tokens"),
    },
  },
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
  },
});
