import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    // These start a real Fastify server and open real sockets. A cold CI
    // runner needs more than 10s for that; the first run on GitHub Actions
    // failed with "Hook timed out in 10000ms" while passing locally.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
