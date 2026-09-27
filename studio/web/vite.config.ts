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

/**
 * The operator key for local development (avg-qr4.3).
 *
 * Mirrors `devGatewayToken` above: reading the gateway's own operator-key
 * file here makes `npm run dev` connect as the operator with no setup, and it
 * honors `AVG_OPERATOR_KEY_FILE` so the dev server resolves to the same file
 * the gateway does when an operator has pointed it elsewhere — the gateway
 * reads that env var first (Task 5), and a dev server that ignored it would
 * read a stale or nonexistent default while the gateway checked the real one.
 * Dev-only, like the token: a production build must supply VITE_OPERATOR_KEY.
 */
function devOperatorKey(): string {
  if (process.env.VITE_OPERATOR_KEY) return process.env.VITE_OPERATOR_KEY;
  const file = process.env.AVG_OPERATOR_KEY_FILE || "../gateway/.operator-key";
  try {
    return readFileSync(path.resolve(file), "utf-8").trim();
  } catch {
    return "";
  }
}

export default defineConfig(({ command }) => ({
  define: {
    __GATEWAY_TOKEN__: JSON.stringify(
      command === "serve" ? devGatewayToken() : (process.env.VITE_GATEWAY_TOKEN ?? ""),
    ),
    __OPERATOR_KEY__: JSON.stringify(
      command === "serve" ? devOperatorKey() : (process.env.VITE_OPERATOR_KEY ?? ""),
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
