import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";
import { readFileSync } from "node:fs";

/**
 * The gateway token for local development.
 *
 * The gateway generates `.gateway-token` on first start and, per ADR-0030,
 * only accepts the well-known "dev-token" when explicitly configured to. The
 * studio used to fall back to that literal string, which meant a developer got
 * "Invalid bearer token" while the header still claimed to be connected.
 *
 * Reading the gateway's own token here makes `npm run dev` work against a
 * local gateway with no setup. It is dev-only: production builds must supply
 * VITE_GATEWAY_TOKEN, and no token is ever baked into a build from disk.
 */
function devGatewayToken(): string {
  if (process.env.VITE_GATEWAY_TOKEN) return process.env.VITE_GATEWAY_TOKEN;
  try {
    return readFileSync(path.resolve("../gateway/.gateway-token"), "utf-8").trim();
  } catch {
    return "";
  }
}

// There is deliberately no operator-key counterpart to `devGatewayToken`
// (avg-qr4.3 final review, I1). A `define` inlines its value into every
// module the dev server serves, over unauthenticated HTTP, and into every
// production bundle: the signing key was one `curl` away. The person enters
// it once in the studio instead (Header → operator key).

export default defineConfig(({ command }) => ({
  define: {
    __GATEWAY_TOKEN__: JSON.stringify(
      command === "serve" ? devGatewayToken() : (process.env.VITE_GATEWAY_TOKEN ?? ""),
    ),
  },
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
    port: 5173,
    strictPort: true,
  },
}));
