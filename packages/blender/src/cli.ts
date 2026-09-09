import { readFile } from "node:fs/promises";
import { probe, runBlender, type BlenderRequest } from "./index.js";

const arg = process.argv[2];
if (!arg || arg === "--help") {
  console.log("npm run cli -- <request.json> | --probe\nSee README.md. Inputs execute locally; only use reviewed, trusted Python/.blend files.");
} else if (arg === "--probe") {
  const result = probe();
  console.log(JSON.stringify(result, null, 2));
  if (!result.available) process.exitCode = 1;
} else {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const request = JSON.parse(await readFile(arg, "utf8")) as BlenderRequest;
    console.log(JSON.stringify(await runBlender(request, { signal: controller.signal }), null, 2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
