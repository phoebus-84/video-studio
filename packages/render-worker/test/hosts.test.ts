import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { engineTarget, findEngine, findPeer, mayBeEngine, parseTailscaleStatus, readHostsConfig, tailscalePeers, tailscalePrograms, type TailscalePeer } from "../src/hosts.js";
import { fakeEngine, tempDir } from "./helpers.js";

const STATUS = JSON.stringify({
  Self: { HostName: "this-laptop", TailscaleIPs: ["100.64.0.1"] },
  Peer: {
    "nodekey:1": { HostName: "render-box", DNSName: "render-box.tail-example.ts.net.", TailscaleIPs: ["fd7a:115c::9", "100.64.0.9"], Online: true, OS: "linux" },
    "nodekey:2": { HostName: "old-tower", DNSName: "old-tower.tail-example.ts.net.", TailscaleIPs: ["100.64.0.20"], Online: false, OS: "linux" },
    "nodekey:3": { HostName: "", DNSName: "phone-x.tail-example.ts.net.", TailscaleIPs: ["100.64.0.30"], Online: true, OS: "android" },
  },
});

const peers = parseTailscaleStatus(STATUS);

test("tailscale status gives the peers, IPv4 first, self left out", () => {
  assert.deepEqual(peers.map((p) => [p.name, p.addresses[0], p.online]), [
    ["render-box", "100.64.0.9", true],
    ["old-tower", "100.64.0.20", false],
    ["phone-x", "100.64.0.30", true],
  ]);
  assert.equal(findPeer(peers, "RENDER-BOX")?.name, "render-box");
  assert.equal(findPeer(peers, "render-box.tail-example.ts.net")?.name, "render-box");
  assert.equal(findPeer(peers, "nobody"), undefined);
});

test("a target takes its own settings, then the environment, then the config defaults", () => {
  const config = { user: "cfg-user", repo: "~/cfg-repo", hosts: { "render-box": { user: "own-user" } } };
  assert.deepEqual(engineTarget("render-box", { config, peers, env: { AVG_RENDER_SSH_USER: "env-user", AVG_RENDER_ENGINE_REPO: "/env/repo" } }),
    { name: "render-box", destination: "own-user@100.64.0.9", repo: "/env/repo" });
  assert.deepEqual(engineTarget("old-tower", { config, peers, env: { AVG_RENDER_SSH_USER: "env-user", AVG_RENDER_ENGINE_CACHE: "/env/cache" } }),
    { name: "old-tower", destination: "env-user@100.64.0.20", repo: "~/cfg-repo", cache: "/env/cache" });
  assert.deepEqual(engineTarget("old-tower", { config, peers, env: {} }), { name: "old-tower", destination: "cfg-user@100.64.0.20", repo: "~/cfg-repo" });
});

test("with nothing configured, ssh gets the bare name and its own config decides", () => {
  assert.deepEqual(engineTarget("not-a-peer", { peers: [], env: {} }), { name: "not-a-peer", destination: "not-a-peer", repo: "~/video-studio" });
  assert.deepEqual(engineTarget("box", { config: { hosts: { box: { address: "box.lan" } } }, peers: [], env: {} }), { name: "box", destination: "box.lan", repo: "~/video-studio" });
});

test("readHostsConfig reads the file, and a missing file is no configuration", () => {
  const dir = tempDir();
  assert.deepEqual(readHostsConfig(path.join(dir, "absent.json")), {});
  writeFileSync(path.join(dir, "h.json"), JSON.stringify({ user: "u", hosts: { a: { repo: "/r" } } }));
  assert.deepEqual(readHostsConfig(path.join(dir, "h.json")), { user: "u", hosts: { a: { repo: "/r" } } });
  writeFileSync(path.join(dir, "bad.json"), "{");
  assert.throws(() => readHostsConfig(path.join(dir, "bad.json")), { code: "bad-request" });
});

test("auto takes the first engine that answers, configured hosts before tailnet peers, only online Linux peers", async () => {
  const engine = fakeEngine();
  const env = { AVG_RENDER_SSH_USER: "someone" };
  const found = await findEngine("auto", { exec: engine.exec, peers, env });
  assert.equal(found.target.name, "render-box");
  assert.ok(found.version);
  assert.ok(!engine.calls.some((c) => c.destination.includes("100.64.0.20")), "offline peers are not tried");
  assert.ok(!engine.calls.some((c) => c.destination.includes("100.64.0.30")), "an android phone is not tried");
  assert.deepEqual(peers.map(mayBeEngine), [true, false, false]);
  assert.equal(mayBeEngine({ name: "x", dnsName: null, addresses: [], online: true, os: null }), true);

  const configured = await findEngine("auto", { exec: engine.exec, peers, env, config: { hosts: { "spare-box": { address: "10.9.9.9" } } } });
  assert.equal(configured.target.destination, "someone@10.9.9.9");
});

test("auto with no engine anywhere says what each machine answered", async () => {
  const engine = fakeEngine();
  const env = {};
  for (const p of peers) engine.unreachable.add(p.addresses[0]!);
  await assert.rejects(findEngine("auto", { exec: engine.exec, peers, env }), (e: Error & { code?: string }) => e.code === "no-engine" && /render-box/.test(e.message));
  await assert.rejects(findEngine("auto", { exec: engine.exec, peers: [] as TailscalePeer[], env }), { code: "no-engine" });
});

test("a named machine that SSH reaches but has no engine yet is returned for bootstrap", async () => {
  const engine = fakeEngine();
  engine.noEngine.add("100.64.0.9");
  const found = await findEngine("render-box", { exec: engine.exec, peers, env: {} });
  assert.equal(found.version, null);
  engine.unreachable.add("100.64.0.20");
  await assert.rejects(findEngine("old-tower", { exec: engine.exec, peers, env: {} }), { code: "no-engine" });
});

test("tailscale is found through AVG_TAILSCALE, then PATH, then where the Windows installer puts it", () => {
  assert.deepEqual(tailscalePrograms({ AVG_TAILSCALE: "/opt/ts/tailscale" }, "win32"), ["/opt/ts/tailscale"]);
  assert.deepEqual(tailscalePrograms({ ProgramFiles: "D:\\Apps\\" }, "win32"), ["tailscale", "D:\\Apps\\Tailscale\\tailscale.exe", "C:\\Program Files\\Tailscale\\tailscale.exe"]);
  assert.deepEqual(tailscalePrograms({}, "linux"), ["tailscale"]);

  const tried: string[] = [];
  const missing = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  const found = tailscalePeers({
    env: {},
    platform: "win32",
    run: (program) => {
      tried.push(program);
      return program.endsWith("tailscale.exe") ? { status: 0, stdout: STATUS } : { status: null, stdout: "", error: missing };
    },
  });
  assert.deepEqual(tried, ["tailscale", "C:\\Program Files\\Tailscale\\tailscale.exe"]);
  assert.equal(found[0]?.name, "render-box");

  assert.deepEqual(tailscalePeers({ env: {}, platform: "linux", run: () => ({ status: null, stdout: "", error: missing }) }), []);
  assert.deepEqual(tailscalePeers({ env: {}, platform: "win32", run: () => ({ status: 1, stdout: "" }) }), [], "installed but down: no peers, no further tries");
});
