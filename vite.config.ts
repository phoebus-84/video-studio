import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
      $components: path.resolve("./src/components"),
      $contracts: path.resolve("./src/contracts"),
      $tokens: path.resolve("./src/tokens"),
    },
  },
  build: {
    target: "es2022",
  },
  server: {
    port: 5199,
    strictPort: true,
  },
});
