// ---------------------------------------------------------------------------
// One studio tool from the shell
// ---------------------------------------------------------------------------
// Runs a single pva_* tool, the same registration the MCP server and Pi use,
// and exits:
//
//   npm run studio:tool -- pva_compose_video '{"channel":"…","series":"…","episode":"…"}'
//   npm run studio:tool -- pva_compose_video @params.json
//
// For jobs longer than an MCP call should wait (an hour's render, an extend):
// start it in the background with its output in a log, and follow the log.
// Progress updates (the render bar, one line every 2%) go to stderr; the
// tool's result goes to stdout. The exit code is 1 when the tool failed.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { runHostedTool, updateText } from "./host.js";
import { createPvaServer } from "./server.js";

const [name, json] = process.argv.slice(2);
if (!name || !name.startsWith("pva_")) {
  process.stderr.write("usage: npm run studio:tool -- <pva_tool> ['<json params>' | @params.json]\n");
  process.exit(2);
}
const params = JSON.parse(json?.startsWith("@") ? readFileSync(json.slice(1), "utf8") : (json ?? "{}"));

const pva = await createPvaServer({ log: () => {} });
let result;
try {
  result = await runHostedTool(pva.host, name, params, {
    onUpdate: (update) => {
      const text = updateText(update);
      if (text) process.stderr.write(text + "\n");
    },
  });
} finally {
  await pva.stop();
}
for (const c of result.content as { type: string; text?: string }[]) if (c.type === "text") console.log(c.text);
process.exit(result.isError ? 1 : 0);
