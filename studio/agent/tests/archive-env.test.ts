import { afterEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { readEnv, ARCHIVE_ENV_KEYS } from "../src/config.js";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn(async () => "") }));
afterEach(() => { vi.unstubAllEnvs(); vi.mocked(readFile).mockReset(); });
it("resolves stock keys without dropping the legacy Freesound alias", async () => {
  for (const key of ARCHIVE_ENV_KEYS) vi.stubEnv(key, `test-${key}`);
  const got = await readEnv();
  for (const key of ARCHIVE_ENV_KEYS) expect(got[key]).toBe(`test-${key}`);
  vi.stubEnv("FREESOUND_API_KEY", undefined);
  expect((await readEnv()).FREESOUND_API_KEY).toBe("test-FREESOUND_API_TOKEN");
});
it("loads allowlisted stock keys from .env with environment precedence", async () => {
  for (const key of ARCHIVE_ENV_KEYS) vi.stubEnv(key, undefined);
  vi.mocked(readFile).mockResolvedValue("PEXELS_API_KEY='from-file'\nPIXABAY_API_KEY=from-file\nNOT_ALLOWED=secret\n");
  vi.stubEnv("PIXABAY_API_KEY", "from-env");
  const got = await readEnv();
  expect(got.PEXELS_API_KEY).toBe("from-file");
  expect(got.PIXABAY_API_KEY).toBe("from-env");
  expect(got).not.toHaveProperty("NOT_ALLOWED");
});
