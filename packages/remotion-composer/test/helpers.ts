import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The contracts' own v1alpha2 fixtures, read as files: this package may not import studio/. */
export const CONTRACT_FIXTURES = path.resolve(here, '../../../studio/contracts/fixtures/timeline/v1alpha2');

export const fixture = (name: string): Record<string, any> =>
  JSON.parse(readFileSync(path.join(CONTRACT_FIXTURES, 'valid', name), 'utf8')) as Record<string, any>;

export const clone = <T>(value: T): T => structuredClone(value);
