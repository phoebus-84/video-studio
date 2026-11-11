#!/usr/bin/env node
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A real, asset-free composer recipe. No provider, account, or library template. */
export function firstTimeline() {
  return {
    apiVersion: 'studio.video/v1alpha2', kind: 'EditTimeline',
    episodeRef: { channel: 'demo', series: 'first-render', episode: 'hello' }, revision: 1,
    fps: 24, durationInFrames: 144, resolution: { width: 1280, height: 720 },
    profile: { id: 'local-demo', width: 1280, height: 720,
      safeZone: { top: 48, right: 64, bottom: 48, left: 64 },
      loudness: { integrated: -15, truePeak: -1, range: 11 } },
    assets: {},
    tracks: [{ id: 'titles', type: 'visual', z: 0, items: [
      { id: 'hello', from: 0, duration: 48, kit: { name: 'captions', version: '1.0.0' },
        props: { text: 'An idea.', position: 'center', fontSize: 80, color: '#f7f5ef', backgroundColor: '#202e29' } },
      { id: 'direction', from: 48, duration: 48, kit: { name: 'captions', version: '1.0.0' },
        props: { text: 'A little direction.', position: 'center', fontSize: 80, color: '#e5eebe', backgroundColor: '#202e29' } },
      { id: 'film', from: 96, duration: 48, kit: { name: 'captions', version: '1.0.0' },
        props: { text: 'Your first render.', position: 'center', fontSize: 80, color: '#f7f5ef', backgroundColor: '#b63d28' } },
    ] }],
  };
}
async function main() {
  if (process.argv.includes('--help')) {
    console.log('npm run demo:render\nCreates a new first-render-* directory under library/_demos/.\nRenders a silent 6-second 720p title sequence and audits it. No paid services.\nRequires installed workspace, FFmpeg, and Remotion Chrome (downloaded on first render).');
    return;
  }
  const { renderTimeline, auditRender, auditExpectation } = await import('@av/remotion-composer');
  const parent = resolve(process.env.AVG_LIBRARY_ROOT || 'library', '_demos');
  await mkdir(parent, { recursive: true });
  const destination = await mkdtemp(join(parent, 'first-render-'));
  const timeline = firstTimeline();
  await writeFile(join(destination, 'timeline.json'), JSON.stringify(timeline, null, 2) + '\n');
  console.log('Rendering to ' + destination);
  const result = await renderTimeline({ timeline, assetRoot: destination,
    outputPath: join(destination, 'hello.mp4'), concurrency: 1 });
  const audit = await auditRender(result.path, auditExpectation(timeline));
  await writeFile(join(destination, 'audit.json'), JSON.stringify(audit, null, 2) + '\n');
  if (!audit.passed) throw new Error('Render audit failed; inspect audit.json in ' + destination);
  console.log('Passed: 6 seconds · 1280×720 · 24 fps · H.264 · silent\n' + result.path);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
