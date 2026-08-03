#!/usr/bin/env node
import path from 'node:path';
import {getDurationInFrames} from './schema.js';
import {readInfographicSpec, renderInfographic} from './render.js';

const usage = () => {
  console.error('Usage: render-infographic <validate|render> <spec.json> [output.mp4]');
};

const [command, specArgument, outputArgument] = process.argv.slice(2);
if (!command || !specArgument || !['validate', 'render'].includes(command)) {
  usage();
  process.exitCode = 2;
} else {
  const specPath = path.resolve(specArgument);
  try {
    const spec = await readInfographicSpec(specPath);
    if (command === 'validate') {
      console.log(JSON.stringify({
        valid: true,
        name: spec.name,
        scenes: spec.scenes.length,
        durationInFrames: getDurationInFrames(spec),
        durationSeconds: getDurationInFrames(spec) / spec.fps,
      }, null, 2));
    } else {
      if (!outputArgument) {
        usage();
        process.exitCode = 2;
      } else {
        const outputPath = path.resolve(outputArgument);
        let previousPercent = -1;
        await renderInfographic({
          specPath,
          outputPath,
          onProgress: (progress) => {
            const percent = Math.floor(progress * 100);
            if (percent !== previousPercent && percent % 5 === 0) {
              process.stderr.write(`render ${percent}%\n`);
              previousPercent = percent;
            }
          },
        });
        console.log(JSON.stringify({output: outputPath, scenes: spec.scenes.length}, null, 2));
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
