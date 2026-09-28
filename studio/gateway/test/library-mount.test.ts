import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { resolveToken } from "../src/auth/index.js";
import { createGateway, type GatewayInstance } from "../src/server.js";

// ---------------------------------------------------------------------------
// The public /library/ mount (avg-qr4.3 final review, M6)
// ---------------------------------------------------------------------------
// /library/ is served without authentication, so the studio can put media in
// <img> and <video> tags. It served dotfiles too: a token or operator key
// file configured inside the library — which several of this package's own
// test setups did — was one unauthenticated GET away.
// ---------------------------------------------------------------------------

const TMP = resolve(".test-tmp/library-mount");
const LIBRARY = join(TMP, "library");
const KEYS = join(TMP, "keys");

function baseConfig() {
  const config = loadConfig();
  config.port = 0;
  config.host = "127.0.0.1";
  config.token.file = join(KEYS, "token");
  config.operatorKey.file = join(KEYS, "operator-key");
  config.libraryRoots = [LIBRARY];
  return config;
}

beforeEach(() => {
  // A stray AVG_LIBRARY_ROOT / AVG_OPERATOR_KEY_FILE in the developer's shell
  // would point the gateway somewhere else than these tests set up.
  vi.stubEnv("AVG_LIBRARY_ROOT", undefined);
  vi.stubEnv("AVG_OPERATOR_KEY_FILE", undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("the /library/ static mount", () => {
  let gateway: GatewayInstance;
  let baseUrl: string;

  beforeAll(async () => {
    vi.stubEnv("AVG_LIBRARY_ROOT", undefined);
    vi.stubEnv("AVG_OPERATOR_KEY_FILE", undefined);
    await fs.rm(TMP, { recursive: true, force: true });
    await fs.mkdir(join(LIBRARY, "acme"), { recursive: true });
    await fs.mkdir(KEYS, { recursive: true });
    await fs.writeFile(join(LIBRARY, ".secret"), "top-level dotfile");
    await fs.writeFile(join(LIBRARY, "acme", ".gateway-token"), "nested dotfile");
    await fs.mkdir(join(LIBRARY, "acme", ".hidden"), { recursive: true });
    await fs.writeFile(join(LIBRARY, "acme", ".hidden", "file.txt"), "inside a dot directory");
    await fs.writeFile(join(LIBRARY, "acme", "frame.txt"), "ordinary media");

    const config = baseConfig();
    gateway = await createGateway(config, resolveToken(config.token));
    baseUrl = await gateway.start();
  });

  afterAll(async () => {
    await gateway?.stop();
    await fs.rm(TMP, { recursive: true, force: true });
  });

  it("still serves ordinary files", async () => {
    const res = await fetch(`${baseUrl}/library/acme/frame.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ordinary media");
  });

  for (const path of [".secret", "acme/.gateway-token", "acme/.hidden/file.txt"]) {
    it(`does not serve ${path}`, async () => {
      const res = await fetch(`${baseUrl}/library/${path}`);
      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toMatch(/dotfile|dot directory/);
    });
  }
});

describe("startup refuses credentials inside the served library", () => {
  beforeEach(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
    await fs.mkdir(LIBRARY, { recursive: true });
    await fs.mkdir(KEYS, { recursive: true });
  });
  afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }); });

  it("refuses a token file inside the library root", async () => {
    const config = baseConfig();
    config.token.file = join(LIBRARY, ".gateway-token");
    const token = resolveToken(config.token);
    await expect(createGateway(config, token)).rejects.toThrow(/token file .* inside the library/i);
  });

  it("refuses an operator key file inside the library root, before creating it", async () => {
    const config = baseConfig();
    config.operatorKey.file = join(LIBRARY, "acme", ".operator-key");
    await fs.mkdir(join(LIBRARY, "acme"), { recursive: true });
    await expect(createGateway(config, resolveToken(config.token))).rejects.toThrow(/operator key file .* inside the library/i);
    expect(existsSync(config.operatorKey.file)).toBe(false);
  });

  it("refuses an operator key named by AVG_OPERATOR_KEY_FILE inside the library root", async () => {
    const config = baseConfig();
    vi.stubEnv("AVG_OPERATOR_KEY_FILE", join(LIBRARY, "k"));
    await expect(createGateway(config, resolveToken(config.token))).rejects.toThrow(/operator key file .* inside the library/i);
  });

  it("does not mistake a sibling directory sharing the library's name prefix for the library", async () => {
    const config = baseConfig();
    config.token.file = join(`${LIBRARY}-keys`, "token");
    await fs.mkdir(`${LIBRARY}-keys`, { recursive: true });
    const gateway = await createGateway(config, resolveToken(config.token));
    await gateway.stop();
  });
});
