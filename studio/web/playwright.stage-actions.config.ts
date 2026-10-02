import { defineConfig, devices } from "@playwright/test";

// Isolated regression suite: every gateway request is intercepted by the tests.
// Do not reuse 5199 (the local voice service) or the operator's live browser.
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "stage-actions.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5174",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: {
    command: "bun --bun vite --host 127.0.0.1 --port 5174",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
  },
});
