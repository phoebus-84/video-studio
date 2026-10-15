#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Tells you whether this machine can actually run what you composed.
//
// `compose` decides what is wired. `doctor` checks the world outside the repo:
// binaries, runtimes, credentials. It reports; it never installs anything or
// silently degrades a capability.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { checkRequirements, resolveBinary } from "./requirements.mjs";

const ROOT = resolve(import.meta.dirname, "..");

if (!existsSync(join(ROOT, "composed.json"))) {
  console.error("No composed.json. Run `npm run compose -- --profile=<name>` first.");
  process.exit(2);
}

const composed = JSON.parse(readFileSync(join(ROOT, "composed.json"), "utf-8"));
const config = JSON.parse(readFileSync(join(ROOT, "compose.config.json"), "utf-8"));
for (const component of composed.components) {
  const definition = config.components[component.name];
  component.present = !!definition && existsSync(join(ROOT, definition.path));
  component.missing = definition ? checkRequirements(definition) : [{ kind: "component", name: component.name }];
  component.ready = component.present && component.missing.length === 0;
}
for (const info of Object.values(composed.capabilities)) {
  for (const provider of info.providers ?? []) {
    provider.ready = composed.components.find(c => c.name === provider.name)?.ready ?? false;
  }
  info.ready = composed.components.find(c => c.name === info.provider)?.ready ?? false;
}

function probe(bin, args = ["--version"]) {
  try {
    const out = execFileSync(resolveBinary(bin), args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000, shell: process.platform === "win32" });
    return out.split("\n")[0].trim();
  } catch {
    return null;
  }
}

/**
 * Remotion's headless Chrome, which the Remotion composer renders with. It is
 * not a system binary: Remotion downloads it into node_modules/.remotion of
 * the package that first renders, so its absence only means no render ran yet.
 */
function headlessChrome() {
  for (const dir of ["node_modules", "packages/remotion-composer/node_modules", "studio/agent/node_modules"]) {
    const version = join(ROOT, dir, ".remotion", "chrome-headless-shell", "VERSION");
    if (existsSync(version)) return `chrome-headless-shell ${readFileSync(version, "utf-8").trim()}`;
  }
  return null;
}

const checks = [
  { name: "node", detail: probe("node"), required: true },
  { name: "bun", detail: probe("bun"), required: true },
  { name: "ffmpeg", detail: probe("ffmpeg", ["-version"]), required: false },
  { name: "ffprobe", detail: probe("ffprobe", ["-version"]), required: false },
  { name: "python3", detail: probe("python3"), required: false },
  { name: "blender", detail: probe("blender"), required: false },
  {
    name: "chrome",
    detail: headlessChrome(),
    required: false,
    missing: "not downloaded yet: Remotion fetches it on the first render (video.compose)",
  },
];

console.log(`\nProfile: ${composed.profile}\n`);
console.log("Toolchain:");
let fatal = 0;
for (const c of checks) {
  if (c.detail) console.log(`  ✓ ${c.name.padEnd(10)} ${c.detail}`);
  else {
    console.log(`  ${c.required ? "✗" : "!"} ${c.name.padEnd(10)} ${c.missing ?? "not found"}`);
    if (c.required) fatal++;
  }
}

console.log("\nCredentials:");
const envKeys = new Set();
for (const c of composed.components) for (const key of config.components[c.name]?.requires?.env ?? []) envKeys.add(key);
for (const key of envKeys) {
  console.log(`  ${process.env[key] ? "✓" : "!"} ${key.padEnd(10)} ${process.env[key] ? "set" : "not set"}`);
}

console.log("\nCapabilities:");
for (const [cap, info] of Object.entries(composed.capabilities)) {
  // Alternatives matter operationally: when the default is not ready, the
  // question is always "is there another provider I could switch to?"
  const alternates = (info.providers ?? [])
    .filter((p) => p.name !== info.provider)
    .map((p) => `${p.name}${p.ready ? "" : " (not ready)"}`);
  const suffix = alternates.length ? `  (or: ${alternates.join(", ")})` : "";
  console.log(`  ${info.ready ? "✓" : "!"} ${cap.padEnd(20)} <- ${info.provider}${suffix}`);
}

const notReady = composed.components.filter((c) => !c.ready);
if (notReady.length) {
  console.log(`\n${notReady.length} component(s) not ready:`);
  for (const c of notReady) {
    for (const m of c.missing) console.log(`  ${c.name}: needs ${m.kind} ${m.name}`);
    if (!c.present) console.log(`  ${c.name}: missing from disk at ${c.path}`);
  }
  console.log("\nSee docs/install.md. Nothing is substituted automatically.");
}

console.log();
process.exit(fatal > 0 ? 1 : 0);
