// The engine's entry point, run by engine.sh from the clone's root:
//   engine.sh [--cache <dir>] <command> [args]
// stdout carries only the answer (protocol.ts); everything else the render
// prints goes to stderr.

import path from "node:path";
import { defaultCacheRoot, runEngine } from "./engine.js";

const repo = path.resolve(import.meta.dirname, "..", "..", "..");
const argv = process.argv.slice(2);
let cache = defaultCacheRoot();
if (argv[0] === "--cache") {
  const dir = argv[1];
  if (!dir) {
    process.stderr.write("--cache needs a directory\n");
    process.exit(2);
  }
  cache = path.resolve(dir.startsWith("~/") ? path.join(process.env.HOME ?? "", dir.slice(2)) : dir);
  argv.splice(0, 2);
}

const stdout = process.stdout;
const toStderr = (...args: unknown[]) => process.stderr.write(`${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;

const code = await runEngine(argv, {
  stdin: process.stdin,
  stdout,
  stderrLine: (line) => process.stderr.write(`${line}\n`),
}, { repo, cache });
process.exitCode = code;
