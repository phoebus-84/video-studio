// ADR-0040. A channel's look as data — colour and font roles, characters,
// rooms, brand — released as library/<channel>/themes/<id>/<version>/ and
// pinned by series template releases. Pure helpers: no reads, no loading.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import identitySchema from "../schemas/v1alpha1/identity.schema.json" with { type: "json" };
import schema from "../schemas/v1alpha1/channel-theme.schema.json" with { type: "json" };

/** Where a theme release lives in its channel. */
export const themeReleasePath = (id, version) => `themes/${id}/${version}`;
export const THEME_FILE = "theme.json";

/**
 * The font families the composer bundles (@fontsource 5.3.0, OFL), with the
 * faces it has of each. A theme names families; kits use fixed weights per
 * role (display 400; serif 400 and 700 italic; sans 300, 400, 600).
 */
export const BUNDLED_FONTS = Object.freeze({
  Anton: Object.freeze(["400 normal"]),
  Fraunces: Object.freeze(["400 normal", "400 italic", "700 normal", "700 italic"]),
  Inter: Object.freeze(["200 normal", "300 normal", "400 normal", "600 normal"]),
});

/** The faces channel-neutral kits draw each font role with: a role's family must have them. */
export const ROLE_FACES = Object.freeze({
  display: Object.freeze(["400 normal"]),
  serif: Object.freeze(["400 italic"]),
  sans: Object.freeze(["400 normal", "600 normal"]),
});

/** Room geometry is drawn in 1920×1080 image coordinates. */
const FRAME = { w: 1920, h: 1080 };

const issue = (code, path, message) => ({ code, path, message });
const member = (base, key) => `${base}[${JSON.stringify(key)}]`;
const ajv = new Ajv2020({ allErrors: true, strict: true, ownProperties: true });
addFormats(ajv);
ajv.addSchema(identitySchema).addSchema(schema);

function jsonPath(pointer, base = "$") {
  return pointer.split("/").slice(1).reduce((p, key) => member(p, key.replace(/~1/g, "/").replace(/~0/g, "~")), base);
}

export function validateChannelTheme(doc) {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/ChannelTheme`);
  if (!validate(doc)) return validate.errors.map((e) => issue("schema", jsonPath(e.instancePath), e.message));
  const problems = [];
  for (const role of ["display", "serif", "sans"]) {
    const family = doc.look.fonts[role];
    if (!BUNDLED_FONTS[family]) {
      problems.push(issue("unknown-font", `$.look.fonts.${role}`, `${family} is not bundled (${Object.keys(BUNDLED_FONTS).join(", ")})`));
      continue;
    }
    const missing = ROLE_FACES[role].filter((face) => !BUNDLED_FONTS[family].includes(face));
    if (missing.length > 0) {
      problems.push(issue("missing-face", `$.look.fonts.${role}`, `${family} has no ${missing.join(", ")}, which the kits draw the ${role} role with`));
    }
  }
  const onFrame = ([x, y]) => x >= 0 && x <= FRAME.w && y >= 0 && y <= FRAME.h;
  const boxOnFrame = (b) => onFrame([b.x, b.y]) && onFrame([b.x + b.w, b.y + b.h]);
  const offFrame = (path) => problems.push(issue("off-frame", path, `outside the ${FRAME.w}×${FRAME.h} frame the room is drawn in`));
  for (const [name, room] of Object.entries(doc.rooms)) {
    const at = `$.rooms.${name}`;
    (room.sky ?? []).forEach((sky, i) => sky.poly.forEach((p, j) => { if (!onFrame(p)) offFrame(`${at}.sky[${i}].poly[${j}]`); }));
    (room.windows ?? []).forEach((poly, i) => poly.forEach((p, j) => { if (!onFrame(p)) offFrame(`${at}.windows[${i}][${j}]`); }));
    (room.doors ?? []).forEach((b, i) => { if (!boxOnFrame(b)) offFrame(`${at}.doors[${i}]`); });
    if (room.monitor && !boxOnFrame(room.monitor.box)) offFrame(`${at}.monitor.box`);
  }
  if (doc.layout?.panel && !boxOnFrame(doc.layout.panel)) offFrame("$.layout.panel");
  return problems;
}
