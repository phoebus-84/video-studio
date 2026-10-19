// A Lottie animation's JSON, made inert before it is saved. A player evaluates
// expressions (JavaScript in a property's "x") and loads what the file points
// at: images by path or URL, fonts by fPath. The animation kept here has no
// expression, and only images embedded as data: pictures; anything else that
// reaches outside the file refuses it, because the animation would not render
// as it was seen.

import { ArchiveError } from "./errors.js";

export interface LottieFacts {
  width: number;
  height: number;
  frameRate: number;
  durationSeconds: number;
  /** How many expressions were taken out. */
  expressionsRemoved: number;
}

const EMBEDDED_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/;
const MAX_DEPTH = 200;

/** The animation, inert, and its facts; refuses JSON that is not a Lottie animation or reaches outside itself. */
export function sanitizeLottie(text: string): { json: string; facts: LottieFacts } {
  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new ArchiveError("wrong-type", "not JSON");
  }
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || typeof doc.v !== "string" || !num(doc.fr) || doc.fr <= 0 ||
    !num(doc.ip) || !num(doc.op) || doc.op <= doc.ip || !num(doc.w) || !num(doc.h) || doc.w < 1 || doc.h < 1 || !Array.isArray(doc.layers)) {
    throw new ArchiveError("wrong-type", "not a Lottie animation (v, fr, ip, op, w, h and layers)");
  }
  let expressionsRemoved = 0;
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) throw new ArchiveError("wrong-type", "the animation nests too deeply");
    if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return; }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    // An expression is a string "x"; numeric and object "x" (easing, split position) are data.
    if (typeof o.x === "string") { delete o.x; expressionsRemoved++; }
    for (const value of Object.values(o)) walk(value, depth + 1);
  };
  walk(doc, 0);
  for (const asset of Array.isArray(doc.assets) ? doc.assets : []) {
    if (!asset || typeof asset !== "object") throw new ArchiveError("wrong-type", "an asset is not an object");
    if (Array.isArray(asset.layers)) continue; // a precomposition: its layers were walked
    if (typeof asset.p !== "string" || !EMBEDDED_IMAGE.test(asset.p)) {
      throw new ArchiveError("wrong-type", `asset "${asset.id ?? "?"}" is not an embedded picture: the animation loads files from outside itself`);
    }
    asset.u = "";
    asset.e = 1;
  }
  for (const font of Array.isArray(doc.fonts?.list) ? doc.fonts.list : []) {
    // fPath makes a player fetch a stylesheet or a font; glyphs drawn from `chars` need neither.
    if (font && typeof font === "object") { delete font.fPath; delete font.fOrigin; }
  }
  return {
    json: JSON.stringify(doc),
    facts: { width: Math.round(doc.w), height: Math.round(doc.h), frameRate: doc.fr, durationSeconds: (doc.op - doc.ip) / doc.fr, expressionsRemoved },
  };
}
