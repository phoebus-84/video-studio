import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {parseInfographicSpec, type InfographicSpec} from './schema.js';

export interface RenderInfographicOptions {
  specPath: string;
  outputPath: string;
  concurrency?: number;
  onProgress?: (progress: number) => void;
}

export const readInfographicSpec = async (specPath: string): Promise<InfographicSpec> => {
  const source = await readFile(specPath, 'utf8');
  return parseInfographicSpec(JSON.parse(source) as unknown);
};

export const renderInfographic = async (options: RenderInfographicOptions): Promise<void> => {
  const spec = await readInfographicSpec(options.specPath);
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const entryPoint = path.join(moduleDirectory, 'remotion-entry.js');
  const serveUrl = await bundle({entryPoint});
  const inputProps = {spec};
  const composition = await selectComposition({
    serveUrl,
    id: 'Infographic',
    inputProps,
  });

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: path.resolve(options.outputPath),
    inputProps,
    concurrency: options.concurrency ?? 4,
    imageFormat: 'jpeg',
    jpegQuality: 92,
    pixelFormat: 'yuv420p',
    colorSpace: 'bt709',
    onProgress: ({progress}) => options.onProgress?.(progress),
  });
};
