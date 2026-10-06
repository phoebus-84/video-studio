// A proposed golden reference on disk, as @studio/episode's proposeReference
// leaves it (avg-jao.6): the release in the series, the frozen spec and
// timeline, the render and its report, proposal.json. For the runtime's tests,
// which cannot depend on @studio/episode.

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { seriesPath } from "@studio/contracts/src/layout.mjs";

export const KEY = "references-test-key-not-a-real-operator-key";
export const REF = { channel: "sample", series: "poetry", episode: "morning" };
const require = createRequire(import.meta.url);
const EXAMPLE = dirname(require.resolve("@studio/contracts/fixtures/series-template/example/episode-spec.json"));
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

export const episodeDirOf = (root: string) => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

/** A proposal of `id` in the library at `root`; returns it. */
export function propose(root: string, id = "morning-v1"): Record<string, any> {
  const put = (relative: string, content: string | Buffer): string => {
    const file = join(episodeDirOf(root), relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    return `sha256:${sha(content)}`;
  };
  cpSync(join(EXAMPLE, "templates/poetry-short/1.0.0"), join(seriesPath(root, REF.channel, REF.series), "templates/poetry-short/1.0.0"), { recursive: true });
  const specText = readFileSync(join(EXAMPLE, "episode-spec.json"));
  const dir = `reviews/references/${id}`;
  const specHash = put(`${dir}/episode-spec.json`, specText);
  const timelineHash = put(`${dir}/edit-timeline.json`, JSON.stringify({ derivedFrom: { spec: { path: "episode-spec.json", hash: specHash } } }));
  const renderHash = put("output/render-1-abcd1234.mp4", "fake mp4");
  const reportHash = put("output/render-1-abcd1234.report.json", JSON.stringify({ timeline: { path: "artifacts/edit-timeline.json", hash: timelineHash } }));
  const proposal = {
    apiVersion: "studio.video/v1alpha1",
    kind: "SeriesReference",
    id,
    episodeRef: REF,
    template: JSON.parse(specText.toString("utf-8")).template,
    spec: { path: `${dir}/episode-spec.json`, hash: specHash },
    timeline: { path: `${dir}/edit-timeline.json`, hash: timelineHash },
    render: { path: "output/render-1-abcd1234.mp4", hash: renderHash },
    report: { path: "output/render-1-abcd1234.report.json", hash: reportHash },
    metadata: { proposedAt: "2026-10-06T00:00:00.000Z" },
  };
  put(`${dir}/proposal.json`, `${JSON.stringify(proposal, null, 2)}\n`);
  return proposal;
}
