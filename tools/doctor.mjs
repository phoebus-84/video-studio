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

const ROOT = resolve(import.meta.dirname, "..");

if (!existsSync(join(ROOT, "composed.json"))) {
  console.error("No composed.json. Run `npm run compose -- --profile=<name>` first.");
  process.exit(2);
}

const composed = JSON.parse(readFileSync(join(ROOT, "composed.json"), "utf-8"));

function probe(bin, args = ["--version"]) {
  try {
    const out = execFileSync(bin, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\n")[0].trim();
  } catch {
    return null;
  }
}

const checks = [
  { name: "node", detail: probe("node"), required: true },
  { name: "bun", detail: probe("bun"), required: true },
  { name: "ffmpeg", detail: probe("ffmpeg", ["-version"]), required: false },
  { name: "ffprobe", detail: probe("ffprobe", ["-version"]), required: false },
  { name: "python3", detail: probe("python3"), required: false },
];

console.log(`\nProfile: ${composed.profile}\n`);
console.log("Toolchain:");
let fatal = 0;
for (const c of checks) {
  if (c.detail) console.log(`  ✓ ${c.name.padEnd(10)} ${c.detail}`);
  else {
    console.log(`  ${c.required ? "✗" : "!"} ${c.name.padEnd(10)} not found`);
    if (c.required) fatal++;
  }
}

console.log("\nCredentials:");
const envKeys = new Set();
for (const c of composed.components) for (const m of c.missing) if (m.kind === "env") envKeys.add(m.name);
for (const key of ["FAL_KEY"]) {
  console.log(`  ${process.env[key] ? "✓" : "!"} ${key.padEnd(10)} ${process.env[key] ? "set" : "not set"}`);
}

console.log("\nCapabilities:");
for (const [cap, info] of Object.entries(composed.capabilities)) {
  console.log(`  ${info.ready ? "✓" : "!"} ${cap.padEnd(20)} <- ${info.provider}`);
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
