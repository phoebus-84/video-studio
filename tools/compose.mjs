#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Composition at installation time.
//
// The studio is not one program. It is a set of pieces, some of which are
// useful on their own (packages/*) and some of which only make sense together
// (studio/*). This script resolves a profile from compose.config.json into a
// concrete, checked composition and writes composed.json.
//
// composed.json is the answer to "what is actually wired here?" — which
// capabilities exist, which packages provide them, what is missing and why.
// The agent and gateway read it instead of guessing.
//
//   node tools/compose.mjs --profile=full
//   node tools/compose.mjs --profile=voice
//   node tools/compose.mjs --list
//
// Composition never installs a provider silently and never substitutes one
// capability for another: a missing requirement is reported, not worked around.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { isCapability, CAPABILITIES } from "@studio/contracts/src/vocabulary.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const CONFIG = JSON.parse(readFileSync(join(ROOT, "compose.config.json"), "utf-8"));

// ── Arguments ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === `--${name}`);
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const quiet = flag("quiet");
const syncSkillsOnly = flag("sync-skills");
const log = (...m) => { if (!quiet) console.log(...m); };

if (flag("list")) {
  console.log("Profiles:\n");
  for (const [name, p] of Object.entries(CONFIG.profiles)) {
    console.log(`  ${name.padEnd(10)} ${p.summary}`);
    console.log(`  ${" ".repeat(10)} components: ${p.components.join(", ")}`);
    console.log(`  ${" ".repeat(10)} skills: ${p.skills.join(", ") || "(none)"}\n`);
  }
  process.exit(0);
}

// A previously composed profile wins over the default, so `bun install`'s
// postinstall does not silently reset a deliberate choice.
const previous = existsSync(join(ROOT, "composed.json"))
  ? JSON.parse(readFileSync(join(ROOT, "composed.json"), "utf-8"))
  : null;

const profileName = value("profile", previous?.profile ?? CONFIG.defaultProfile);
const profile = CONFIG.profiles[profileName];

if (!profile) {
  console.error(`Unknown profile "${profileName}". Known: ${Object.keys(CONFIG.profiles).join(", ")}`);
  process.exit(2);
}

// ── Requirement probes ──────────────────────────────────────────────────────

function hasBinary(bin) {
  try {
    execFileSync("/bin/sh", ["-c", `command -v -- "$1"`, "sh", bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function checkRequirements(component) {
  const missing = [];
  for (const bin of component.requires?.system ?? []) {
    if (!hasBinary(bin)) missing.push({ kind: "system", name: bin });
  }
  for (const env of component.requires?.env ?? []) {
    if (!process.env[env]) missing.push({ kind: "env", name: env });
  }
  return missing;
}

// ── Resolve the composition ─────────────────────────────────────────────────

const resolved = [];
const capabilities = {};
const problems = [];

for (const name of profile.components) {
  const component = CONFIG.components[name];
  if (!component) {
    problems.push(`profile "${profileName}" names unknown component "${name}"`);
    continue;
  }

  const present = existsSync(join(ROOT, component.path));
  if (!present) problems.push(`component "${name}" is missing from disk at ${component.path}`);

  const missing = checkRequirements(component);

  resolved.push({
    name,
    path: component.path,
    kind: component.kind,
    standalone: component.standalone,
    summary: component.summary,
    docs: component.docs,
    present,
    ready: present && missing.length === 0,
    missing,
  });

  for (const capability of component.capabilities) {
    // A capability is a contract with the runtime, which validates stage
    // requests against the canonical vocabulary. Composing a name that is not
    // in it produces a component that resolves and reports ready while no
    // stage can ever request it — which is exactly how graphics.animate sat
    // wired-but-unrequestable.
    if (!isCapability(capability)) {
      problems.push(
        `component "${name}" declares unknown capability "${capability}". ` +
          `Known: ${CAPABILITIES.join(", ")}`,
      );
      continue;
    }

    // Two components claiming one capability is an ambiguity the operator must
    // resolve; the composer refuses to pick a winner (ADR-0015).
    if (capabilities[capability]) {
      problems.push(
        `capability "${capability}" is claimed by both "${capabilities[capability].provider}" and "${name}"`,
      );
    }
    capabilities[capability] = { provider: name, ready: present && missing.length === 0 };
  }
}

// ── Skill composition ───────────────────────────────────────────────────────

const PI_SKILLS = join(ROOT, ".pi", "skills");

function syncSkills(sets) {
  rmSync(PI_SKILLS, { recursive: true, force: true });
  mkdirSync(PI_SKILLS, { recursive: true });

  const synced = [];
  for (const setName of sets) {
    const set = CONFIG.skillSets[setName];
    if (!set) {
      problems.push(`profile "${profileName}" names unknown skill set "${setName}"`);
      continue;
    }
    const from = join(ROOT, set.path);
    if (!existsSync(from)) {
      problems.push(`skill set "${setName}" is missing from disk at ${set.path}`);
      continue;
    }
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      cpSync(join(from, entry.name), join(PI_SKILLS, entry.name), { recursive: true });
      synced.push(`${setName}/${entry.name}`);
    }
  }
  return synced;
}

const syncedSkills = syncSkills(profile.skills);

// ── Write composed.json ─────────────────────────────────────────────────────

const composed = {
  $comment: "Generated by tools/compose.mjs. Do not edit by hand; run `npm run compose -- --profile=<name>`.",
  profile: profileName,
  summary: profile.summary,
  composedAt: new Date().toISOString(),
  components: resolved,
  capabilities,
  skills: syncedSkills,
  problems,
};

writeFileSync(join(ROOT, "composed.json"), JSON.stringify(composed, null, 2) + "\n");

// ── Report ──────────────────────────────────────────────────────────────────

if (syncSkillsOnly && quiet) {
  process.exit(0);
}

log(`\nProfile: ${profileName} — ${profile.summary}\n`);

for (const c of resolved) {
  const mark = c.ready ? "✓" : c.present ? "!" : "✗";
  const scope = c.standalone ? "reusable" : "studio";
  log(`  ${mark} ${c.name.padEnd(15)} ${scope.padEnd(9)} ${c.path}`);
  for (const m of c.missing) log(`      needs ${m.kind}: ${m.name}`);
}

log(`\nCapabilities:`);
for (const [cap, info] of Object.entries(capabilities)) {
  log(`  ${info.ready ? "✓" : "!"} ${cap.padEnd(20)} <- ${info.provider}`);
}
log(`\nSkills: ${syncedSkills.length} synced into .pi/skills/`);

if (problems.length) {
  console.error(`\n✗ ${problems.length} composition problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const notReady = resolved.filter((c) => !c.ready);
if (notReady.length) {
  log(
    `\n! ${notReady.length} component(s) present but not ready. They are wired but their` +
      `\n  capabilities will fail until the requirements above are met. Nothing was` +
      `\n  substituted; see docs/install.md.`,
  );
}

log(`\nWrote composed.json\n`);
