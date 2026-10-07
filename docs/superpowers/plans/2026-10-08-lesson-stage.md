# Channel Themes and the Lesson Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `avg-dcf.4.1`. A channel's look becomes data, and the long lesson's 16:9 stage is drawn by channel-neutral kits that receive it:
- the `ChannelTheme` contract, pinned by series template releases;
- the composer's `look` vocabulary and fonts by family;
- ten neutral stage kits;
- the loader reading the pinned theme;
- the Dentro i versi theme as the first release.

**Architecture:**
- A theme release (`library/<channel>/themes/<id>/<version>/theme.json` and its images) is held to a contract in `studio/contracts`.
- A series template release pins the theme by hash. `loadEpisode` reads it into `CompileInput.theme` and offers its rooms as `theme-<room>` assets.
- Kits take `look` (and the puppet a theme `character`) as props, validated by the composer's own zod schema. A test in `@studio/series` holds the two schemas together, since the composer may not import the contracts.
- Renders may take assets from the channel's `themes/` folder (`sharedRoots`).

**Tech Stack:**
- JSON Schema and ajv contracts (`node:test`).
- TypeScript, React 19, Remotion 4.0.505 and zod kits (`node:test` with real frames).
- `@studio/series` (`node:test`) and `@studio/episode` (vitest).

**Spec:** `docs/superpowers/specs/2026-10-08-lesson-stage-design.md`, on this branch, updated with what prototyping settled.

Every line of code below was run in a scratch worktree before this plan was written. That prototype is the local commit `57f8a68` on branch `scratch/lesson`; never push it, never merge it. What was run there:
- **Suites:** contracts 387 tests, composer 241 (with one real frame of every example and the safe-zone check), series 136, episode 197.
- **Checks:** typecheck, `check:boundaries`, `docs:check`.
- **The look:** the stage kits rendered with the Dentro i versi theme beside frames of CreativeStudio's delivered Il lampo long. The user approved it.

Generated files (previews, samples, the theme's placeholder images) are taken with `git -C "$(git rev-parse --show-toplevel)" checkout 57f8a68 -- <paths>`.

## Global Constraints

- Work on branch `feat/lesson-stage`, in the main checkout (not a worktree). It holds the spec commits.
- Never push or merge without the user's go.
- Leave the checkout's unrelated changes alone: `.beads/`, `studio/gateway/src/workspace/filesystem-service.ts`, `studio/gateway/test/workspace-filesystem.test.ts`. Never stage them; never run `bd`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use `git add` with explicit paths only.
- Code goes in exactly as shown. Where a step shows a diff, the file must end up exactly as the diff says.
- **Released kits and library modules never change.** Each new lock entry is written once, by `npm run kits:lock`, and must equal the value given in its task. If it doesn't, fix the file, never the lock. No existing entry may change.
- No dependency changes.
- Libraries read no environment variable.
- What other packages import is consumed through `dist/`, so rebuild it before testing the consumer:
  - `npm run build --workspace @av/remotion-composer`, before `@studio/series` and `@studio/episode` tests;
  - `npm run build --workspace @studio/series`, before `@studio/episode` tests.
- The composer may not import the contracts (`npm run check:boundaries`).
- VitePress fails on a double opening curly brace outside fenced code in any Markdown under `docs/`.
- The short's kits are not migrated here (`avg-d1x`); do not touch them.

## Review Focus

- **A theme whose look the kits would refuse.** Examples: a font family the composer doesn't bundle, or a colour written in a form zod rejects. The contract and the kits must agree. Task 6's alignment tests pin this, including the comparison of font families.
- **A lesson kit given a malformed look, or used in a 9:16 timeline.** It must be refused at the look's path (`bad-props`), or as `wrong-profile`. Task 3's tests pin this.
- **A theme changed after a release pinned it, or an image that leaves the theme.** The loader must refuse them (`theme-mismatch`, `path-escape`), and a release without a theme must load as before. Task 5's tests pin this.
- **A render taking an asset from beside the channel's themes.** Only the shared roots named may be staged, never a neighbouring folder. Task 2's staging test pins this.
- **Overlays at the edge of the 16:9 safe zone.** Every overlay example must keep every pixel inside, shadows included: the block title at x 128, the two-verse verse bar. Tasks 3 and 4's one-frame tests pin this.

---

### Task 1: The `ChannelTheme` contract, and the theme pin in `SeriesTemplate` (ADR-0040)

**Files:**
- Create:
  - `studio/contracts/schemas/v1alpha1/channel-theme.schema.json`;
  - `studio/contracts/src/channel-themes.mjs`, `studio/contracts/src/channel-themes.d.mts`;
  - `studio/contracts/fixtures/channel-theme/sample/themes/sample/1.0.0/theme.json`;
  - `studio/contracts/test/channel-themes.test.mjs`;
  - `studio/contracts/bindings/ts/channel-theme.ts` (generated);
  - `docs/adr/0040-channel-themes-carry-the-look-as-data.md`.
- Modify:
  - `studio/contracts/schemas/v1alpha1/series-template.schema.json`;
  - `studio/contracts/src/series-templates.mjs`, `studio/contracts/src/series-templates.d.mts`;
  - `studio/contracts/bindings/ts/series-template.ts` (generated);
  - `studio/contracts/README.md`, `studio/contracts/docs/contract-catalog.md`;
  - `docs/index.md`, `docs/workspace.md`.

**Interfaces:**
- Produces:
  - `validateChannelTheme(doc): {code, path, message}[]`;
  - `BUNDLED_FONTS` (`Anton`, `Fraunces`, `Inter`);
  - `themeReleasePath(id, version)` (→ `themes/<id>/<version>`);
  - `THEME_FILE` (`"theme.json"`);
  - the types `ChannelTheme`, `Look`, `ThemeCharacter`, `ThemeRoom`;
  - `SeriesTemplate.theme?: {id, version, hash}`.

- [ ] **Step 1: Write the failing test and its fixture**

Create `studio/contracts/fixtures/channel-theme/sample/themes/sample/1.0.0/theme.json`:

````json
{
  "apiVersion": "studio.video/v1alpha1",
  "kind": "ChannelTheme",
  "id": "sample",
  "version": "1.0.0",
  "look": {
    "colors": {
      "ink": "#1b1d24",
      "text": "#f4f5f7",
      "textDim": "rgba(244,245,247,.85)",
      "accent": "#4f9dff",
      "highlight": "#ffd166",
      "glow": "#cfe3ff",
      "lightning": "#c9c3ff",
      "plate": "rgba(20,22,30,.86)",
      "plateLine": "rgba(255,255,255,.4)",
      "shadow": "rgba(0,0,0,.4)",
      "backdrop": "#14161e",
      "signal": "#ff5d6c"
    },
    "fonts": { "display": "Anton", "serif": "Fraunces", "sans": "Inter" },
    "measures": { "plateRadius": 12, "textShadow": "0 2px 3px rgba(0,0,0,.8)", "minTextPx": 26 }
  },
  "layout": { "safe": { "top": 120, "bottom": 960 }, "floorY": 950, "panel": { "x": 440, "y": 150, "w": 1060, "h": 596 } },
  "characters": {
    "guide": {
      "variant": "attrice",
      "outfit": "gilet",
      "palette": {
        "ink": "#2e2620", "shirt": "#e9edf8", "shirtDark": "#c9d0e6", "vest": "#2a3266", "vestLight": "#4a56a0", "button": "#4f9dff",
        "inner": "#e9edf8", "innerDark": "#c9d0e6", "skin": "#f6b386", "skinDark": "#cf7c4e", "trousers": "#1a1f44", "shoe": "#fafaf5", "sole": "#dcd8cc"
      },
      "poses": { "indica": { "ru": 126, "rf": 140, "head": 4 } }
    }
  },
  "rooms": {
    "hall": { "image": "rooms/hall.png", "sky": [{ "poly": [[0, 0], [660, 262], [660, 540], [0, 492]], "period": 7.5, "seed": 3 }], "windows": [[[0, 0], [660, 170], [660, 600], [0, 760]]] }
  },
  "brand": { "text": "SAMPLE", "icon": "none" }
}
````

Create `studio/contracts/test/channel-themes.test.mjs`:

````js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BUNDLED_FONTS, validateChannelTheme } from "../src/channel-themes.mjs";
import { validateSeriesTemplate } from "../src/series-templates.mjs";

const release = fileURLToPath(new URL("../fixtures/channel-theme/sample/themes/sample/1.0.0/", import.meta.url));
const theme = () => JSON.parse(readFileSync(path.join(release, "theme.json"), "utf8"));
const codes = (doc) => validateChannelTheme(doc).map((p) => [p.code, p.path]);

describe("validateChannelTheme (ADR-0040)", () => {
  it("accepts a complete theme", () => {
    assert.deepEqual(validateChannelTheme(theme()), []);
  });

  it("names the bundled font families the composer draws with", () => {
    assert.deepEqual(Object.keys(BUNDLED_FONTS).sort(), ["Anton", "Fraunces", "Inter"]);
  });

  it("refuses a font the composer does not bundle", () => {
    const doc = theme();
    doc.look.fonts.serif = "Garamond";
    assert.deepEqual(codes(doc), [["unknown-font", "$.look.fonts.serif"]]);
  });

  it("refuses a colour role missing or malformed, at its path", () => {
    const doc = theme();
    delete doc.look.colors.highlight;
    doc.look.colors.accent = "cyan";
    assert.deepEqual(codes(doc).map(([c]) => c), ["schema", "schema"]);
    assert.ok(codes(doc).some(([, p]) => p === '$["look"]["colors"]["accent"]'));
  });

  it("refuses a palette colour the puppet does not have, and a pose angle it does not have", () => {
    const doc = theme();
    doc.characters.guide.palette.cape = "#ff0000";
    doc.characters.guide.poses.indica.wave = 3;
    assert.deepEqual(codes(doc).map(([c]) => c), ["schema", "schema"]);
  });

  it("refuses room geometry off the 1920×1080 frame", () => {
    const doc = theme();
    doc.rooms.hall.sky[0].poly[1] = [2200, 262];
    doc.rooms.hall.doors = [{ x: 1800, y: 300, w: 200, h: 400 }];
    assert.deepEqual(codes(doc), [
      ["off-frame", "$.rooms.hall.sky[0].poly[1]"],
      ["off-frame", "$.rooms.hall.doors[0]"],
    ]);
  });

  it("refuses an image path that climbs out of the release", () => {
    const doc = theme();
    doc.rooms.hall.image = "../other/hall.png";
    assert.deepEqual(codes(doc).map(([c]) => c), ["schema"]);
  });
});

describe("SeriesTemplate pins a theme", () => {
  const template = () => JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/series-template/example/templates/poetry-short/1.0.0/series-template.json", import.meta.url)), "utf8"));

  it("accepts a release with or without a theme pin", () => {
    assert.deepEqual(validateSeriesTemplate(template()), []);
    const pinned = template();
    pinned.theme = { id: "sample", version: "1.0.0", hash: `sha256:${"a".repeat(64)}` };
    assert.deepEqual(validateSeriesTemplate(pinned), []);
  });

  it("refuses a theme pin without its hash or with a range", () => {
    const doc = template();
    doc.theme = { id: "sample", version: "^1.0.0" };
    assert.ok(validateSeriesTemplate(doc).length > 0);
  });
});
````

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd studio/contracts && node --test test/channel-themes.test.mjs`
Expected: FAIL — `Cannot find module '…/src/channel-themes.mjs'`.

- [ ] **Step 3: The schema, the validator, the pin**

Create `studio/contracts/schemas/v1alpha1/channel-theme.schema.json`:

````json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.studio.video/v1alpha1/channel-theme.schema.json",
  "title": "A channel's look as data: colour and font roles, characters, rooms, brand (ADR-0040)",
  "$defs": {
    "Color": {
      "type": "string",
      "pattern": "^(#[0-9a-fA-F]{6}|rgba\\(\\s*\\d{1,3}\\s*,\\s*\\d{1,3}\\s*,\\s*\\d{1,3}\\s*,\\s*(0|1|0?\\.\\d+)\\s*\\))$",
      "description": "#rrggbb or rgba(r, g, b, a)."
    },
    "Box": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "x",
        "y",
        "w",
        "h"
      ],
      "properties": {
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        },
        "w": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "h": {
          "type": "number",
          "exclusiveMinimum": 0
        }
      }
    },
    "Point": {
      "type": "array",
      "prefixItems": [
        {
          "type": "number"
        },
        {
          "type": "number"
        }
      ],
      "minItems": 2,
      "maxItems": 2
    },
    "Polygon": {
      "type": "array",
      "minItems": 3,
      "items": {
        "$ref": "#/$defs/Point"
      }
    },
    "ThemeVersion": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$"
    },
    "ThemePin": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "version",
        "hash"
      ],
      "properties": {
        "id": {
          "$ref": "identity.schema.json#/$defs/Slug"
        },
        "version": {
          "$ref": "#/$defs/ThemeVersion"
        },
        "hash": {
          "$ref": "identity.schema.json#/$defs/ContentHash"
        }
      },
      "description": "Hash of the exact theme.json bytes; the theme names its images, which the loader hashes."
    },
    "Look": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "colors",
        "fonts",
        "measures"
      ],
      "properties": {
        "colors": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "ink",
            "text",
            "textDim",
            "accent",
            "highlight",
            "glow",
            "lightning",
            "plate",
            "plateLine",
            "shadow",
            "backdrop",
            "signal"
          ],
          "properties": {
            "ink": {
              "$ref": "#/$defs/Color"
            },
            "text": {
              "$ref": "#/$defs/Color"
            },
            "textDim": {
              "$ref": "#/$defs/Color"
            },
            "accent": {
              "$ref": "#/$defs/Color"
            },
            "highlight": {
              "$ref": "#/$defs/Color"
            },
            "glow": {
              "$ref": "#/$defs/Color"
            },
            "lightning": {
              "$ref": "#/$defs/Color"
            },
            "plate": {
              "$ref": "#/$defs/Color"
            },
            "plateLine": {
              "$ref": "#/$defs/Color"
            },
            "shadow": {
              "$ref": "#/$defs/Color"
            },
            "backdrop": {
              "$ref": "#/$defs/Color"
            },
            "signal": {
              "$ref": "#/$defs/Color"
            }
          }
        },
        "fonts": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "display",
            "serif",
            "sans"
          ],
          "properties": {
            "display": {
              "type": "string",
              "minLength": 1
            },
            "serif": {
              "type": "string",
              "minLength": 1
            },
            "sans": {
              "type": "string",
              "minLength": 1
            }
          },
          "description": "Family names among the composer's bundled faces; kits use fixed weights per role."
        },
        "measures": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "plateRadius",
            "textShadow",
            "minTextPx"
          ],
          "properties": {
            "plateRadius": {
              "type": "number",
              "minimum": 0,
              "maximum": 64
            },
            "textShadow": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "minTextPx": {
              "type": "number",
              "minimum": 10,
              "maximum": 80
            }
          }
        }
      }
    },
    "Character": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "variant",
        "palette"
      ],
      "properties": {
        "variant": {
          "enum": [
            "attore",
            "attrice"
          ]
        },
        "outfit": {
          "enum": [
            "gilet",
            "giacca"
          ]
        },
        "hairstyle": {
          "enum": [
            "coda",
            "corto"
          ]
        },
        "accessories": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "earrings": {
              "type": "boolean"
            },
            "freckles": {
              "type": "boolean"
            }
          }
        },
        "palette": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "ink",
            "shirt",
            "shirtDark",
            "vest",
            "vestLight",
            "button",
            "inner",
            "innerDark",
            "skin",
            "skinDark",
            "trousers",
            "shoe",
            "sole"
          ],
          "properties": {
            "ink": {
              "$ref": "#/$defs/Color"
            },
            "shirt": {
              "$ref": "#/$defs/Color"
            },
            "shirtDark": {
              "$ref": "#/$defs/Color"
            },
            "vest": {
              "$ref": "#/$defs/Color"
            },
            "vestLight": {
              "$ref": "#/$defs/Color"
            },
            "button": {
              "$ref": "#/$defs/Color"
            },
            "inner": {
              "$ref": "#/$defs/Color"
            },
            "innerDark": {
              "$ref": "#/$defs/Color"
            },
            "skin": {
              "$ref": "#/$defs/Color"
            },
            "skinDark": {
              "$ref": "#/$defs/Color"
            },
            "trousers": {
              "$ref": "#/$defs/Color"
            },
            "shoe": {
              "$ref": "#/$defs/Color"
            },
            "sole": {
              "$ref": "#/$defs/Color"
            },
            "hair": {
              "$ref": "#/$defs/Color"
            },
            "hairHi": {
              "$ref": "#/$defs/Color"
            },
            "hairGloss": {
              "$ref": "#/$defs/Color"
            },
            "lip": {
              "$ref": "#/$defs/Color"
            },
            "freckles": {
              "$ref": "#/$defs/Color"
            }
          }
        },
        "poses": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "lu": {
                "type": "number"
              },
              "lf": {
                "type": "number"
              },
              "ru": {
                "type": "number"
              },
              "rf": {
                "type": "number"
              },
              "head": {
                "type": "number"
              },
              "lean": {
                "type": "number"
              },
              "grip": {
                "type": "number"
              },
              "step": {
                "type": "number"
              },
              "twist": {
                "type": "number"
              },
              "dip": {
                "type": "number"
              }
            }
          }
        }
      }
    },
    "Sky": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "poly"
      ],
      "properties": {
        "poly": {
          "$ref": "#/$defs/Polygon"
        },
        "period": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "seed": {
          "type": "integer",
          "minimum": 0
        },
        "scale": {
          "type": "number",
          "exclusiveMinimum": 0
        }
      },
      "description": "A region of sky where distant lightning strikes, from its top edge towards its bottom edge."
    },
    "Room": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "image"
      ],
      "properties": {
        "image": {
          "$ref": "identity.schema.json#/$defs/PortableRelativePath"
        },
        "sky": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Sky"
          }
        },
        "windows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Polygon"
          },
          "description": "Lit by a flash."
        },
        "doors": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Box"
          },
          "description": "Glow softly, more with a flash."
        },
        "monitor": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "box",
            "video"
          ],
          "properties": {
            "box": {
              "$ref": "#/$defs/Box"
            },
            "video": {
              "$ref": "identity.schema.json#/$defs/PortableRelativePath"
            }
          }
        }
      }
    },
    "ChannelTheme": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "apiVersion",
        "kind",
        "id",
        "version",
        "look",
        "characters",
        "rooms",
        "brand"
      ],
      "properties": {
        "apiVersion": {
          "const": "studio.video/v1alpha1"
        },
        "kind": {
          "const": "ChannelTheme"
        },
        "id": {
          "$ref": "identity.schema.json#/$defs/Slug"
        },
        "version": {
          "$ref": "#/$defs/ThemeVersion"
        },
        "look": {
          "$ref": "#/$defs/Look"
        },
        "layout": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "safe": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "top",
                "bottom"
              ],
              "properties": {
                "top": {
                  "type": "number"
                },
                "bottom": {
                  "type": "number"
                }
              }
            },
            "floorY": {
              "type": "number"
            },
            "panel": {
              "$ref": "#/$defs/Box"
            }
          },
          "description": "Where the format puts things, when stricter than the output profile."
        },
        "characters": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/Character"
          }
        },
        "rooms": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/Room"
          }
        },
        "brand": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "text",
            "icon"
          ],
          "properties": {
            "text": {
              "type": "string",
              "minLength": 1,
              "maxLength": 40
            },
            "icon": {
              "enum": [
                "bolt",
                "none"
              ]
            }
          }
        },
        "metadata": {
          "type": "object",
          "additionalProperties": true
        }
      }
    }
  }
}
````

Create `studio/contracts/src/channel-themes.mjs`:

````js
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
````

Create `studio/contracts/src/channel-themes.d.mts`:

````ts
export type Color = string;
export interface Box { x: number; y: number; w: number; h: number }
export type Point = [number, number];
export interface Look {
  colors: Record<"ink" | "text" | "textDim" | "accent" | "highlight" | "glow" | "lightning" | "plate" | "plateLine" | "shadow" | "backdrop" | "signal", Color>;
  fonts: { display: string; serif: string; sans: string };
  measures: { plateRadius: number; textShadow: string; minTextPx: number };
}
export interface ThemeCharacter {
  variant: "attore" | "attrice";
  outfit?: "gilet" | "giacca";
  hairstyle?: "coda" | "corto";
  accessories?: { earrings?: boolean; freckles?: boolean };
  palette: Record<string, Color>;
  poses?: Record<string, Partial<Record<"lu" | "lf" | "ru" | "rf" | "head" | "lean" | "grip" | "step" | "twist" | "dip", number>>>;
}
export interface ThemeRoom {
  image: string;
  sky?: { poly: Point[]; period?: number; seed?: number; scale?: number }[];
  windows?: Point[][];
  doors?: Box[];
  monitor?: { box: Box; video: string };
}
export interface ChannelTheme {
  apiVersion: "studio.video/v1alpha1";
  kind: "ChannelTheme";
  id: string;
  version: string;
  look: Look;
  layout?: { safe?: { top: number; bottom: number }; floorY?: number; panel?: Box };
  characters: Record<string, ThemeCharacter>;
  rooms: Record<string, ThemeRoom>;
  brand: { text: string; icon: "bolt" | "none" };
  metadata?: Record<string, unknown>;
}
export declare const themeReleasePath: (id: string, version: string) => string;
export declare const THEME_FILE: "theme.json";
export declare const BUNDLED_FONTS: Readonly<Record<"Anton" | "Fraunces" | "Inter", readonly string[]>>;
export declare function validateChannelTheme(doc: unknown): { code: string; path: string; message: string }[];
````

````diff
diff --git a/studio/contracts/schemas/v1alpha1/series-template.schema.json b/studio/contracts/schemas/v1alpha1/series-template.schema.json
index 3ec77a4..4318d70 100644
--- a/studio/contracts/schemas/v1alpha1/series-template.schema.json
+++ b/studio/contracts/schemas/v1alpha1/series-template.schema.json
@@ -85,6 +85,7 @@
         "version": { "$ref": "#/$defs/TemplateVersion" },
         "compiler": { "$ref": "#/$defs/SeriesComponentRef" },
         "validator": { "$ref": "#/$defs/SeriesComponentRef" },
+        "theme": { "$ref": "channel-theme.schema.json#/$defs/ThemePin", "description": "The channel theme release this series draws with (ADR-0040); absent: the kits' own look." },
         "files": {
           "type": "object",
           "additionalProperties": false,
diff --git a/studio/contracts/src/series-templates.d.mts b/studio/contracts/src/series-templates.d.mts
index a48f30e..892c483 100644
--- a/studio/contracts/src/series-templates.d.mts
+++ b/studio/contracts/src/series-templates.d.mts
@@ -25,6 +25,8 @@ export interface SeriesTemplate {
   version: string;
   compiler: SeriesComponentRef;
   validator?: SeriesComponentRef;
+  /** The channel theme release this series draws with (ADR-0040). */
+  theme?: { id: string; version: string; hash: string };
   files: { schema: SeriesFileRef; template: SeriesFileRef; standard: SeriesFileRef };
   sheet?: SheetRules;
   metadata?: Record<string, unknown>;
diff --git a/studio/contracts/src/series-templates.mjs b/studio/contracts/src/series-templates.mjs
index f8b01ec..51ae7ea 100644
--- a/studio/contracts/src/series-templates.mjs
+++ b/studio/contracts/src/series-templates.mjs
@@ -6,6 +6,7 @@ import addFormats from "ajv-formats";
 import identitySchema from "../schemas/v1alpha1/identity.schema.json" with { type: "json" };
 import gateSchema from "../schemas/v1alpha1/gate-review.schema.json" with { type: "json" };
 import schema from "../schemas/v1alpha1/series-template.schema.json" with { type: "json" };
+import themeSchema from "../schemas/v1alpha1/channel-theme.schema.json" with { type: "json" };
 
 export const FILL = "__FILL__";
 export const SERIES_TEMPLATE_FILES = Object.freeze({
@@ -20,7 +21,7 @@ const hash = (text) => `sha256:${createHash("sha256").update(text, "utf8").diges
 const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
 const ajv = new Ajv2020({ allErrors: true, strict: true, ownProperties: true });
 addFormats(ajv);
-ajv.addSchema(identitySchema).addSchema(gateSchema).addSchema(schema);
+ajv.addSchema(identitySchema).addSchema(gateSchema).addSchema(themeSchema).addSchema(schema);
 
 function shape(kind, doc) {
   const validate = ajv.getSchema(`${schema.$id}#/$defs/${kind}`);
````

Then regenerate the bindings with `npm run bindings:generate`. It creates `bindings/ts/channel-theme.ts` and adds `theme` to `bindings/ts/series-template.ts`. Both must equal the prototype's: `git diff --exit-code 57f8a68 -- bindings/ts/channel-theme.ts bindings/ts/series-template.ts`.

- [ ] **Step 4: Run it to make sure it passes, then the contracts check**

Run: `node --test test/channel-themes.test.mjs`
Expected: PASS, 9 tests.

Run: `npm run check`
Expected: PASS, 387 tests (bindings, schemas and compatibility checks included).

- [ ] **Step 5: Docs**

Create `docs/adr/0040-channel-themes-carry-the-look-as-data.md`:

````markdown
# ADR-0040: Channel themes carry the look as data

## Status

Accepted (`avg-dcf.4.1`). Implemented:
- the `ChannelTheme` contract and the optional theme pin in `SeriesTemplate`;
- the composer's `look` vocabulary, fonts by family and ten neutral 16:9 lesson-stage kits;
- the loader reading a pinned theme;
- the Dentro i versi theme as the first release (a fixture until the channel exists, `avg-dcf.1`).

## Context

The studio is moving to a boundary (`avg-d1x`):
- **the library** holds assets and parametric files;
- **the application** executes;
- **composers and channel-neutral kits** are extensions.

The short's kits (`avg-dcf.3`) were built the other way round: the Dentro i versi palette, fonts, positions and costumes are composer code (ADR-0039 records it). The long lesson has about twice as many pieces. Building them the same way would double the channel code to move out later.

## Decision

**A channel's look is data in the library.** A theme release is a folder, `library/<channel>/themes/<id>/<version>/`. It holds `theme.json` (a `ChannelTheme`) and the images it names, and it is immutable like a series template release. It carries:
- **`look`**:
  - colour roles: `ink`, `text`, `textDim`, `accent`, `highlight`, `glow`, `lightning`, `plate`, `plateLine`, `shadow`, `backdrop`, `signal`;
  - font roles: `display`, `serif`, `sans`, by family among the composer's bundled faces;
  - shared measures: plate radius, text shadow, minimum text size.
- **`characters`**: the puppet's variant, outfit, palette and named poses.
- **`rooms`**: a picture, plus the geometry the kits draw on: sky polygons for the storm, windows, doors, a monitor clip.
- **`brand`**: the mark's text and icon.
- **`layout`**: optional, where the format is stricter than the output profile.

`validateChannelTheme` holds a theme to the contract:
- fonts the composer bundles;
- palette keys and pose angles the puppet has;
- geometry on the 1920×1080 frame;
- image paths that stay in the release.

**A series template release pins its theme** by id, version and the hash of `theme.json`. When the release names one, the loader (`loadEpisode`):
- reads it and checks it against the pin (`missing-theme`, `theme-mismatch`) and against the contract;
- puts it in `CompileInput.theme`;
- offers each room's picture as the asset `theme-<room>` (`theme-<room>-monitor` for its clip), with a path relative to the episode;
- hashes all of it into the episode's inputs.

A published episode therefore re-renders with the look it had, until a new release pins a new theme.

**Kits receive the look as a prop.** The composer's `lib/look/1.0.0.ts` defines the same `look` vocabulary as zod. Channel-neutral kits take `look` (and, for the puppet, a theme `character`) like any other prop, and compilers pass the theme's look through untouched. `lib/fonts/1.1.0.ts` loads only the families a look names, before the first frame.

The composer may not import the contracts (`check:boundaries`), so the two schemas are held together from the app side: a test in `@studio/series` passes every theme fixture's look and characters through the props schemas of every neutral kit, and compares the font families.

**Renders may take assets from the channel's themes.** `stageAssets`, `renderTimeline` and `renderLayoutSheet` accept `sharedRoots`: folders outside the asset root that assets may come from. `renderEpisode` and `makeLayoutSheet` pass the channel's `themes/` folder; nothing else outside the episode is ever staged.

## Consequences

- **Neutral 16:9 stage kits** draw any channel's lessons: `room`, `panel`, `interprete@1.1.0`, `verse-bar`, `block-title`, `figure-title`, `chapter-opener`, `cover`, `warp`, `brand-mark@2.0.0`. Their examples use a demo look with no channel in it.
- **Changing a channel's look** is a new theme release and a new series template release: data, reviewed like data, with no kit version.
- **The short's kits still carry the Dentro i versi look in code.** Moving them onto the theme is `avg-d1x`.
- **A release without a theme** loads and renders exactly as before.
````

````diff
diff --git a/docs/index.md b/docs/index.md
index 401a57e..b9eb9b9 100644
--- a/docs/index.md
+++ b/docs/index.md
@@ -56,7 +56,7 @@ synced into the site at build time from where they live next to the code.
 
 ## Decision records
 
-[`adr/`](./adr/0039-format-kits-share-frozen-libraries) holds 39 accepted
+[`adr/`](./adr/0040-channel-themes-carry-the-look-as-data) holds 40 accepted
 decisions. The ones that most shape the code:
 
 | ADR | Decision |
@@ -73,6 +73,7 @@ decisions. The ones that most shape the code:
 | [0037](./adr/0037-series-templates-pin-editorial-standards) | Series templates pin editorial standards |
 | [0038](./adr/0038-word-timing-comes-from-forced-alignment) | Word timing comes from forced alignment against the text |
 | [0039](./adr/0039-format-kits-share-frozen-libraries) | Format kits share frozen libraries, locked with them |
+| [0040](./adr/0040-channel-themes-carry-the-look-as-data) | Channel themes carry the look as data |
 
 ADR-0022 (independent repositories per module) is superseded by 0032.
 ADR-0009 (FFmpeg compiles a typed edit timeline) is superseded by 0034.
diff --git a/docs/workspace.md b/docs/workspace.md
index f0764c3..4da2667 100755
--- a/docs/workspace.md
+++ b/docs/workspace.md
@@ -89,6 +89,13 @@ Approved golden descriptors live separately at
 `templates/<id>/references/<reference-id>.json`, pinning frozen review
 snapshots and immutable output media, not today's episode or current pointer.
 
+A release may also pin the channel's look: `theme: {id, version, hash}`
+names `<channel>/themes/<id>/<version>/theme.json`
+([ADR-0040](adr/0040-channel-themes-carry-the-look-as-data.md)) — colour and
+font roles, characters, rooms and brand, with the images it names beside
+it. Theme releases are immutable too; a new look is a new theme release and
+a new series template release.
+
 This is the contract for forthcoming series compilers. Existing episode
 initialization and composition do not yet create or consume it. Path helpers
 are `seriesTemplatePath` and `seriesReferencePath` in `layout.mjs`;
diff --git a/studio/contracts/README.md b/studio/contracts/README.md
index 0d0e345..0a83ae2 100644
--- a/studio/contracts/README.md
+++ b/studio/contracts/README.md
@@ -28,7 +28,8 @@ Filesystem mutation, pipeline execution, creative skills, provider calls, render
 | `cue.schema.json` | When something happens in terms of the voice: a whole word (or `*` prefix), seconds, or a word / line / take / mark object with `at` and `offset`; resolved to an absolute frame, never by fallback, by `src/cues.mjs` |
 | `narration-takes.schema.json` | Every accepted voice take of an episode, from any tool (text as written, `spokenText` exactly as the tool received it, voice provenance, its word timing), and what each unit plays: takes in order with pauses and declared scene pauses; laid out and mapped from the Qwen narration manifest by `src/narration-takes.mjs` |
 | `source-pin.schema.json` | An episode's pin on shared material — a channel source (`<channel>/sources/<name>`) or another episode of the channel — with an inventory (hash, size, mtime per file); verified cheaply by `src/source-pins.mjs` (ADR-0035) |
-| `series-template.schema.json` | Immutable series-template releases, pinned editable episode specs, and hash-backed golden reference descriptors with human approval evidence (ADR-0037); pure helpers in `src/series-templates.mjs` |
+| `series-template.schema.json` | Immutable series-template releases (optionally pinning a channel theme), pinned editable episode specs, and hash-backed golden reference descriptors with human approval evidence (ADR-0037); pure helpers in `src/series-templates.mjs` |
+| `channel-theme.schema.json` | A channel's look as data — colour and font roles, characters, rooms, brand — released as `<channel>/themes/<id>/<version>/theme.json` and pinned by series template releases (ADR-0040); `validateChannelTheme`, `BUNDLED_FONTS` and `themeReleasePath` in `src/channel-themes.mjs` |
 | `review-thread.schema.json` | Anchored review conversations with comments |
 | `provider-job.schema.json` | Tracked provider invocations with cost and idempotency |
 | `error-envelope.schema.json` | Cross-process error envelope with typed codes |
diff --git a/studio/contracts/docs/contract-catalog.md b/studio/contracts/docs/contract-catalog.md
index ce4762b..f23cbac 100644
--- a/studio/contracts/docs/contract-catalog.md
+++ b/studio/contracts/docs/contract-catalog.md
@@ -20,7 +20,8 @@ This catalog assigns every durable wire or workspace concept to one contract fam
 | `cue` | Cue grammar for series specs (word, prefix, seconds, word/line/take/mark objects) and its resolution to frames against a take's Word Timing | series spec authors (Pi, editors) | series compilers | `avg-7zp.2` |
 | `narration-takes` | Narration Takes: provider-neutral take registry (text, spoken text as sent, voice provenance, word timing ref, narration-manifest source) and unit sequences with pauses and scene pauses; unit layout; Qwen manifest mapping | TTS provider adapters, Qwen worker via mapping | series compilers, cue resolver, composer | `avg-7zp.4` |
 | `source-pin` | Source Pin: shared material an episode reads without copying (channel source or episode), its file inventory and the stages that read it | `vpr pin add`, series compilers | runtime status, `vpr pin renew` | `avg-7zp.5` |
-| `series-template` | Immutable SeriesTemplate release manifest (with optional layout-sheet instants), hash-pinned editorial EpisodeSpec, SeriesReference golden snapshot/approval descriptor (ADR-0037) | series authors, the operator's `vpr reference` (approve, withdraw) | Pi/editors, series compiler and QA, the layout sheet, `verifySeriesReference` | `avg-jao.1`, `avg-jao.6`, `avg-3th.1` |
+| `series-template` | Immutable SeriesTemplate release manifest (with optional layout-sheet instants and theme pin), hash-pinned editorial EpisodeSpec, SeriesReference golden snapshot/approval descriptor (ADR-0037) | series authors, the operator's `vpr reference` (approve, withdraw) | Pi/editors, series compiler and QA, the layout sheet, `verifySeriesReference` | `avg-jao.1`, `avg-jao.6`, `avg-3th.1`, `avg-dcf.4.1` |
+| `channel-theme` | ChannelTheme release: look (colour, font roles, measures), characters, rooms, brand, optional layout (ADR-0040) | channel authors | the episode loader, series compilers (passed through to channel-neutral kits) | `avg-dcf.4.1` |
 | `event` | Journal Event envelope, correlation and causation, typed lifecycle payloads, cursor | runtime and services | gateway, projections, web, Pi | `vwc-5q0.7` |
 | `review` | Review Thread, anchor, reply, resolution, stale anchor, approval decision | users, Pi, gateway | runtime, gateway, web, Pi | `vwc-5q0.7` |
 | `policy` | Approval Policy, Budget Envelope, reservation/reconciliation, material downgrade, stale acceptance | channel/series owners and runtime | runtime, Pi, gateway, web, adapters | `vwc-5q0.3`, `vwc-5q0.7` |
````

- [ ] **Step 6: Commit**

```bash
git add studio/contracts/schemas/v1alpha1/channel-theme.schema.json studio/contracts/schemas/v1alpha1/series-template.schema.json \
  studio/contracts/src/channel-themes.mjs studio/contracts/src/channel-themes.d.mts \
  studio/contracts/src/series-templates.mjs studio/contracts/src/series-templates.d.mts \
  studio/contracts/bindings/ts/channel-theme.ts studio/contracts/bindings/ts/series-template.ts \
  studio/contracts/fixtures/channel-theme studio/contracts/test/channel-themes.test.mjs \
  studio/contracts/README.md studio/contracts/docs/contract-catalog.md \
  docs/adr/0040-channel-themes-carry-the-look-as-data.md docs/index.md docs/workspace.md
git commit -m "ChannelTheme: a channel's look as data, pinned by series template releases (ADR-0040, avg-dcf.4.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The composer's look, fonts by family, the lesson stage's drawing code, shared asset roots

**Files:**
- Create:
  - `packages/remotion-composer/src/kits/lib/look/1.0.0.ts`;
  - `packages/remotion-composer/src/kits/lib/fonts/1.1.0.ts`;
  - `packages/remotion-composer/src/kits/lib/lesson-stage/1.0.0.tsx`.
- Modify:
  - `packages/remotion-composer/src/assets.ts`, `src/render.ts`, `src/layout-sheet.ts`, `src/index.ts`;
  - `packages/remotion-composer/test/assets.test.ts`.

**Interfaces:**
- Produces:
  - `look@1.0.0`: `LookSchema`, `Look`, `COLOR_ROLES`, `plateStyle`, `alpha`, `textPx`, `DEMO_LOOK`;
  - `fonts@1.1.0`: `useLookFonts(fonts)` (→ CSS families by role), `cssFamily`, `BUNDLED_FAMILIES`, exported from the package;
  - `lesson-stage@1.0.0`: `Box`, `Point`, `boltPoints`, `ptsPath`, `strikeAt`, `LiveBolt`, `polygonSpan`, `Sky`, `DistantStorm`, `Cover`, `LoopClip`, `Glass`, `Teleport`, `WarpLayer`;
  - `stageAssets(timeline, assetRoot, sharedRoots?)`, with `sharedRoots?: string[]` on `RenderTimelineOptions` and `LayoutSheetOptions`.
- The modules are frozen once a kit that imports them is locked (Task 3). They must be complete here.

- [ ] **Step 1: Write the failing test**

````diff
diff --git a/packages/remotion-composer/test/assets.test.ts b/packages/remotion-composer/test/assets.test.ts
index 4b47fe8..66d4cd4 100644
--- a/packages/remotion-composer/test/assets.test.ts
+++ b/packages/remotion-composer/test/assets.test.ts
@@ -73,4 +73,28 @@ describe('stageAssets', () => {
     ]);
     await rm(root, {recursive: true, force: true});
   });
+
+  it('stages an asset from a shared root outside the episode, and nothing from elsewhere', async () => {
+    // library/<channel>/themes/… beside library/<channel>/series/<s>/episodes/<e>
+    const library = await episodeWith({'themes/t/1.0.0/rooms/hall.png': 'a hall', 'secrets/key.txt': 'no'});
+    const episode = path.join(library, 'series/s/episodes/e');
+    await mkdir(episode, {recursive: true});
+    const doc = clone(fixture('explainer.json')) as EditTimeline;
+    doc.assets = {
+      'theme-hall': {path: '../../../../themes/t/1.0.0/rooms/hall.png', hash: await sha256(path.join(library, 'themes/t/1.0.0/rooms/hall.png')), kind: 'image'},
+    };
+    const shared = path.join(library, 'themes');
+    const out = await stageAssets(doc, episode, [shared]);
+    assert.ok(out.ok);
+    if (!out.ok) return;
+    assert.equal(await readFile(path.join(out.staged.publicDir, out.staged.files['theme-hall']!), 'utf8'), 'a hall');
+    await out.staged.cleanup();
+    // Without the shared root it is outside the episode; with it, a path beside it is still refused.
+    const alone = await stageAssets(doc, episode);
+    assert.deepEqual(alone.ok ? [] : alone.problems.map((p) => p.code), ['missing-asset']);
+    doc.assets['theme-hall']!.path = '../../../../secrets/key.txt';
+    const beside = await stageAssets(doc, episode, [shared]);
+    assert.deepEqual(beside.ok ? [] : beside.problems.map((p) => p.code), ['missing-asset']);
+    await rm(library, {recursive: true, force: true});
+  });
 });
````

Run: `cd packages/remotion-composer && node --import tsx --test test/assets.test.ts`
Expected: FAIL. The asset outside the episode is refused, because `stageAssets` takes no shared roots yet.

- [ ] **Step 2: Shared roots**

````diff
diff --git a/packages/remotion-composer/src/assets.ts b/packages/remotion-composer/src/assets.ts
index a277f59..148698c 100644
--- a/packages/remotion-composer/src/assets.ts
+++ b/packages/remotion-composer/src/assets.ts
@@ -26,18 +26,27 @@ export interface StagedAssets {
   cleanup: () => Promise<void>;
 }
 
+/**
+ * `sharedRoots` are folders outside the asset root that assets may also come
+ * from — a channel's theme releases beside its episodes (ADR-0040); nothing
+ * else outside the root is ever staged.
+ */
 export async function stageAssets(
-  timeline: EditTimeline, assetRoot: string,
+  timeline: EditTimeline, assetRoot: string, sharedRoots: readonly string[] = [],
 ): Promise<{ok: true; staged: StagedAssets} | {ok: false; problems: ComposerProblem[]}> {
   const root = path.resolve(assetRoot);
+  const roots = [root, ...sharedRoots.map((r) => path.resolve(r))];
+  const inside = (abs: string) => roots.some((r) => {
+    const rel = path.relative(r, abs);
+    return !rel.startsWith('..') && !path.isAbsolute(rel);
+  });
   const problems: ComposerProblem[] = [];
   const sources: Record<string, string> = {};
   for (const [id, asset] of Object.entries(timeline.assets)) {
     const p = `$.assets[${JSON.stringify(id)}]`;
     const abs = path.resolve(root, asset.path);
-    const rel = path.relative(root, abs);
-    if (rel.startsWith('..') || path.isAbsolute(rel) || !existsSync(abs)) {
-      problems.push({code: 'missing-asset', message: `asset "${id}": ${asset.path} is not a file under ${root}`, path: `${p}.path`});
+    if (!inside(abs) || !existsSync(abs)) {
+      problems.push({code: 'missing-asset', message: `asset "${id}": ${asset.path} is not a file under ${roots.join(' or ')}`, path: `${p}.path`});
       continue;
     }
     const actual = await sha256(abs);
diff --git a/packages/remotion-composer/src/index.ts b/packages/remotion-composer/src/index.ts
index 6627781..dacbcb6 100644
--- a/packages/remotion-composer/src/index.ts
+++ b/packages/remotion-composer/src/index.ts
@@ -6,5 +6,6 @@ export {kitLockHash, timelineKits, type LockedKit} from './kit-lock.js';
 export {drawingCodeHash} from './identity.js';
 export {listKits, previewPath, resolveKit, kitVersions, KIT_VERSIONS, type KitListing, type KitVersion, type KitExample, type KitProfile} from './kits/index.js';
 export {ComposerError, type ComposerErrorCode, type ComposerProblem} from './errors.js';
+export {BUNDLED_FAMILIES} from './kits/lib/fonts/1.1.0.js';
 export {type LoudnessTarget, type LoudnessResult} from './loudness.js';
 export {EditTimelineSchema, OutputProfileSchema, type EditTimeline, type OutputProfile} from './schema.js';
diff --git a/packages/remotion-composer/src/layout-sheet.ts b/packages/remotion-composer/src/layout-sheet.ts
index 4b45dad..c79ef07 100644
--- a/packages/remotion-composer/src/layout-sheet.ts
+++ b/packages/remotion-composer/src/layout-sheet.ts
@@ -24,6 +24,8 @@ export interface LayoutSheetOptions {
   timeline: unknown;
   /** The directory asset paths are relative to (the episode). */
   assetRoot: string;
+  /** Folders outside assetRoot that assets may also come from (a channel's theme releases, ADR-0040). */
+  sharedRoots?: string[];
   /** Distinct whole frames inside the timeline, in the order the sheet shows them. */
   picks: {frame: number; label: string}[];
   /** Created if missing; frames/NNN.jpg and sheet.jpg are written inside. */
@@ -91,7 +93,7 @@ export async function renderLayoutSheet(options: LayoutSheetOptions): Promise<La
 
   const kits = timelineKits(timeline) ?? refuse('a kit of this timeline is not in kits.lock.json');
 
-  const staging = await stageAssets(timeline, options.assetRoot);
+  const staging = await stageAssets(timeline, options.assetRoot, options.sharedRoots);
   if (!staging.ok) {
     throw new ComposerError(staging.problems[0]!.code, `assets are not what the timeline says: ${staging.problems.map((p) => p.message).join('; ')}`, staging.problems);
   }
diff --git a/packages/remotion-composer/src/render.ts b/packages/remotion-composer/src/render.ts
index 468d86a..acf4bcc 100644
--- a/packages/remotion-composer/src/render.ts
+++ b/packages/remotion-composer/src/render.ts
@@ -22,6 +22,8 @@ export interface RenderTimelineOptions {
   timeline: unknown;
   /** The directory asset paths are relative to (the episode). */
   assetRoot: string;
+  /** Folders outside assetRoot that assets may also come from (a channel's theme releases, ADR-0040). */
+  sharedRoots?: string[];
   outputPath: string;
   concurrency?: number;
   /** Opt in to disposable one-second video segments and whole-video reuse. */
@@ -51,7 +53,7 @@ export async function renderTimeline(options: RenderTimelineOptions): Promise<Re
     throw new ComposerError(code, `the timeline cannot be rendered: ${checked.problems.map((p) => `${p.code} at ${p.path}`).join('; ')}`, checked.problems);
   }
   const timeline = checked.timeline;
-  const staging = await stageAssets(timeline, options.assetRoot);
+  const staging = await stageAssets(timeline, options.assetRoot, options.sharedRoots);
   if (!staging.ok) {
     throw new ComposerError(staging.problems[0]!.code, `assets are not what the timeline says: ${staging.problems.map((p) => p.message).join('; ')}`, staging.problems);
   }
````

Run: `node --import tsx --test test/assets.test.ts`
Expected: PASS, 4 tests. (The `index.ts` export of `BUNDLED_FAMILIES` compiles once Step 3's `fonts@1.1.0` exists.)

- [ ] **Step 3: The library modules**

Create `packages/remotion-composer/src/kits/lib/look/1.0.0.ts`:

````ts
// look@1.0.0 — released: never edit this file; add look/<next>.ts instead (ADR-0039, ADR-0040).
// The vocabulary a channel-neutral kit draws with: colour roles, font roles
// and a few shared measures. A channel theme (studio contracts, ChannelTheme)
// carries the same shape as data; the compiler passes it through untouched.

import type {CSSProperties} from 'react';
import {z} from 'zod';

const color = z.string().regex(/^(#[0-9a-fA-F]{6}|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\))$/, 'a colour is #rrggbb or rgba(r, g, b, a)');

export const COLOR_ROLES = ['ink', 'text', 'textDim', 'accent', 'highlight', 'glow', 'lightning', 'plate', 'plateLine', 'shadow', 'backdrop', 'signal'] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

export const LookSchema = z.object({
  /**
   * ink: dark text on light; text, textDim: light text; accent: kickers, rules, glows;
   * highlight: said and strong words, marks; glow: soft light; lightning: bolts;
   * plate, plateLine: dark plates and their edge; shadow; backdrop: full-frame
   * dark grounds; signal: a warning colour.
   */
  colors: z.object(Object.fromEntries(COLOR_ROLES.map((r) => [r, color])) as Record<ColorRole, typeof color>).strict(),
  /** Families among the bundled faces (fonts@1.1.0); weights are the kits'. */
  fonts: z.object({display: z.string().min(1), serif: z.string().min(1), sans: z.string().min(1)}).strict(),
  measures: z.object({plateRadius: z.number().min(0).max(64), textShadow: z.string().min(1).max(200), minTextPx: z.number().min(10).max(80)}).strict(),
}).strict();
export type Look = z.infer<typeof LookSchema>;

/** A full dark plate: fill, edge, shadow and the accent's inset line on top. */
export const plateStyle = (look: Look, accentLine = true): CSSProperties => ({
  background: look.colors.plate,
  border: `1px solid ${look.colors.plateLine}`,
  borderRadius: look.measures.plateRadius,
  // a short shadow: plates sit near the safe zone's edge, and the zone counts every pixel drawn
  boxShadow: `0 10px 24px ${look.colors.shadow}${accentLine ? `, inset 0 2px 0 ${look.colors.accent}` : ''}`,
});

/** A colour of the look at opacity `a` (multiplied into an rgba colour's own). */
export const alpha = (c: string, a: number): string => {
  const hex = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(c);
  if (hex) return `rgba(${parseInt(hex[1]!, 16)},${parseInt(hex[2]!, 16)},${parseInt(hex[3]!, 16)},${+a.toFixed(3)})`;
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(c);
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${+(parseFloat(m[4]!) * a).toFixed(3)})` : c;
};

/** A size never under the look's minimum for text. */
export const textPx = (look: Look, px: number): number => Math.max(px, look.measures.minTextPx);

/** A demo look with no channel in it, for kit examples and previews. */
export const DEMO_LOOK: Look = {
  colors: {
    ink: '#1b1d24', text: '#f4f5f7', textDim: 'rgba(244,245,247,.85)', accent: '#4f9dff', highlight: '#ffd166', glow: '#cfe3ff',
    lightning: '#c9c3ff', plate: 'rgba(20,22,30,.86)', plateLine: 'rgba(255,255,255,.4)', shadow: 'rgba(0,0,0,.4)', backdrop: '#14161e', signal: '#ff5d6c',
  },
  fonts: {display: 'Anton', serif: 'Fraunces', sans: 'Inter'},
  measures: {plateRadius: 12, textShadow: '0 2px 3px rgba(0,0,0,.8), 0 0 14px rgba(0,0,0,.5)', minTextPx: 26},
};
````

Create `packages/remotion-composer/src/kits/lib/fonts/1.1.0.ts`:

````ts
// fonts@1.1.0 — released: never edit this file; add fonts/<next>.ts instead (ADR-0039, ADR-0040).
// Every bundled face (@fontsource 5.3.0, OFL), by family. A look names a
// family per role; useLookFonts loads only those families' faces, in the
// browser, before the first frame. A face that fails stops the render.

import {useEffect, useState} from 'react';
import {cancelRender, continueRender, delayRender} from 'remotion';

type Face = [weight: string, style: string, file: () => Promise<{default: string}>];
const FAMILIES: Record<string, Face[]> = {
  Anton: [['400', 'normal', () => import('@fontsource/anton/files/anton-latin-400-normal.woff2')]],
  Fraunces: [
    ['400', 'normal', () => import('@fontsource/fraunces/files/fraunces-latin-400-normal.woff2')],
    ['400', 'italic', () => import('@fontsource/fraunces/files/fraunces-latin-400-italic.woff2')],
    ['700', 'normal', () => import('@fontsource/fraunces/files/fraunces-latin-700-normal.woff2')],
    ['700', 'italic', () => import('@fontsource/fraunces/files/fraunces-latin-700-italic.woff2')],
  ],
  Inter: [
    ['200', 'normal', () => import('@fontsource/inter/files/inter-latin-200-normal.woff2')],
    ['300', 'normal', () => import('@fontsource/inter/files/inter-latin-300-normal.woff2')],
    ['400', 'normal', () => import('@fontsource/inter/files/inter-latin-400-normal.woff2')],
    ['600', 'normal', () => import('@fontsource/inter/files/inter-latin-600-normal.woff2')],
  ],
};
export const BUNDLED_FAMILIES = Object.keys(FAMILIES);

/** The CSS family a bundled family is registered under. */
export const cssFamily = (family: string): string => `Studio ${family}`;

const loading = new Map<string, Promise<void>>();
function loadFamily(family: string): Promise<void> {
  const faces = FAMILIES[family];
  if (!faces) return Promise.reject(new Error(`no bundled font family "${family}" (${BUNDLED_FAMILIES.join(', ')})`));
  let p = loading.get(family);
  if (!p) {
    p = Promise.all(faces.map(async ([weight, style, file]) => {
      const url = (await file()).default;
      const face = new FontFace(cssFamily(family), `url(${url}) format('woff2')`, {weight, style});
      await face.load();
      // FontFaceSet is set-like; the DOM typings here lack its add().
      (document.fonts as unknown as Set<FontFace>).add(face);
    })).then(() => undefined, (error: unknown) => {
      loading.delete(family);
      throw error;
    });
    loading.set(family, p);
  }
  return p;
}

/** Hold the frame until the look's families are loaded; their CSS families, by role. */
export function useLookFonts(fonts: {display: string; serif: string; sans: string}): {display: string; serif: string; sans: string} {
  const families = [...new Set([fonts.display, fonts.serif, fonts.sans])];
  const [handle] = useState(() => delayRender(`fonts@1.1.0 ${families.join(', ')}`));
  const key = families.join('|');
  useEffect(() => {
    Promise.all(families.map(loadFamily)).then(() => continueRender(handle), (error: unknown) => {
      cancelRender(error instanceof Error ? error : new Error(String(error)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, key]);
  return {display: cssFamily(fonts.display), serif: cssFamily(fonts.serif), sans: cssFamily(fonts.sans)};
}
````

Create `packages/remotion-composer/src/kits/lib/lesson-stage/1.0.0.tsx`:

````tsx
// lesson-stage@1.0.0 — released: never edit this file; add lesson-stage/<next>.tsx instead (ADR-0039, ADR-0040).
// What the 16:9 lesson stage draws with, channel-neutral: every colour comes
// from the look's roles. Rewritten from CreativeStudio's poesie-museo-long
// runtime v10 (ui.tsx, fx7.tsx): the glass panel, the cover framing, the
// looping monitor clip, the distant storm in a sky polygon, the live bolt,
// the teleport column and the warp between rooms; SVG ids unique per
// instance, images and videos URLs their caller resolved.

import React, {useId} from 'react';
import {Freeze, Img, OffthreadVideo} from 'remotion';
import {clamp, ease, rnd} from '../stage-math/1.0.0.js';
import {alpha, type Look} from '../look/1.0.0.js';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Point = [number, number];

const sid = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, '');

// --------------------------------------------------------------- lightning
export const boltPoints = (x0: number, y0: number, x1: number, y1: number, n: number, seed: number, jitter = 90): Point[] =>
  Array.from({length: n}, (_, i) => {
    const k = i / (n - 1);
    const j = i === 0 || i === n - 1 ? 0 : (rnd(seed + i * 3.1) - 0.5) * jitter * (1 - Math.abs(k - 0.5));
    return [x0 + (x1 - x0) * k + j, y0 + (y1 - y0) * k + (rnd(seed + i) - 0.5) * 12];
  });
export const ptsPath = (p: Point[]) => 'M' + p.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');

/** How bright the scene is under a lightning flash at t, from the strike instants. */
export const strikeAt = (t: number, strikes: readonly number[]): number =>
  strikes.reduce((m, a) => {
    const d = t - a;
    return d < 0 || d > 0.7 ? m : Math.max(m, d < 0.06 ? 1 : d < 0.12 ? 0.35 : d < 0.2 ? 0.85 : Math.exp(-(d - 0.2) * 6) * 0.6);
  }, 0);

/** A live bolt, redrawn every few frames, branching, glowing in the look's lightning; `grow` 0 → 1 draws it down. */
export const LiveBolt: React.FC<{look: Look; t: number; x0: number; y0: number; x1: number; y1: number; op: number; seed?: number; grow?: number}> = ({look, t, x0, y0, x1, y1, op, seed = 1, grow = 1}) => {
  const id = sid(useId());
  if (op <= 0) return null;
  const s = Math.floor(t * 10) + seed;
  const pts = boltPoints(x0, y0, x1, y1, 12, s, 70);
  const n = Math.max(2, Math.round(pts.length * clamp(grow)));
  const fl = 0.55 + 0.45 * rnd(Math.floor(t * 30) + seed);
  const br = [3, 6, 9].filter((i) => i < n - 1).map((i) => boltPoints(pts[i]![0], pts[i]![1], pts[i]![0] + (rnd(s + i) - 0.5) * 260, pts[i]![1] + 90 + rnd(s + i + 1) * 120, 5, s + i, 30));
  return (
    <g opacity={op * fl}>
      <defs><filter id={`${id}b`}><feGaussianBlur stdDeviation="8" /></filter></defs>
      <path d={ptsPath(pts.slice(0, n))} stroke={look.colors.lightning} strokeWidth={16} fill="none" opacity={0.35} filter={`url(#${id}b)`} />
      <path d={ptsPath(pts.slice(0, n))} stroke="#ffffff" strokeWidth={4} fill="none" />
      {br.map((b, j) => <path key={j} d={ptsPath(b)} stroke={look.colors.lightning} strokeWidth={2} fill="none" opacity={0.8} />)}
    </g>
  );
};

/** Where a vertical line at x crosses a polygon: its top and bottom, or null outside. */
export const polygonSpan = (poly: readonly Point[], x: number): [number, number] | null => {
  const ys: number[] = [];
  poly.forEach(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length]!;
    if ((x >= Math.min(ax, bx) && x <= Math.max(ax, bx)) && ax !== bx) ys.push(ay + ((x - ax) / (bx - ax)) * (by - ay));
  });
  return ys.length < 2 ? null : [Math.min(...ys), Math.max(...ys)];
};

export interface Sky {
  poly: Point[];
  period?: number;
  seed?: number;
  scale?: number;
}

/**
 * A distant storm in a sky polygon: thin, slow bolts from its top edge towards
 * its horizon, not every period (some are skipped), a soft glow where they
 * start. `calm` 0 hides it (the loop's first and last frames).
 */
export const DistantStorm: React.FC<{look: Look; t: number; sky: Sky; calm?: number}> = ({look, t, sky, calm = 1}) => {
  const id = sid(useId());
  if (calm <= 0.01) return null;
  const period = sky.period ?? 7;
  const seed = sky.seed ?? 1;
  const scale = sky.scale ?? 1;
  const xs = sky.poly.map(([x]) => x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const x0 = minX + (maxX - minX) * 0.06;
  const x1 = maxX - (maxX - minX) * 0.06;
  const k0 = Math.floor(t / period);
  const items = [k0 - 1, k0].flatMap((k) => {
    if (k < 0 || rnd(seed * 31 + k * 7.3) < 0.3) return [];
    const at = k * period + rnd(seed * 13 + k) * period * 0.7;
    const dt = t - at;
    if (dt < 0 || dt > 1.6) return [];
    const x = x0 + rnd(seed * 5 + k * 3.1) * (x1 - x0);
    const span = polygonSpan(sky.poly, x);
    if (!span) return [];
    const top = span[0] + 30 * scale;
    const horizon = span[1] - 4;
    const y0 = top + (horizon - top) * (0.05 + 0.25 * rnd(seed + k * 2.2));
    const grow = ease(dt / 0.45);
    const op = clamp(0.55 + 0.45 * Math.sin(dt * 9)) * (1 - clamp((dt - 0.7) / 0.9));
    return [{k, x, y0, y1: horizon, grow, op, glow: Math.exp(-((dt - 0.25) ** 2) / 0.08)}];
  });
  return (
    <g opacity={calm}>
      <defs>
        <clipPath id={`${id}c`}><polygon points={sky.poly.map((p) => p.join(',')).join(' ')} /></clipPath>
        <filter id={`${id}b`}><feGaussianBlur stdDeviation={6 * scale} /></filter>
        <radialGradient id={`${id}g`}><stop offset="0" stopColor={look.colors.lightning} stopOpacity=".55" /><stop offset="1" stopColor={look.colors.lightning} stopOpacity="0" /></radialGradient>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        {items.map(({k, x, y0, y1, grow, op, glow}) => {
          const xe = x + (rnd(k + seed) - 0.5) * 40;
          const pts = Array.from({length: 9}, (_, i): Point => [x + (xe - x) * (i / 8) + (i && i < 8 ? (rnd(seed * 17 + k + i * 1.7) - 0.5) * 34 : 0), y0 + (y1 - y0) * (i / 8)]);
          const len = Math.hypot(xe - x, y1 - y0) * 1.5;
          const b = pts[3 + Math.floor(rnd(seed * 17 + k + 9) * 3)]!;
          const dir = rnd(seed * 17 + k + 4) > 0.5 ? 1 : -1;
          const branch = `M${b[0].toFixed(1)} ${b[1].toFixed(1)} L${(b[0] + dir * 22).toFixed(1)} ${(b[1] + (y1 - y0) * 0.16).toFixed(1)} L${(b[0] + dir * 30).toFixed(1)} ${(b[1] + (y1 - y0) * 0.3).toFixed(1)}`;
          return (
            <g key={k}>
              <ellipse cx={x} cy={y0 + 20} rx={90 * scale} ry={60 * scale} fill={`url(#${id}g)`} opacity={glow * 0.8} />
              <path d={ptsPath(pts)} stroke={look.colors.lightning} strokeWidth={5 * scale} fill="none" opacity={op * 0.6} filter={`url(#${id}b)`} strokeDasharray={len} strokeDashoffset={len * (1 - grow)} />
              <path d={ptsPath(pts)} stroke="#ffffff" strokeWidth={1.6 * scale} fill="none" opacity={op * 0.85} strokeDasharray={len} strokeDashoffset={len * (1 - grow)} strokeLinejoin="round" />
              <path d={branch} stroke="#ffffff" strokeWidth={1.1 * scale} fill="none" opacity={op * 0.6 * clamp((grow - 0.5) * 2)} />
            </g>
          );
        })}
      </g>
    </g>
  );
};

// --------------------------------------------------------------- pictures
/**
 * An image of any shape covering a box: its point (cx, cy) kept in view,
 * zoomed about that point. The browser fits it (object-fit: cover), so no
 * aspect ratio is assumed.
 */
export const Cover: React.FC<{src: string; box: Box; cx?: number; cy?: number; zoom?: number; filter?: string}> = ({src, box, cx = 0.5, cy = 0.5, zoom = 1, filter}) => (
  <div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden'}}>
    <Img src={src} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${cx * 100}% ${cy * 100}%`, transform: `scale(${zoom})`, transformOrigin: `${cx * 100}% ${cy * 100}%`, filter}} />
  </div>
);

/** A video in a box that shows its own first frame, frozen, where `live` is 0 (the loop's first and last frames). */
export const LoopClip: React.FC<{src: string; box: Box; live: number; filter?: string}> = ({src, box, live, filter}) => (
  <div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden'}}>
    <Freeze frame={0}><OffthreadVideo src={src} muted style={{width: '100%', height: '100%', objectFit: 'cover', filter}} /></Freeze>
    {live > 0 && <div style={{position: 'absolute', inset: 0, opacity: live}}><OffthreadVideo src={src} muted style={{width: '100%', height: '100%', objectFit: 'cover', filter}} /></div>}
  </div>
);

// --------------------------------------------------------------- glass panel
/**
 * A glass panel: blurred behind, a thin edge, a line of light on top, its
 * reflection on the floor; `on` 0 → 1 materialises it with a scan line,
 * `spin` turns it on itself (degrees), `flash` lights its edge.
 */
export const Glass: React.FC<{look: Look; box: Box; t: number; on?: number; tilt?: number; spin?: number; flash?: number; children?: React.ReactNode}> = ({look, box, t, on = 1, tilt = -5, spin = 0, flash = 0, children}) => {
  if (on <= 0.001) return null;
  const k = ease(on);
  const sy = 0.04 + 0.96 * ease((on - 0.1) / 0.9);
  const a = look.colors.accent;
  return (
    <div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, perspective: 2200, opacity: Math.min(1, on * 2.2)}}>
      <div style={{position: 'absolute', inset: 0, transform: `rotateY(${tilt + spin}deg) scaleY(${sy}) translateY(${Math.sin(t * 0.6) * 3}px)`, transformOrigin: '50% 50%', WebkitBoxReflect: 'below 26px linear-gradient(transparent 62%, rgba(255,255,255,.16))'} as React.CSSProperties}>
        <div style={{position: 'absolute', inset: 0, borderRadius: look.measures.plateRadius + 2, background: alpha(look.colors.plate, 0.5), backdropFilter: 'blur(14px) saturate(1.25)', border: `1px solid ${look.colors.plateLine}`, boxShadow: `0 0 0 1px ${alpha(a, 0.18 + 0.3 * flash)}, 0 40px 90px ${look.colors.shadow}, inset 0 1px 0 rgba(255,255,255,.7), 0 0 ${40 + 80 * flash}px ${alpha(a, 0.12 + 0.35 * flash)}`, overflow: 'hidden'}}>
          <div style={{position: 'absolute', inset: 10, borderRadius: 8, overflow: 'hidden'}}>{children}</div>
          <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(255,255,255,.22) 0%, rgba(255,255,255,0) 28%, rgba(255,255,255,0) 70%, rgba(255,255,255,.08) 100%)', pointerEvents: 'none'}} />
          <div style={{position: 'absolute', left: 24, right: 24, top: 0, height: 2, background: a, opacity: 0.9, boxShadow: `0 0 18px ${a}`}} />
          {on < 1 && <div style={{position: 'absolute', left: 0, right: 0, top: `${k * 100}%`, height: 3, background: '#fff', boxShadow: `0 0 30px ${a}`}} />}
        </div>
      </div>
    </div>
  );
};

// --------------------------------------------------------------- teleport
/**
 * A column of light, rings on the floor, the figure breaking into slices
 * and sparks rising: k = 0 the whole figure, 1 gone (an entrance runs k from
 * 1 to 0). `floorY` is where it stands, `h` its height in px.
 */
export const Teleport: React.FC<{look: Look; t: number; k: number; x: number; h: number; w?: number; floorY: number; children: React.ReactNode}> = ({look, t, k, x, h, w = 240, floorY, children}) => {
  const id = sid(useId());
  const a = look.colors.accent;
  const peak = Math.sin(Math.PI * clamp(k));
  const top = floorY - h - 40;
  const N = 34;
  const sh = (h + 60) / N;
  const f = Math.floor(t * 30);
  return (
    <g>
      <defs>
        <linearGradient id={`${id}beam`} x1="0" x2="1"><stop offset="0" stopColor={a} stopOpacity="0" /><stop offset=".35" stopColor={a} stopOpacity=".35" /><stop offset=".5" stopColor="#ffffff" stopOpacity=".85" /><stop offset=".65" stopColor={a} stopOpacity=".35" /><stop offset="1" stopColor={a} stopOpacity="0" /></linearGradient>
        <filter id={`${id}cy`} x="-30%" y="-10%" width="160%" height="120%"><feFlood floodColor={look.colors.glow} /><feComposite in2="SourceAlpha" operator="in" result="s" /><feGaussianBlur in="s" stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="s" /></feMerge></filter>
        <mask id={`${id}m`}>
          {Array.from({length: N}, (_, j) => {
            const v = clamp((1 - k) * 1.7 - (j / N) * 0.4 - rnd(j * 7.3) * 0.3);
            return <rect key={j} x={x - w} y={top + j * sh} width={2 * w} height={sh * v + 0.6} fill="#fff" />;
          })}
        </mask>
      </defs>
      <rect x={x - w * 0.62} y={0} width={w * 1.24} height={floorY + 10} fill={`url(#${id}beam)`} opacity={peak * 0.95} />
      <rect x={x - 3} y={0} width={6} height={floorY} fill="#fff" opacity={peak * 0.9} />
      {[0, 1, 2].map((j) => {
        const ph = (t * 1.4 + j / 3) % 1;
        return <ellipse key={j} cx={x} cy={floorY - ph * (h + 30)} rx={w * (0.55 + 0.15 * Math.sin(ph * Math.PI))} ry={22} fill="none" stroke={a} strokeWidth={3} opacity={peak * (1 - ph) * 0.9} />;
      })}
      <ellipse cx={x} cy={floorY} rx={w * 0.7} ry={30} fill={a} opacity={peak * 0.35} />
      <ellipse cx={x} cy={floorY} rx={w * (0.5 + 0.4 * peak)} ry={26} fill="none" stroke="#fff" strokeWidth={4} opacity={peak} />
      <g mask={`url(#${id}m)`}>
        <g opacity={1 - 0.35 * peak}>{children}</g>
        <g filter={`url(#${id}cy)`} opacity={peak * 0.75} transform={`translate(${(rnd(f) - 0.5) * 26 * peak} 0)`}>{children}</g>
      </g>
      {Array.from({length: 46}, (_, j) => {
        const sp = 0.35 + rnd(j + 3) * 0.6;
        const yy = floorY - ((t * sp + rnd(j)) % 1) * (h + 120);
        const xx = x + (rnd(j + 11) - 0.5) * w * 1.3;
        return <circle key={j} cx={xx} cy={yy} r={1.6 + rnd(j + 5) * 3} fill={j % 3 ? look.colors.glow : a} opacity={peak * (0.4 + 0.6 * rnd(j + (f % 7)))} />;
      })}
    </g>
  );
};

// --------------------------------------------------------------- warp
/** The passage between rooms: a white flash in the look's glow with radial streaks; k 0 → 1 → 0, the room changes at the peak. */
export const WarpLayer: React.FC<{look: Look; k: number}> = ({look, k}) => {
  const id = sid(useId());
  if (k <= 0) return null;
  return (
    <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
      <defs><radialGradient id={`${id}g`}><stop offset="0" stopColor="#ffffff" stopOpacity="1" /><stop offset=".45" stopColor={look.colors.glow} stopOpacity=".85" /><stop offset="1" stopColor={look.colors.lightning} stopOpacity=".55" /></radialGradient></defs>
      <rect width="1920" height="1080" fill={`url(#${id}g)`} opacity={Math.pow(k, 1.6)} />
      {Array.from({length: 70}, (_, j) => {
        const a = rnd(j) * Math.PI * 2;
        const r0 = 120 + rnd(j + 3) * 300;
        const r1 = r0 + (200 + rnd(j + 7) * 900) * k;
        return <line key={j} x1={960 + Math.cos(a) * r0} y1={540 + Math.sin(a) * r0} x2={960 + Math.cos(a) * r1} y2={540 + Math.sin(a) * r1} stroke={j % 4 ? '#ffffff' : look.colors.accent} strokeWidth={1.5 + rnd(j + 2) * 3} opacity={0.8 * k} />;
      })}
    </svg>
  );
};
````

Run: `npx tsc --noEmit && npm run kits:lock && git diff --exit-code kits.lock.json && npm test`
Expected:
- the lock is unchanged, because no kit imports the new modules yet;
- everything passes, as before.

- [ ] **Step 4: Commit**

```bash
git add packages/remotion-composer/src/kits/lib/look packages/remotion-composer/src/kits/lib/fonts/1.1.0.ts \
  packages/remotion-composer/src/kits/lib/lesson-stage packages/remotion-composer/src/assets.ts \
  packages/remotion-composer/src/render.ts packages/remotion-composer/src/layout-sheet.ts \
  packages/remotion-composer/src/index.ts packages/remotion-composer/test/assets.test.ts
git commit -m "Composer: the look vocabulary, fonts by family, the lesson stage's drawing code, shared asset roots (ADR-0040, avg-dcf.4.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The neutral titles and transitions: brand-mark 2.0.0, block-title, figure-title, verse-bar, cover, chapter-opener, warp

**Files:**
- Create:
  - `packages/remotion-composer/src/kits/{block-title,figure-title,verse-bar,cover,chapter-opener,warp}/1.0.0.tsx`;
  - `packages/remotion-composer/src/kits/brand-mark/2.0.0.tsx`;
  - their seven `previews/*.youtube-1920x1080.png`.
- Modify: `src/kits/index.ts`, `test/validate.test.ts`, `kits.lock.json`

- [ ] **Step 1: Write the failing tests**

In `packages/remotion-composer/test/validate.test.ts`:

1. Add the import after the `listKits` one:

```ts
import {DEMO_LOOK} from '../src/kits/lib/look/1.0.0.js';
```

2. Change the start of "refuses kits it does not have, by name or by version" to:

```ts
  it('refuses kits it does not have, by name or by version', () => {
    // The lesson excerpt (a contracts sketch) uses sala, interprete@1.0.0 and verse-bar@1.0.0: sala does
    // not exist, interprete@1.0.0 is drawn for 9:16 only (the lesson's is 1.1.0), and the sketch's
    // verse-bar props are not the real kit's (it takes a look and lines of words).
    const codes = new Set(problems(fixture('lesson-excerpt.json')).map(([code]) => code));
    assert.deepEqual([...codes].sort(), ['bad-props', 'unknown-kit', 'wrong-profile']);
```

3. Add before "refuses props a kit does not accept, at the offending field":

```ts
  it('accepts a channel-neutral lesson kit with a look in 16:9, and refuses a malformed look at its path', () => {
    const doc = clone(fixture('explainer.json'));
    doc.tracks[0].items[0].kit = {name: 'block-title', version: '1.0.0'};
    doc.tracks[0].items[0].props = {look: clone(DEMO_LOOK), kicker: 'CHAPTER I', title: 'THE CONTEXT'};
    assert.deepEqual(problems(doc), []);
    doc.tracks[0].items[0].props.look.colors.accent = 'cyan';
    delete doc.tracks[0].items[0].props.look.fonts.serif;
    assert.deepEqual(problems(doc).sort(), [
      ['bad-props', '$.tracks[0].items[0].props.look.colors.accent'],
      ['bad-props', '$.tracks[0].items[0].props.look.fonts.serif'],
    ]);
  });

  it('refuses a 16:9 lesson kit in a 9:16 timeline', () => {
    const doc = clone(fixture('vertical-short.json'));
    doc.tracks[0].items[0].kit = {name: 'chapter-opener', version: '1.0.0'};
    doc.tracks[0].items[0].props = {look: clone(DEMO_LOOK), kicker: 'CHAPTER I', title: 'THE CONTEXT'};
    assert.deepEqual(problems(doc), [['wrong-profile', '$.tracks[0].items[0].kit']]);
  });
```

4. In "lists every kit version with what the catalog needs", make the listing:

```ts
    assert.deepEqual(listKits(ids).map((k) => [k.name, k.version, k.layer]), [
      ['block-title', '1.0.0', 'overlay'],
      ['brand-mark', '1.0.0', 'overlay'],
      ['brand-mark', '2.0.0', 'overlay'],
      ['captions', '1.0.0', 'fill'],
      ['captions', '1.1.0', 'overlay'],
      ['chapter-opener', '1.0.0', 'fill'],
      ['clip', '1.0.0', 'fill'],
      ['cover', '1.0.0', 'fill'],
      ['figure-title', '1.0.0', 'overlay'],
      ['interprete', '1.0.0', 'fill'],
      ['lower-third', '1.0.0', 'overlay'],
      ['museum-hall', '1.0.0', 'fill'],
      ['room-effect', '1.0.0', 'fill'],
      ['still', '1.0.0', 'fill'],
      ['title-chip', '1.0.0', 'overlay'],
      ['verse-bar', '1.0.0', 'overlay'],
      ['verse-plate', '1.0.0', 'overlay'],
      ['warp', '1.0.0', 'fill'],
    ]);
```

Run: `cd packages/remotion-composer && node --import tsx --test test/validate.test.ts`
Expected: FAIL (the kits do not exist).

- [ ] **Step 2: The kits**

Create `packages/remotion-composer/src/kits/brand-mark/2.0.0.tsx`:

````tsx
// brand-mark@2.0.0 — released: never edit this file; add brand-mark/<next>.tsx instead.
// A channel's mark on a glass pill, top left of a 16:9 frame: its text and
// icon from the channel theme's brand, its colours and font from the look
// (ADR-0040). 2.0.0: channel-neutral, the look and the text are props.
import React from 'react';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';

const BrandMark: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  return (
    <div style={{position: 'absolute', left: (props.x as number | undefined) ?? 110, top: (props.y as number | undefined) ?? 60, display: 'flex', alignItems: 'center', gap: 12, padding: '9px 18px 9px 14px', borderRadius: 999, background: alpha(look.colors.plate, 0.72), border: `1px solid ${look.colors.plateLine}`}}>
      {props.icon === 'bolt' ? <svg width="18" height="26" viewBox="0 0 18 26"><path d="M11 0 L1 15 H8 L6 26 L17 10 H10 Z" fill={look.colors.highlight} /></svg> : null}
      <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: 22, letterSpacing: 6, color: look.colors.text, whiteSpace: 'nowrap'}}>{props.text as string}</div>
    </div>
  );
};

export const kit: KitVersion = {
  name: 'brand-mark',
  version: '2.0.0',
  description: "A channel's mark — its icon and name on a glass pill — top left of a 16:9 frame, in the channel theme's look.",
  layer: 'overlay',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    text: z.string().min(1).max(40),
    icon: z.enum(['bolt', 'none']),
    x: z.number().min(0).optional(),
    y: z.number().min(0).optional(),
  }).strict(),
  component: BrandMark,
  examples: [
    {id: 'bolt', props: {look: DEMO_LOOK, text: 'DEMO CHANNEL', icon: 'bolt'}, durationInFrames: 30, frame: 0},
    {id: 'text-only', props: {look: DEMO_LOOK, text: 'DEMO', icon: 'none'}, durationInFrames: 30, frame: 0},
  ],
};
````

Create `packages/remotion-composer/src/kits/block-title/1.0.0.tsx`:

````tsx
// block-title@1.0.0 — released: never edit this file; add block-title/<next>.tsx instead.
// Opens a block of a lesson: kicker, title, a rule that grows, one line of
// information, on a full plate at the bottom left of a 16:9 frame (from
// CreativeStudio's poesie-museo-long LowerH). Channel-neutral: the look is a
// prop (ADR-0040); it fades through the timeline's transitions.
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, plateStyle, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {ease} from '../lib/stage-math/1.0.0.js';

const BlockTitle: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const t = useCurrentFrame() / useVideoConfig().fps;
  const grow = (props.ruleGrow as number | undefined) ?? 0.6;
  const rule = grow > 0 ? ease((t - 0.3) / grow) : 1;
  const info = props.info as string | undefined;
  return (
    <div style={{position: 'absolute', left: (props.x as number | undefined) ?? 128, bottom: 1080 - ((props.bottom as number | undefined) ?? 940)}}>
      <div style={{display: 'inline-flex', flexDirection: 'column', padding: '18px 30px 20px 26px', ...plateStyle(look, false)}}>
        <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: 26, letterSpacing: 6, color: look.colors.accent, lineHeight: 1}}>{props.kicker as string}</div>
        <div style={{fontFamily: fonts.display, fontSize: 54, letterSpacing: 2, color: look.colors.text, lineHeight: 1, marginTop: 14, whiteSpace: 'nowrap'}}>{props.title as string}</div>
        <div style={{height: 2, background: look.colors.accent, marginTop: 12, width: `${100 * rule}%`}} />
        {info ? <div style={{fontFamily: fonts.sans, fontWeight: 400, fontSize: 28, color: look.colors.textDim, lineHeight: 1.2, marginTop: 12, whiteSpace: 'nowrap'}}>{info}</div> : null}
      </div>
    </div>
  );
};

export const kit: KitVersion = {
  name: 'block-title',
  version: '1.0.0',
  description: 'Opens a block of a lesson: kicker, title, a growing rule and one line of information on a plate at the bottom left of a 16:9 frame, in the channel theme\'s look.',
  layer: 'overlay',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    kicker: z.string().min(1).max(60),
    title: z.string().min(1).max(40),
    info: z.string().min(1).max(80).optional(),
    x: z.number().min(0).optional(),
    /** Where the plate's bottom edge sits. */
    bottom: z.number().positive().optional(),
    /** Seconds the rule takes to grow, from 0.3 s; 0: already drawn. */
    ruleGrow: z.number().min(0).optional(),
  }).strict(),
  component: BlockTitle,
  examples: [
    {id: 'opening', props: {look: DEMO_LOOK, kicker: 'CHAPTER I · THE CONTEXT', title: 'ITALY IN 1894', info: 'poverty, emigration, protest'}, durationInFrames: 60, frame: 45},
    {id: 'rule-growing', props: {look: DEMO_LOOK, kicker: 'CHAPTER II', title: 'HOW IT WAS BORN'}, durationInFrames: 60, frame: 15},
  ],
};
````

Create `packages/remotion-composer/src/kits/figure-title/1.0.0.tsx`:

````tsx
// figure-title@1.0.0 — released: never edit this file; add figure-title/<next>.tsx instead.
// The name of a rhetorical figure or a keyword: a kicker and the name in the
// display font on a dark plate, sized to the width it has, settling in
// (from CreativeStudio's poesie-museo-long FigureTitle). Channel-neutral.
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, plateStyle, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {ease} from '../lib/stage-math/1.0.0.js';

const FigureTitle: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const t = useCurrentFrame() / useVideoConfig().fps;
  const k = ease(t / 0.6);
  const w = (props.maxWidth as number | undefined) ?? 820;
  const text = props.text as string;
  const size = Math.min((props.size as number | undefined) ?? 96, (w - 80) / (text.length * 0.5));
  const center = (props.align ?? 'center') === 'center';
  const x = props.x as number;
  return (
    <div style={{position: 'absolute', left: center ? x - w / 2 : x, top: props.y as number, width: w, display: 'flex', justifyContent: center ? 'center' : 'flex-start'}}>
      <div style={{display: 'inline-flex', flexDirection: 'column', alignItems: center ? 'center' : 'flex-start', gap: 10, padding: '18px 34px 22px', ...plateStyle(look), transform: `scale(${0.94 + 0.06 * k})`}}>
        <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: 26, letterSpacing: 7, color: look.colors.accent}}>{props.kicker as string}</div>
        <div style={{fontFamily: fonts.display, fontSize: size, letterSpacing: (1 - k) * 12 + 3, color: look.colors.text, lineHeight: 1, whiteSpace: 'nowrap'}}>{text}</div>
      </div>
    </div>
  );
};

export const kit: KitVersion = {
  name: 'figure-title',
  version: '1.0.0',
  description: 'The name of a rhetorical figure or keyword — a kicker and the name in the display font on a dark plate, fitted to its width — in a 16:9 frame, in the channel theme\'s look.',
  layer: 'overlay',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    kicker: z.string().min(1).max(40),
    text: z.string().min(1).max(40),
    /** Centre (align center) or left edge (align left) of the plate's box. */
    x: z.number(),
    y: z.number(),
    maxWidth: z.number().positive().optional(),
    size: z.number().positive().max(160).optional(),
    align: z.enum(['center', 'left']).optional(),
  }).strict(),
  component: FigureTitle,
  examples: [
    {id: 'figure', props: {look: DEMO_LOOK, kicker: 'RHETORICAL FIGURE', text: 'ONOMATOPOEIA', x: 960, y: 220}, durationInFrames: 45, frame: 30},
    {id: 'settling', props: {look: DEMO_LOOK, kicker: 'KEYWORD', text: 'LIGHT', x: 960, y: 220}, durationInFrames: 45, frame: 6},
  ],
};
````

Create `packages/remotion-composer/src/kits/verse-bar/1.0.0.tsx`:

````tsx
// verse-bar@1.0.0 — released: never edit this file; add verse-bar/<next>.tsx instead.
// The verses being heard or discussed, always readable: one or more lines on
// a full plate across the lower middle of a 16:9 frame, words not yet said
// dimmed, said and strong words in the highlight colour, a kicker above
// (from CreativeStudio's poesie-museo-long VerseBar). Channel-neutral.
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, plateStyle, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';

interface Word {text: string; at?: number; hot?: boolean}

const VerseBar: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const t = useCurrentFrame() / useVideoConfig().fps;
  const w = (props.width as number | undefined) ?? 1240;
  const size = (props.size as number | undefined) ?? 54;
  const kicker = props.kicker as string | undefined;
  return (
    <div style={{position: 'absolute', left: 960 - w / 2, top: (props.y as number | undefined) ?? 790, width: w, display: 'flex', justifyContent: 'center'}}>
      <div style={{display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '16px 46px 20px', maxWidth: w, ...plateStyle(look), borderRadius: look.measures.plateRadius + 2}}>
        {kicker ? <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: 26, letterSpacing: 6, color: look.colors.accent, lineHeight: 1}}>{kicker}</div> : null}
        {(props.lines as Word[][]).map((line, i) => (
          <div key={i} style={{fontFamily: fonts.serif, fontStyle: 'italic', fontSize: size, lineHeight: 1.15, whiteSpace: 'nowrap', color: look.colors.text}}>
            {line.map((word, j) => {
              const said = word.at === undefined || t >= word.at;
              return <span key={j} style={{color: word.hot && said ? look.colors.highlight : look.colors.text, opacity: said ? 1 : 0.5}}>{word.text}{j < line.length - 1 ? ' ' : ''}</span>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

const WordSchema = z.object({text: z.string().min(1), at: z.number().min(0).optional(), hot: z.boolean().optional()}).strict();
const line = (s: string, hot: string[] = [], at?: number) => s.split(' ').map((text, i) => ({text, ...(hot.includes(text.replace(/[^\p{L}]/gu, '')) ? {hot: true} : {}), ...(at !== undefined ? {at: at + i * 0.35} : {})}));

export const kit: KitVersion = {
  name: 'verse-bar',
  version: '1.0.0',
  description: 'The verses heard or discussed, on a full plate across the lower middle of a 16:9 frame: unsaid words dimmed, said and strong words highlighted, a kicker above, in the channel theme\'s look.',
  layer: 'overlay',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** Lines of words; a word with `at` is dimmed until then (seconds from the item's start). */
    lines: z.array(z.array(WordSchema).min(1)).min(1).max(3),
    kicker: z.string().min(1).max(60).optional(),
    y: z.number().min(0).optional(),
    size: z.number().positive().max(80).optional(),
    width: z.number().positive().max(1728).optional(),
  }).strict(),
  component: VerseBar,
  examples: [
    {id: 'one-verse', props: {look: DEMO_LOOK, kicker: 'THE POEM · VERSE 1 OF 7', lines: [line('And sky and earth showed what they were:', ['sky', 'earth'])]}, durationInFrames: 60, frame: 30},
    {id: 'being-said', props: {look: DEMO_LOOK, lines: [line('the earth gasping, livid, in turmoil,', ['earth'], 0.2)]}, durationInFrames: 90, frame: 40},
    {id: 'two-verses', props: {look: DEMO_LOOK, kicker: 'METRE', lines: [line('the sky cluttered, tragic, worn;'), line('white, white in the silent tumult', ['white'])], size: 46, y: 772}, durationInFrames: 60, frame: 30},
  ],
};
````

Create `packages/remotion-composer/src/kits/cover/1.0.0.tsx`:

````tsx
// cover@1.0.0 — released: never edit this file; add cover/<next>.tsx instead.
// The cover a video opens and closes on, readable as a thumbnail: a kicker
// on the highlight colour, the title huge in the display font with an icon,
// two hook lines, over a dark gradient on the left of a 16:9 frame (from
// CreativeStudio's poesie-museo-long Thumb). Channel-neutral. It fills the
// frame (the gradient covers it all); its texts sit inside the safe zone.
import React from 'react';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';

const Cover: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const title = props.titleLines as string[];
  const hooks = (props.hookLines as string[] | undefined) ?? [];
  const kicker = props.kicker as string | undefined;
  const size = Math.min(236, 900 / Math.max(2, ...title.map((w) => w.length * 0.48)));
  const shade = '0 4px 0 rgba(0,0,0,.6), 0 8px 30px rgba(0,0,0,.55)';
  return (
    <div style={{position: 'absolute', inset: 0}}>
      <div style={{position: 'absolute', inset: 0, background: `linear-gradient(90deg, ${alpha(c.backdrop, 0.86)} 0%, ${alpha(c.backdrop, 0.62)} 38%, ${alpha(c.backdrop, 0)} 58%)`}} />
      <div style={{position: 'absolute', left: 120, top: 190, display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}}>
        {kicker ? <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: 34, letterSpacing: 8, color: c.ink, background: c.highlight, padding: '10px 22px 11px', borderRadius: 10}}>{kicker}</div> : null}
        <div style={{position: 'relative', fontFamily: fonts.display, fontSize: size, lineHeight: 0.92, color: c.text, marginTop: 26, letterSpacing: 4, textShadow: `0 0 28px ${c.accent}, 0 6px 0 rgba(0,0,0,.7), 0 12px 40px rgba(0,0,0,.6)`}}>
          {title.map((w, i) => <React.Fragment key={i}>{i ? <br /> : null}{w}</React.Fragment>)}
          {props.icon === 'bolt' ? (
            <svg width="180" height="300" viewBox="0 0 180 300" style={{position: 'absolute', right: -150, top: 40, filter: `drop-shadow(0 0 18px ${c.accent})`}}>
              <path d="M110 0 L20 170 H82 L50 300 L170 110 H104 Z" fill={c.highlight} stroke="#fff" strokeWidth="5" strokeLinejoin="round" />
            </svg>
          ) : null}
        </div>
        {hooks.map((l, i) => <div key={i} style={{fontFamily: fonts.display, fontSize: 70, letterSpacing: 2, color: i ? c.text : c.highlight, marginTop: i ? 6 : 26, lineHeight: 1, textShadow: shade}}>{l}</div>)}
      </div>
    </div>
  );
};

export const kit: KitVersion = {
  name: 'cover',
  version: '1.0.0',
  description: 'The cover a 16:9 video opens and closes on, readable as a thumbnail: kicker, huge title with an icon, two hook lines, over a dark gradient on the left, in the channel theme\'s look.',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    kicker: z.string().min(1).max(30).optional(),
    titleLines: z.array(z.string().min(1).max(14)).min(1).max(2),
    hookLines: z.array(z.string().min(1).max(24)).max(2).optional(),
    icon: z.enum(['bolt', 'none']).optional(),
  }).strict(),
  component: Cover,
  examples: [
    {id: 'two-lines', props: {look: DEMO_LOOK, kicker: 'POET · 7 VERSES', titleLines: ['THE', 'FLASH'], hookLines: ['1 SECOND', 'IN SLOW MOTION'], icon: 'bolt'}, durationInFrames: 30, frame: 0},
    {id: 'one-line', props: {look: DEMO_LOOK, titleLines: ['INFINITY'], hookLines: ['A HEDGE', 'AND THE ENDLESS']}, durationInFrames: 30, frame: 0},
  ],
};
````

Create `packages/remotion-composer/src/kits/chapter-opener/1.0.0.tsx`:

````tsx
// chapter-opener@1.0.0 — released: never edit this file; add chapter-opener/<next>.tsx instead.
// The pause between two chapters of a lesson: a flash, a dark veil, the
// chapter's kicker, its title closing in, a light rule, its subtitle (from
// CreativeStudio's poesie-museo-long chapter card). Channel-neutral: every
// word, including "chapter", is a prop.
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {clamp, ease} from '../lib/stage-math/1.0.0.js';
import {strikeAt} from '../lib/lesson-stage/1.0.0.js';

const ChapterOpener: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const k = ease((t - 0.35) / 0.8);
  const flash = strikeAt(t, [0]);
  const sub = props.sub as string | undefined;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{background: '#000000'}} />
      <AbsoluteFill style={{background: `radial-gradient(1200px 700px at 50% 45%, ${alpha(c.backdrop, 1)}, ${alpha(c.backdrop, 0.38)})`}} />
      <AbsoluteFill style={{background: alpha(c.glow, 0.55 * flash), mixBlendMode: 'screen'}} />
      <div style={{position: 'absolute', left: 0, right: 0, top: 330, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: clamp(t / 0.3)}}>
        <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: 28, letterSpacing: 10, color: c.accent}}>{props.kicker as string}</div>
        <div style={{fontFamily: fonts.display, fontSize: 150, letterSpacing: (1 - k) * 30 + 6, color: c.text, lineHeight: 1, marginTop: 24, textShadow: look.measures.textShadow, whiteSpace: 'nowrap'}}>{props.title as string}</div>
        <div style={{width: 640 * k, height: 2, background: c.accent, marginTop: 26, boxShadow: `0 0 18px ${c.accent}`}} />
        {sub ? <div style={{fontFamily: fonts.sans, fontWeight: 400, fontSize: 38, color: c.text, marginTop: 28}}>{sub}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'chapter-opener',
  version: '1.0.0',
  description: 'The pause between two chapters of a 16:9 lesson: a flash, a dark veil, the chapter kicker, its title closing in, a light rule and a subtitle, in the channel theme\'s look.',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    kicker: z.string().min(1).max(30),
    title: z.string().min(1).max(20),
    sub: z.string().min(1).max(60).optional(),
  }).strict(),
  component: ChapterOpener,
  examples: [
    {id: 'settled', props: {look: DEMO_LOOK, kicker: 'CHAPTER I', title: 'THE CONTEXT', sub: 'Italy in 1894 · how the poem was born'}, durationInFrames: 120, frame: 60},
    {id: 'flash', props: {look: DEMO_LOOK, kicker: 'CHAPTER III', title: 'THE METRE'}, durationInFrames: 120, frame: 2},
  ],
};
````

Create `packages/remotion-composer/src/kits/warp/1.0.0.tsx`:

````tsx
// warp@1.0.0 — released: never edit this file; add warp/<next>.tsx instead.
// The passage between two rooms: a flash with radial streaks that rises to
// its peak — where the room underneath changes — and fades (from
// CreativeStudio's poesie-museo-long Warp). Channel-neutral.
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, type Look} from '../lib/look/1.0.0.js';
import {ramp} from '../lib/stage-math/1.0.0.js';
import {WarpLayer} from '../lib/lesson-stage/1.0.0.js';

const Warp: KitVersion['component'] = ({props}) => {
  const {fps, durationInFrames} = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const end = durationInFrames / fps;
  const rise = (props.rise as number | undefined) ?? 0.55;
  const fall = (props.fall as number | undefined) ?? 0.65;
  const k = ramp(t, 0, Math.min(rise, end / 2)) * (1 - ramp(t, end - Math.min(fall, end / 2), end));
  return <AbsoluteFill><WarpLayer look={props.look as Look} k={k} /></AbsoluteFill>;
};

export const kit: KitVersion = {
  name: 'warp',
  version: '1.0.0',
  description: 'The passage between two rooms of a 16:9 lesson: a flash with radial streaks rising over the item and fading out, the room changing under its peak, in the channel theme\'s look.',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** Seconds from the item's start to full flash, and from full flash to its end. */
    rise: z.number().positive().optional(),
    fall: z.number().positive().optional(),
  }).strict(),
  component: Warp,
  examples: [
    {id: 'peak', props: {look: DEMO_LOOK}, durationInFrames: 36, frame: 18},
    {id: 'rising', props: {look: DEMO_LOOK}, durationInFrames: 36, frame: 8},
  ],
};
````

In `src/kits/index.ts`, import them after `roomEffect100`:

```ts
import {kit as brandMark200} from './brand-mark/2.0.0.js';
import {kit as blockTitle100} from './block-title/1.0.0.js';
import {kit as figureTitle100} from './figure-title/1.0.0.js';
import {kit as verseBar100} from './verse-bar/1.0.0.js';
import {kit as cover100} from './cover/1.0.0.js';
import {kit as chapterOpener100} from './chapter-opener/1.0.0.js';
import {kit as warp100} from './warp/1.0.0.js';
```

and add a line to `KIT_VERSIONS` after the short's:

```ts
  brandMark200, blockTitle100, figureTitle100, verseBar100, cover100, chapterOpener100, warp100,
```

- [ ] **Step 3: Lock, previews, tests**

Run: `npm run kits:lock`. The new entries must be exactly:

```json
  "block-title@1.0.0": "sha256:549ef9f800f2813e048a7a4c5c26e9a00cd1e29e1589dd1b79b0456d22058f02",
  "brand-mark@2.0.0": "sha256:61103f483270805dcc29b5fda1657054f4a1f470e35c3f85005bdd6b9b67d26d",
  "chapter-opener@1.0.0": "sha256:b65e726a269b458ce7db0936afb3985b3dc38501b6d1029b31f497950e498483",
  "cover@1.0.0": "sha256:e64d11376f96021eedd767e76d0f870b1b3d6881b03a8e86a125805c9435541c",
  "figure-title@1.0.0": "sha256:7ceb7fb550c205e981eb5daa1136f8a34ead34ecfb8efb84c44bf1ff3f15d288",
  "verse-bar@1.0.0": "sha256:42ecb3070254bdaf9416d7694cfb914b4d1e9759672b71147b16121aa70e5e79",
  "warp@1.0.0": "sha256:6fe32f8e1d3797c506a1681cc4ff9ed82080f23509bec6054bc69ee750035bf3",
```

Take the previews rendered in the prototype rather than running `npm run kits:previews`:

```bash
git -C "$(git rev-parse --show-toplevel)" checkout 57f8a68 -- \
  packages/remotion-composer/previews/brand-mark@2.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/block-title@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/figure-title@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/verse-bar@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/cover@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/chapter-opener@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/warp@1.0.0.youtube-1920x1080.png
```

Run: `npx tsc --noEmit && npm test`
Expected: PASS. That includes:
- one real frame of every example in 16:9 only;
- every overlay inside the safe zone, shadows included;
- the lock check.

- [ ] **Step 4: Commit**

```bash
git add packages/remotion-composer/src/kits/brand-mark/2.0.0.tsx packages/remotion-composer/src/kits/block-title \
  packages/remotion-composer/src/kits/figure-title packages/remotion-composer/src/kits/verse-bar \
  packages/remotion-composer/src/kits/cover packages/remotion-composer/src/kits/chapter-opener \
  packages/remotion-composer/src/kits/warp packages/remotion-composer/src/kits/index.ts \
  packages/remotion-composer/test/validate.test.ts packages/remotion-composer/kits.lock.json \
  packages/remotion-composer/previews/brand-mark@2.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/block-title@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/figure-title@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/verse-bar@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/cover@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/chapter-opener@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/warp@1.0.0.youtube-1920x1080.png
git commit -m "Lesson titles and transitions as channel-neutral kits: brand-mark 2.0.0, block-title, figure-title, verse-bar, cover, chapter-opener, warp (avg-dcf.4.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The neutral stage: room, panel, interprete 1.1.0; the composer README

**Files:**
- Create:
  - `packages/remotion-composer/src/kits/{room,panel}/1.0.0.tsx`, `src/kits/interprete/1.1.0.tsx`;
  - samples `kits/samples/room-16x9.png`, `kits/samples/clip.mp4`;
  - three previews.
- Modify: `src/kits/index.ts`, `test/validate.test.ts`, `kits.lock.json`, `packages/remotion-composer/README.md`

- [ ] **Step 1: Write the failing test**

In the listing of `test/validate.test.ts`, add `['interprete', '1.1.0', 'fill'],` after `['interprete', '1.0.0', 'fill'],`, `['panel', '1.0.0', 'fill'],` after `['museum-hall', '1.0.0', 'fill'],`, and `['room', '1.0.0', 'fill'],` after `['panel', '1.0.0', 'fill'],`. Run it; expected FAIL.

- [ ] **Step 2: The kits and their samples**

Create `packages/remotion-composer/src/kits/room/1.0.0.tsx`:

````tsx
// room@1.0.0 — released: never edit this file; add room/<next>.tsx instead.
// A room of a 16:9 lesson from the channel theme: its picture under a slow
// drifting camera, a distant storm in its sky regions (rare, slow bolts;
// quiet where the timeline asks, as at the loop's first and last frames),
// its windows and floor lit by a flash, its doors glowing, a monitor that
// plays a clip (from CreativeStudio's poesie-museo-long Sala and atrium).
// Channel-neutral: the room and the look are props (ADR-0040).
import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {ease, win} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema, CameraSchema, cameraStyle, type Camera} from '../lib/stage-props/1.0.0.js';
import {DistantStorm, LoopClip, strikeAt, type Box, type Point, type Sky} from '../lib/lesson-stage/1.0.0.js';

interface RoomProps {
  image: string;
  sky?: Sky[];
  windows?: Point[][];
  doors?: Box[];
  monitor?: {box: Box; video: string};
}
const polygon = (poly: Point[]) => `polygon(${poly.map(([x, y]) => `${x}px ${y}px`).join(',')})`;

const Room: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const room = props.room as RoomProps;
  const fl = strikeAt(t, ((props.flash as {strikes: number[]} | undefined) ?? {strikes: []}).strikes);
  const quiet = (props.quiet as [number, number][] | undefined) ?? [];
  const calm = (props.lightning ?? true) ? quiet.reduce((v, [a, b]) => v * (1 - win(t, a, b, 0.6)), 1) : 0;
  const dark = (props.dark as number | undefined) ?? 0;
  const push = props.push as {at: number; dur: number; scale: number; origin: Point} | undefined;
  const drift = (props.drift ?? true) ? 1 : 0;
  const z0 = 1 + drift * (0.04 + 0.012 * Math.sin(t * 0.05));
  const pk = push ? ease((t - push.at) / push.dur) : 0;
  const scale = z0 * (1 + (push ? push.scale - 1 : 0) * pk);
  const origin = push && pk > 0 ? push.origin : [960, 520];
  const camera = props.camera as Camera | undefined;
  return (
    <AbsoluteFill style={{overflow: 'hidden', background: c.backdrop}}>
      <AbsoluteFill style={camera ? cameraStyle(t, camera) : undefined}>
      <div style={{position: 'absolute', inset: 0, transform: `scale(${scale}) translateX(${drift * Math.sin(t * 0.04) * 8}px)`, transformOrigin: `${origin[0]}px ${origin[1]}px`}}>
        <Img src={room.image} style={{position: 'absolute', inset: 0, width: 1920, height: 1080, filter: `brightness(${1.04 + fl * 0.3 - dark * 0.8}) saturate(1.05)`}} />
        {room.monitor ? (
          <>
            <LoopClip src={room.monitor.video} box={room.monitor.box} live={calm} />
            <div style={{position: 'absolute', left: room.monitor.box.x - 40, top: room.monitor.box.y - 40, width: room.monitor.box.w + 80, height: room.monitor.box.h + 80, background: `radial-gradient(closest-side, ${alpha(c.accent, 0.32)}, ${alpha(c.accent, 0)})`, mixBlendMode: 'screen'}} />
          </>
        ) : null}
        {(room.windows ?? []).map((poly, i) => <div key={i} style={{position: 'absolute', inset: 0, clipPath: polygon(poly), background: alpha(c.glow, fl * 0.75), mixBlendMode: 'screen'}} />)}
        {(room.doors ?? []).map((d, i) => <div key={i} style={{position: 'absolute', left: d.x - 60, top: d.y - 60, width: d.w + 120, height: d.h + 120, background: `radial-gradient(closest-side, ${alpha(c.lightning, 0.3 + fl * 0.6)}, ${alpha(c.lightning, 0)})`, mixBlendMode: 'screen'}} />)}
        <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
          {(room.sky ?? []).map((sky, i) => <DistantStorm key={i} look={look} t={t} sky={sky} calm={calm} />)}
        </svg>
      </div>
      <div style={{position: 'absolute', inset: 0, background: `radial-gradient(1300px 900px at 8% 32%, ${alpha(c.glow, fl * 0.55)}, ${alpha(c.glow, 0)} 70%)`, mixBlendMode: 'screen'}} />
      <div style={{position: 'absolute', left: 0, right: 0, top: 640, bottom: 0, background: `linear-gradient(100deg, ${alpha(c.glow, fl * 0.45)}, ${alpha(c.glow, 0)} 55%)`, mixBlendMode: 'screen'}} />
      {dark > 0 ? <div style={{position: 'absolute', inset: 0, background: alpha(c.backdrop, dark * 0.82)}} /> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const PointSchema = z.tuple([z.number(), z.number()]);
const SAMPLE_ROOM = {
  image: {$asset: 'room'},
  sky: [{poly: [[0, 0], [660, 262], [660, 540], [0, 492]], period: 3, seed: 3}],
  windows: [[[0, 0], [660, 170], [660, 600], [0, 760]]],
  doors: [{x: 1250, y: 300, w: 200, h: 420}],
};

export const kit: KitVersion = {
  name: 'room',
  version: '1.0.0',
  description: 'A room of a 16:9 lesson from the channel theme: its picture under a slow camera, a distant storm in its sky, windows and floor lit by a flash, glowing doors, a monitor playing a clip.',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    room: z.object({
      image: AssetUrl,
      sky: z.array(z.object({poly: z.array(PointSchema).min(3), period: z.number().positive().optional(), seed: z.number().int().min(0).optional(), scale: z.number().positive().optional()}).strict()).optional(),
      windows: z.array(z.array(PointSchema).min(3)).optional(),
      doors: z.array(BoxSchema).optional(),
      monitor: z.object({box: BoxSchema, video: AssetUrl}).strict().optional(),
    }).strict(),
    /** The distant storm: on unless false; off over each quiet window (seconds from the item's start), ramping over 0.6 s. */
    lightning: z.boolean().optional(),
    quiet: z.array(z.tuple([z.number(), z.number()])).optional(),
    flash: z.object({strikes: z.array(z.number())}).strict().optional(),
    /** The slow drift of the camera, on unless false; a push towards a point (the door one walks through). */
    drift: z.boolean().optional(),
    push: z.object({at: z.number(), dur: z.number().positive(), scale: z.number().min(1).max(4), origin: PointSchema}).strict().optional(),
    dark: z.number().min(0).max(1).optional(),
    /** The scene's camera, shared with the panel and the characters (a close-up). */
    camera: CameraSchema.optional(),
  }).strict(),
  component: Room,
  examples: [
    {id: 'storm', props: {look: DEMO_LOOK, room: SAMPLE_ROOM}, samples: {room: 'room-16x9.png'}, durationInFrames: 150, frame: 100},
    {id: 'flash', props: {look: DEMO_LOOK, room: SAMPLE_ROOM, flash: {strikes: [1]}}, samples: {room: 'room-16x9.png'}, durationInFrames: 60, frame: 32},
    {id: 'monitor', props: {look: DEMO_LOOK, room: {image: {$asset: 'room'}, monitor: {box: {x: 1316, y: 541, w: 154, h: 111}, video: {$asset: 'clip'}}}, quiet: [[-1, 0.5]]}, samples: {room: 'room-16x9.png', clip: 'clip.mp4'}, durationInFrames: 60, frame: 40},
    {id: 'push', props: {look: DEMO_LOOK, room: SAMPLE_ROOM, push: {at: 0, dur: 1.5, scale: 1.8, origin: [1350, 510]}, lightning: false}, samples: {room: 'room-16x9.png'}, durationInFrames: 60, frame: 40},
  ],
};
````

Create `packages/remotion-composer/src/kits/panel/1.0.0.tsx`:

````tsx
// panel@1.0.0 — released: never edit this file; add panel/<next>.tsx instead.
// The glass panel of a 16:9 lesson and what it shows, phase by phase: one
// picture framed on its focus with a slow push, two pictures side by side
// with their labels, or a clip. Between phases the glass turns on itself and
// the content changes halfway through the turn; it materialises with a scan
// line, its edge lights up with a flash, and a discreet credit sits in its
// corner when the picture is a reconstruction (from CreativeStudio's
// poesie-museo-long Glass, Cover, LoopClip, AiTag). Channel-neutral.
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {clamp, ease} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema, CameraSchema, cameraStyle, type Camera} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, LoopClip, strikeAt, type Box} from '../lib/lesson-stage/1.0.0.js';

interface Framed {src: string; focus?: [number, number]; zoom?: number; zoomTo?: number; label?: string}
type Content =
  | ({kind: 'picture'} & Framed)
  | {kind: 'pair'; left: Framed; right: Framed; sign?: string}
  | {kind: 'clip'; src: string; live?: [number, number]};
interface Phase {at: number; content: Content; tag?: string}

/** A turn of the glass takes this long; the content changes halfway. */
const SPIN = 1.0;

const Panel: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const {fps, durationInFrames} = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const end = durationInFrames / fps;
  const box = (props.box as Box | undefined) ?? {x: 440, y: 150, w: 1060, h: 596};
  const phases = [...(props.phases as Phase[])].sort((a, b) => a.at - b.at);
  const spins = (props.spin ?? true) ? phases.slice(1).map((p) => p.at) : [];
  // the phase on the glass: a new one shows from halfway through its turn
  const current = phases.reduce((cur, p, i) => (i === 0 || t >= p.at + (spins.length ? SPIN / 2 : 0) ? p : cur), phases[0]!);
  const spin = spins.reduce((s, a) => s + 360 * ease((t - a) / SPIN), 0);
  const on = props.appear ? clamp((t - (props.appear as {at: number}).at) / (props.appear as {dur: number}).dur) : 1;
  const fl = strikeAt(t, ((props.flash as {strikes: number[]} | undefined) ?? {strikes: []}).strikes);
  const inner = {x: 0, y: 0, w: box.w - 20, h: box.h - 20};
  const since = t - current.at;
  const life = Math.max(0.5, (phases[phases.indexOf(current) + 1]?.at ?? end) - current.at);

  const framed = (f: Framed, b: Box) => {
    const z0 = f.zoom ?? 1.04;
    const z1 = f.zoomTo ?? z0 + 0.06;
    const [cx, cy] = f.focus ?? [0.5, 0.5];
    return <Cover src={f.src} box={b} cx={cx} cy={cy} zoom={z0 + (z1 - z0) * ease(since / life)} />;
  };
  const chip = (text: string, x: number, y: number) => (
    <div style={{position: 'absolute', left: x, top: y, transform: 'translateY(-100%)', padding: '8px 16px 9px', borderRadius: 10, background: alpha(c.plate, 1), border: `1px solid ${c.plateLine}`, boxShadow: `inset 0 2px 0 ${c.accent}`, fontFamily: fonts.sans, fontWeight: 600, fontSize: 26, letterSpacing: 2, color: c.text, whiteSpace: 'nowrap'}}>{text}</div>
  );
  const content = current.content;
  let body: React.ReactNode;
  if (content.kind === 'picture') {
    body = <>{framed(content, inner)}{content.label ? chip(content.label, 22, inner.h - 22) : null}</>;
  } else if (content.kind === 'pair') {
    const half = (inner.w - 8) / 2;
    body = (
      <>
        {framed(content.left, {x: 0, y: 0, w: half, h: inner.h})}
        {framed(content.right, {x: half + 8, y: 0, w: half, h: inner.h})}
        {content.left.label ? chip(content.left.label, 22, inner.h - 22) : null}
        {content.right.label ? chip(content.right.label, half + 30, inner.h - 22) : null}
        {content.sign ? (
          <div style={{position: 'absolute', left: inner.w / 2 - 50, top: inner.h / 2 - 50, width: 100, height: 100, borderRadius: 50, background: alpha(c.plate, 1), border: `2px solid ${c.plateLine}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.sans, fontWeight: 600, fontSize: 40, color: c.text}}>{content.sign}</div>
        ) : null}
      </>
    );
  } else {
    const [a, b] = content.live ?? [-1, end + 1];
    const live = clamp((t - a) / 0.5) * clamp((b - t) / 0.5);
    body = <LoopClip src={content.src} box={inner} live={live} />;
  }
  // texts hide while the glass turns
  const turning = spins.some((a) => t >= a && t < a + SPIN);
  const camera = props.camera as Camera | undefined;
  return (
    <AbsoluteFill style={camera ? cameraStyle(t, camera) : undefined}>
      <Glass look={look} box={box} t={t} on={on} spin={spin} flash={fl}>
        <div style={{position: 'absolute', inset: 0}}>{body}</div>
        {current.tag && !turning ? (
          <div style={{position: 'absolute', right: 14, bottom: 12, opacity: 0.72, fontFamily: fonts.sans, fontWeight: 600, fontSize: 18, letterSpacing: 3, color: '#fff', textShadow: look.measures.textShadow}}>{current.tag}</div>
        ) : null}
      </Glass>
    </AbsoluteFill>
  );
};

const Framed = z.object({
  src: AssetUrl,
  /** The point of the picture (0–1) the frame keeps in view. */
  focus: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
  /** Zoom at the phase's start and end (a slow push). */
  zoom: z.number().min(1).max(3).optional(),
  zoomTo: z.number().min(1).max(3).optional(),
  label: z.string().min(1).max(30).optional(),
}).strict();
const Content = z.discriminatedUnion('kind', [
  Framed.extend({kind: z.literal('picture')}).strict(),
  z.object({kind: z.literal('pair'), left: Framed, right: Framed, sign: z.string().min(1).max(3).optional()}).strict(),
  z.object({kind: z.literal('clip'), src: AssetUrl, live: z.tuple([z.number(), z.number()]).optional()}).strict(),
]);

const P = (extra: Record<string, unknown>) => ({look: DEMO_LOOK, ...extra});
const SAMPLES = {a: 'picture-a.png', b: 'picture-b.png'};

export const kit: KitVersion = {
  name: 'panel',
  version: '1.0.0',
  description: 'The glass panel of a 16:9 lesson and what it shows phase by phase — a picture framed on its focus, two pictures with labels, or a clip — turning between phases, in the channel theme\'s look.',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    /** What the glass shows from each instant (seconds from the item's start); the first from the start. */
    phases: z.array(z.object({at: z.number().min(0), content: Content, tag: z.string().min(1).max(30).optional()}).strict()).min(1),
    /** The glass turns at each phase change unless false. */
    spin: z.boolean().optional(),
    /** It materialises over [at, at + dur] instead of being there. */
    appear: z.object({at: z.number().min(0), dur: z.number().positive()}).strict().optional(),
    flash: z.object({strikes: z.array(z.number())}).strict().optional(),
    camera: CameraSchema.optional(),
  }).strict(),
  component: Panel,
  examples: [
    {id: 'picture', props: P({phases: [{at: 0, content: {kind: 'picture', src: {$asset: 'a'}, focus: [0.5, 0.6]}, tag: 'AI RECONSTRUCTION'}]}), samples: SAMPLES, durationInFrames: 90, frame: 60},
    {id: 'pair', props: P({phases: [{at: 0, content: {kind: 'pair', left: {src: {$asset: 'a'}, label: 'THE WHITE HOUSE'}, right: {src: {$asset: 'b'}, label: 'THE LOST NEST'}, sign: '=?'}}]}), samples: SAMPLES, durationInFrames: 90, frame: 60},
    {id: 'turning', props: P({phases: [{at: 0, content: {kind: 'picture', src: {$asset: 'a'}}}, {at: 1, content: {kind: 'picture', src: {$asset: 'b'}}}]}), samples: SAMPLES, durationInFrames: 90, frame: 40},
    {id: 'appearing', props: P({appear: {at: 0, dur: 1.2}, phases: [{at: 0, content: {kind: 'picture', src: {$asset: 'b'}}}]}), samples: SAMPLES, durationInFrames: 90, frame: 18},
    {id: 'clip', props: P({phases: [{at: 0, content: {kind: 'clip', src: {$asset: 'clip'}}}]}), samples: {clip: 'clip.mp4'}, durationInFrames: 60, frame: 30},
  ],
};
````

Create `packages/remotion-composer/src/kits/interprete/1.1.0.tsx`:

````tsx
// interprete@1.1.0 — released: never edit this file; add interprete/<next>.tsx instead.
// A character of a 16:9 lesson — the guide, the actor — from the channel
// theme: the SVG interprete with its poses, expressions, gaze, blinks and a
// mouth that follows the voice, standing on the floor with its shadow and
// reflection, lit by a flash, teleporting in and out (the hologram exit),
// changing costume on a flash (from CreativeStudio's poesie-museo-long guide
// and actor). 1.1.0: channel-neutral — the character and the look are props
// (ADR-0040) — and drawn for 16:9; 1.0.0 stays the short's.
import React, {useId} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, type Look} from '../lib/look/1.0.0.js';
import {clamp, ease, mix, pulse, ramp, win} from '../lib/stage-math/1.0.0.js';
import {CameraSchema, cameraStyle, type Camera} from '../lib/stage-props/1.0.0.js';
import {Teleport, strikeAt} from '../lib/lesson-stage/1.0.0.js';
import {Interprete, REST, type Expr, type Palette, type Pose} from '../lib/interprete/1.0.0.js';

const POSE_KEYS = Object.keys(REST) as (keyof Pose)[];
const EXPR_KEYS = ['li', 'lo', 'ri', 'ro', 'sm'] as const;
const sid = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, '');

/** Keyframes held until the next one, blended into it over `blend` seconds. */
function keyed<T extends Record<string, number>>(keys: readonly string[], frames: {at: number; value: T}[], t: number, blend: number): T {
  let out = frames[0]!.value;
  for (let i = 1; i < frames.length; i++) {
    if (t < frames[i]!.at) break;
    const prev = frames[i - 1]!.value;
    const next = frames[i]!.value;
    const k = ramp(t, frames[i]!.at, frames[i]!.at + blend);
    out = Object.fromEntries(keys.map((key) => [key, mix(prev[key]!, next[key]!, k)])) as T;
  }
  return out;
}

interface Character {variant: 'attore' | 'attrice'; outfit?: 'gilet' | 'giacca'; hairstyle?: 'coda' | 'corto'; accessories?: {earrings?: boolean; freckles?: boolean}; palette: Palette}
interface Mouth {energy: {rate: number; values: number[]}; speech: [number, number][]; from: number; to: number}

const Figure: KitVersion['component'] = ({props}) => {
  const id = sid(useId());
  const look = props.look as Look;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const fl = strikeAt(t, ((props.flash as {strikes: number[]} | undefined) ?? {strikes: []}).strikes);
  const x = props.x as number;
  const FY = (props.footY as number | undefined) ?? 950;
  const scale = (props.scale as number | undefined) ?? 0.78;
  const costume = props.costume as {at: number; character: Character} | undefined;
  const ch = costume && t >= costume.at ? costume.character : (props.character as Character);
  // the change happens on a flash of its own
  const change = costume ? strikeAt(t, [costume.at - 0.06]) : 0;
  const lit = Math.max(fl, change);
  const poses = [...(props.poses as {at: number; pose: Pose}[])].sort((a, b) => a.at - b.at).map((p) => ({at: p.at, value: p.pose as unknown as Record<string, number>}));
  const expressions = [...((props.expressions as {at: number; ex: Expr}[] | undefined) ?? [])].sort((a, b) => a.at - b.at).map((e) => ({at: e.at, value: e.ex as unknown as Record<string, number>}));
  const gazes = (props.gaze as {from: number; to: number; x: number; y: number; h: number}[] | undefined) ?? [];
  const blinks = (props.blinks as number[] | undefined) ?? [];
  const bow = props.bow as {from: number; to: number} | undefined;
  const m = props.mouth as Mouth | undefined;
  const tp = (props.teleport as {in?: {at: number; dur: number}; out?: {at: number; dur: number}} | undefined) ?? {};

  const pose = keyed(POSE_KEYS, poses, t, 0.6) as unknown as Pose;
  const ex = expressions.length ? (keyed(EXPR_KEYS, expressions, t, 0.5) as unknown as Expr) : undefined;
  const gaze = gazes.reduce((g, w) => {
    const k = win(t, w.from, w.to);
    return {x: g.x + w.x * k, y: g.y + w.y * k, h: g.h + w.h * k};
  }, {x: 0, y: 0, h: 0});
  const e = m && m.energy.values.length ? m.energy.values : [0];
  const ei = m ? Math.round(t * m.energy.rate) : 0;
  const speaking = !!m && t >= m.from && t < m.to && m.speech.some(([a, b]) => t >= a && t <= b);
  const speech = speaking ? [-2, -1, 0, 1, 2].reduce((v, k) => v + (e[Math.max(0, Math.min(ei + k, e.length - 1))] || 0), 0) / 5 : 0;
  const mouth = Math.min(9, Math.max(0, speech - 0.045) * 12);
  const blink = blinks.reduce((v, a) => v + Math.sin(Math.PI * clamp((t - a) / 0.2)) ** 2, 0);
  const tin = tp.in ? 1 - ease(clamp((t - tp.in.at) / tp.in.dur)) : 0;
  const tout = tp.out ? ease(clamp((t - tp.out.at) / tp.out.dur)) : 0;
  const holo = Math.max(tin, tout);
  const figure = (
    <Interprete t={t} variant={ch.variant} outfit={ch.outfit} hairstyle={ch.hairstyle} accessories={ch.accessories} palette={ch.palette} pose={pose} {...(ex ? {ex} : {})} gaze={gaze}
      mouth={mouth} blink={blink} thanks={bow ? pulse(t, bow.from, bow.to) : 0} live={1} x={x} y={FY - 641 * scale} scale={scale} />
  );
  const camera = props.camera as Camera | undefined;
  return (
    <AbsoluteFill style={camera ? cameraStyle(t, camera) : undefined}>
      <svg width="1920" height="1080" viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0}}>
        <defs>
          <filter id={`${id}lit`} x="-40%" y="-20%" width="180%" height="140%">
            <feComponentTransfer in="SourceGraphic" result="lit"><feFuncR type="linear" slope={1 + lit * 0.8} /><feFuncG type="linear" slope={1 + lit * 0.85} /><feFuncB type="linear" slope={1 + lit * 0.9} /></feComponentTransfer>
            <feGaussianBlur in="SourceAlpha" stdDeviation={6 + 6 * lit} result="halo" />
            <feFlood floodColor={look.colors.glow} floodOpacity={0.12 + 0.5 * lit} />
            <feComposite in2="halo" operator="in" result="glow" />
            <feMerge><feMergeNode in="glow" /><feMergeNode in="lit" /></feMerge>
          </filter>
          <linearGradient id={`${id}rf`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /></linearGradient>
          <mask id={`${id}m`}><rect x={x - 400} y={FY} width={800} height={400} fill={`url(#${id}rf)`} /></mask>
        </defs>
        {holo < 1 && (
          <g opacity={1 - holo}>
            <ellipse cx={x + 10} cy={FY} rx={150 * scale} ry={18} fill={look.colors.backdrop} opacity=".28" />
            <g mask={`url(#${id}m)`}><g transform={`translate(0 ${2 * FY}) scale(1 -1)`} opacity=".5">{figure}</g></g>
          </g>
        )}
        {holo <= 0 ? <g filter={`url(#${id}lit)`}>{figure}</g> : holo < 1 && <Teleport look={look} t={t} k={holo} x={x} h={641 * scale} w={300 * scale} floorY={FY}>{figure}</Teleport>}
      </svg>
    </AbsoluteFill>
  );
};

const PoseSchema = z.object(Object.fromEntries(POSE_KEYS.map((k) => [k, z.number()])) as Record<keyof Pose, z.ZodNumber>).strict();
const ExprSchema = z.object({li: z.number(), lo: z.number(), ri: z.number(), ro: z.number(), sm: z.number()}).strict();
const color = z.string().min(1);
const PaletteSchema = z.object({ink: color, shirt: color, shirtDark: color, vest: color, vestLight: color, button: color, inner: color, innerDark: color, skin: color, skinDark: color, trousers: color, shoe: color, sole: color, hair: color.optional(), hairHi: color.optional(), hairGloss: color.optional(), lip: color.optional(), freckles: color.optional()}).strict();
const CharacterSchema = z.object({
  variant: z.enum(['attore', 'attrice']),
  outfit: z.enum(['gilet', 'giacca']).optional(),
  hairstyle: z.enum(['coda', 'corto']).optional(),
  accessories: z.object({earrings: z.boolean().optional(), freckles: z.boolean().optional()}).strict().optional(),
  palette: PaletteSchema,
}).strict();
const Window = z.object({from: z.number(), to: z.number()}).strict();
const Moment = z.object({at: z.number(), dur: z.number().positive()}).strict();

const REST_POSE = {lu: 7, lf: 4, ru: 7, rf: 4, head: 0, lean: 0, grip: 0, step: 0, twist: 0, dip: 0};
const GUIDE = {
  variant: 'attrice', outfit: 'gilet',
  palette: {ink: '#2e2620', shirt: '#e9edf8', shirtDark: '#c9d0e6', vest: '#3a3f4f', vestLight: '#5a6175', button: '#4f9dff', inner: '#e9edf8', innerDark: '#c9d0e6', skin: '#f6b386', skinDark: '#cf7c4e', trousers: '#22252e', shoe: '#fafaf5', sole: '#dcd8cc', hair: '#3b2216', hairHi: '#6e4127', hairGloss: '#a06a43'},
};
const ACTOR = {variant: 'attore', outfit: 'gilet', palette: {...GUIDE.palette, vest: '#4f9dff', vestLight: '#8fc0ff'}};
const sample = (extra: Record<string, unknown> = {}) => ({
  look: DEMO_LOOK,
  character: GUIDE,
  x: 1700,
  poses: [{at: 0, pose: REST_POSE}, {at: 1.5, pose: {...REST_POSE, ru: 126, rf: 140, head: 4}}, {at: 4, pose: {...REST_POSE, lu: 56, lf: 72, ru: 56, rf: 72, head: -4, step: 1}}],
  expressions: [{at: 0, ex: {li: 0, lo: 0, ri: 0, ro: 0, sm: 0.25}}, {at: 2, ex: {li: 3, lo: 2, ri: 3, ro: 2, sm: 0.9}}],
  blinks: [1.1, 3.6],
  mouth: {energy: {rate: 30, values: Array.from({length: 180}, (_, i) => 0.05 + 0.25 * Math.abs(Math.sin(i / 2.3)))}, speech: [[0.5, 5.5]], from: 0.5, to: 5.5},
  ...extra,
});

export const kit: KitVersion = {
  name: 'interprete',
  version: '1.1.0',
  description: "A character of a 16:9 lesson from the channel theme — the guide, the actor: the SVG interprete's poses, expressions, gaze, blinks and a mouth that follows the voice, its shadow and reflection, lit by a flash, teleporting in and out, changing costume on a flash.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    character: CharacterSchema,
    x: z.number(),
    footY: z.number().positive().optional(),
    scale: z.number().positive().optional(),
    /** Full poses at their instants (seconds from the item's start), blended over 0.6 s. */
    poses: z.array(z.object({at: z.number(), pose: PoseSchema}).strict()).min(1),
    expressions: z.array(z.object({at: z.number(), ex: ExprSchema}).strict()).optional(),
    gaze: z.array(z.object({from: z.number(), to: z.number(), x: z.number(), y: z.number(), h: z.number()}).strict()).optional(),
    blinks: z.array(z.number()).optional(),
    bow: Window.optional(),
    mouth: z.object({energy: z.object({rate: z.number().positive(), values: z.array(z.number().min(0))}).strict(), speech: z.array(z.tuple([z.number(), z.number()])), from: z.number(), to: z.number()}).strict().optional(),
    /** In: it appears out of a column of light; out: it dissolves into one (the hologram exit). */
    teleport: z.object({in: Moment.optional(), out: Moment.optional()}).strict().optional(),
    /** From `at` it wears another costume, changed on a flash. */
    costume: z.object({at: z.number(), character: CharacterSchema}).strict().optional(),
    flash: z.object({strikes: z.array(z.number())}).strict().optional(),
    camera: CameraSchema.optional(),
  }).strict(),
  component: Figure,
  examples: [
    {id: 'pointing', props: sample(), durationInFrames: 180, frame: 75},
    {id: 'teleport-in', props: sample({teleport: {in: {at: 0, dur: 1.2}}}), durationInFrames: 180, frame: 18},
    {id: 'hologram-exit', props: sample({teleport: {out: {at: 4, dur: 1.2}}}), durationInFrames: 180, frame: 138},
    {id: 'costume', props: sample({character: ACTOR, x: 1720, scale: 0.82, costume: {at: 2, character: {...ACTOR, palette: {...ACTOR.palette, vest: '#ffd166', vestLight: '#ffe29a'}}}}), durationInFrames: 180, frame: 63},
    {id: 'closeup', props: sample({camera: {origin: [1700, 300], zoom: [{from: 0, to: 6, rampIn: 0.45, rampOut: 0.45, amount: 1}], shake: []}}), durationInFrames: 180, frame: 60},
  ],
};
````

The samples are generated placeholders: a pale hall with a dark window, and a 2 s test pattern.

```bash
git -C "$(git rev-parse --show-toplevel)" checkout 57f8a68 -- \
  packages/remotion-composer/kits/samples/room-16x9.png \
  packages/remotion-composer/kits/samples/clip.mp4
```

In `src/kits/index.ts`, import `room100` from `./room/1.0.0.js`, `panel100` from `./panel/1.0.0.js` and `interprete110` from `./interprete/1.1.0.js` after the warp import, and append them. `KIT_VERSIONS` must end up:

```ts
export const KIT_VERSIONS: readonly KitVersion[] = Object.freeze([
  still100, clip100, captions100, captions110,
  brandMark100, lowerThird100, titleChip100, versePlate100, museumHall100, interprete100, roomEffect100,
  brandMark200, blockTitle100, figureTitle100, verseBar100, cover100, chapterOpener100, warp100, room100, panel100, interprete110,
]);
```

- [ ] **Step 3: Lock, previews, README, tests**

Run: `npm run kits:lock`. The new entries must be exactly:

```json
  "interprete@1.1.0": "sha256:c9d878b236c4caff6e753583453d8ee16fe3d3bfde1f29c88a6f90d606e0cc27",
  "panel@1.0.0": "sha256:f6625547182936a296ddc1404ace72d84c40a7d465dcd5b337ab21c6907523c4",
  "room@1.0.0": "sha256:89cbcaca84cb2e3bca08d6649fb99d690a1849daaa957e3bfad1321854000183",
```

Then `git diff --exit-code 57f8a68 -- kits.lock.json src/kits`: every kit, module and lock entry now equals the prototype's.

```bash
git -C "$(git rev-parse --show-toplevel)" checkout 57f8a68 -- \
  packages/remotion-composer/previews/room@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/panel@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/interprete@1.1.0.youtube-1920x1080.png
```

````diff
diff --git a/packages/remotion-composer/README.md b/packages/remotion-composer/README.md
index 9cf3e87..540a5a8 100644
--- a/packages/remotion-composer/README.md
+++ b/packages/remotion-composer/README.md
@@ -49,6 +49,30 @@ They share frozen library modules in `src/kits/lib/` — `stage-math`,
 palette) — and load Anton, Fraunces and Inter from `@fontsource` 5.3.0
 before the first frame.
 
+The lesson stage's kits are channel-neutral (ADR-0040): each takes `look` —
+colour roles, font roles by family, shared measures (`lib/look/1.0.0.ts`) —
+from the channel theme the compiler passes through, and the puppet takes a
+theme `character`. They are drawn for `youtube-1920x1080`; their examples use
+a demo look with no channel in it. `room`, `panel` and `interprete` share an
+optional `camera` (a close-up moves them together).
+
+| Kit | Layer | What it draws |
+|---|---|---|
+| `room@1.0.0` | fill | A room: its picture under a slow drift (or a push towards a point), a distant storm in its sky polygons (quiet over given windows, as at a loop's edges), windows and floor lit by a flash, glowing doors, a monitor playing a clip |
+| `panel@1.0.0` | fill | The glass panel, phase by phase: a picture framed on its focus with a slow push, two pictures with labels, or a clip; it turns between phases, materialises, lights with a flash, carries an AI credit |
+| `interprete@1.1.0` | fill | A theme character: poses, expressions, gaze, blinks, mouth from the voice's energy, shadow and reflection, teleport in and out (the hologram exit), a costume change on a flash |
+| `verse-bar@1.0.0` | overlay | Verses heard or discussed on a full plate: unsaid words dimmed, said and strong words highlighted, a kicker |
+| `block-title@1.0.0` | overlay | Opens a block: kicker, title, growing rule, one line of information, bottom left |
+| `figure-title@1.0.0` | overlay | A rhetorical figure's or keyword's name on a dark plate, fitted to its width |
+| `chapter-opener@1.0.0` | fill | Between chapters: flash, veil, kicker, title closing in, rule, subtitle |
+| `cover@1.0.0` | fill | The cover a video opens and closes on: kicker, huge title with an icon, hook lines, a dark gradient |
+| `warp@1.0.0` | fill | The passage between rooms: a flash with radial streaks |
+| `brand-mark@2.0.0` | overlay | A channel's mark from its theme's brand |
+
+They share `lib/look`, `lib/fonts/1.1.0.ts` (every bundled face, loaded by
+the families a look names) and `lib/lesson-stage/1.0.0.tsx` (glass, cover
+framing, looping clip, storm, live bolt, teleport, warp).
+
 ## Adding a kit or a version
 
 A released version never changes: a delivered episode must re-render as it
@@ -92,13 +116,14 @@ import {renderTimeline, validateTimeline, listKits} from '@av/remotion-composer'
 const result = await renderTimeline({
   timeline,            // a studio.video/v1alpha2 EditTimeline
   assetRoot,           // the directory asset paths are relative to
+  sharedRoots,         // optional: folders outside it assets may come from (a channel's themes, ADR-0040)
   outputPath: 'out.mp4',
   cacheDir: '.cache/remotion', // optional; omit for the original full-render path
 });
 ```
 
 Failures throw `ComposerError` with a `code` (`invalid-timeline`,
-`unknown-kit`, `bad-props`, `missing-asset`, `hash-mismatch`,
+`unknown-kit`, `bad-props`, `wrong-profile`, `missing-asset`, `hash-mismatch`,
 `render-failed`, `loudness-failed`, `bad-sheet`, `sheet-failed`) and, for
 validation, `problems` with JSON paths.
 
````

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: PASS, 241 tests with 2 skipped (opt-in). The build is what `@studio/series` imports in Task 6.

- [ ] **Step 4: Commit**

```bash
git add packages/remotion-composer/src/kits/room packages/remotion-composer/src/kits/panel \
  packages/remotion-composer/src/kits/interprete/1.1.0.tsx packages/remotion-composer/src/kits/index.ts \
  packages/remotion-composer/kits/samples/room-16x9.png packages/remotion-composer/kits/samples/clip.mp4 \
  packages/remotion-composer/test/validate.test.ts packages/remotion-composer/kits.lock.json \
  packages/remotion-composer/previews/room@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/panel@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/interprete@1.1.0.youtube-1920x1080.png \
  packages/remotion-composer/README.md
git commit -m "The lesson stage as channel-neutral kits: room, panel, interprete 1.1.0 (avg-dcf.4.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The loader reads the pinned theme; renders take assets from the channel's themes

**Files:**
- Create: `studio/episode/tests/theme-load.test.ts`
- Modify:
  - `studio/series/src/types.ts`;
  - `studio/episode/src/series-compile.ts`, `studio/episode/src/episode-render.ts`, `studio/episode/src/layout-sheet.ts`;
  - `studio/episode/README.md`.

**Interfaces:**
- Consumes: Task 1's `validateChannelTheme`, `THEME_FILE`, `themeReleasePath`, `ChannelTheme`; Task 2's `sharedRoots`.
- Produces:
  - `CompileInput.theme?: ChannelTheme`;
  - `CompileAsset.kind` adds `"video"`;
  - the assets `theme-<room>` and `theme-<room>-monitor`;
  - `sharedRootsOf(episodeDir): string[]`;
  - the problems `missing-theme`, `theme-mismatch`, `bad-theme`, plus the contract's own codes located in `theme.json`.

- [ ] **Step 1: Write the failing tests**

Create `studio/episode/tests/theme-load.test.ts`:

````ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadEpisode, sharedRootsOf } from "../src/series-compile.js";
import { sha256, specEpisode } from "../src/testing.js";

/**
 * The channel theme a series template release pins (avg-dcf.4.1, ADR-0040):
 * read from library/<channel>/themes/<id>/<version>/, checked against the
 * pin's hash and the contract, its room images offered as theme-<room>.
 */

const require = createRequire(import.meta.url);
const SAMPLE = dirname(require.resolve("@studio/contracts/fixtures/channel-theme/sample/themes/sample/1.0.0/theme.json"));
const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const channel = () => join(root, REF.channel);
const themeDir = () => join(channel(), "themes", "sample", "1.0.0");
const release = () => join(channel(), "series", REF.series, "templates", "poetry-short", "1.0.0");

/** Pin `hash` (default: the theme's own) in the release, and the release in the spec. */
function pinTheme(hash?: string) {
  const manifestPath = join(release(), "series-template.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  manifest.theme = { id: "sample", version: "1.0.0", hash: hash ?? sha256(readFileSync(join(themeDir(), "theme.json"))) };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, text);
  const specPath = join(dir(), "episode-spec.json");
  const spec = JSON.parse(readFileSync(specPath, "utf-8"));
  spec.template.hash = sha256(text);
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
}
const problemsOf = () => {
  const loaded = loadEpisode(dir(), { episodeRef: REF });
  expect(loaded.ok).toBe(false);
  return loaded.ok ? [] : loaded.problems.map((p) => [p.code, p.path]);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "theme-load-"));
  specEpisode(dir(), REF);
  cpSync(SAMPLE, themeDir(), { recursive: true });
  mkdirSync(join(themeDir(), "rooms"), { recursive: true });
  writeFileSync(join(themeDir(), "rooms", "hall.png"), "a hall");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("loadEpisode with a pinned theme", () => {
  it("gives the compiler the theme, its room images as assets, everything hashed", () => {
    pinTheme();
    const loaded = loadEpisode(dir(), { episodeRef: REF });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    expect(loaded.input.theme).toEqual(JSON.parse(readFileSync(join(themeDir(), "theme.json"), "utf-8")));
    const image = "../../../../themes/sample/1.0.0/rooms/hall.png";
    expect(loaded.input.assets["theme-hall"]).toEqual({ path: image, hash: sha256("a hall"), kind: "image" });
    expect(loaded.input.inputs[image]).toBe(sha256("a hall"));
    expect(loaded.input.inputs["../../../../themes/sample/1.0.0/theme.json"]).toBe(sha256(readFileSync(join(themeDir(), "theme.json"))));
  });

  it("offers a room's monitor clip as theme-<room>-monitor", () => {
    const theme = JSON.parse(readFileSync(join(themeDir(), "theme.json"), "utf-8"));
    theme.rooms.hall.monitor = { box: { x: 1316, y: 541, w: 154, h: 111 }, video: "rooms/monitor.mp4" };
    writeFileSync(join(themeDir(), "theme.json"), JSON.stringify(theme));
    writeFileSync(join(themeDir(), "rooms", "monitor.mp4"), "a clip");
    pinTheme();
    const loaded = loadEpisode(dir(), { episodeRef: REF });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    expect(loaded.input.assets["theme-hall-monitor"]).toEqual({ path: "../../../../themes/sample/1.0.0/rooms/monitor.mp4", hash: sha256("a clip"), kind: "video" });
  });

  it("leaves an episode whose release pins no theme as it was", () => {
    const loaded = loadEpisode(dir(), { episodeRef: REF });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    expect(loaded.input.theme).toBeUndefined();
    expect(Object.keys(loaded.input.assets).some((id) => id.startsWith("theme-"))).toBe(false);
  });

  it("missing-theme: the pinned release is not in the channel", () => {
    pinTheme(`sha256:${"a".repeat(64)}`);
    rmSync(themeDir(), { recursive: true });
    expect(problemsOf()).toEqual([["missing-theme", "../../templates/poetry-short/1.0.0/series-template.json#$.theme"]]);
  });

  it("theme-mismatch: theme.json changed after the release pinned it", () => {
    pinTheme();
    const theme = JSON.parse(readFileSync(join(themeDir(), "theme.json"), "utf-8"));
    theme.look.colors.accent = "#ff0000";
    writeFileSync(join(themeDir(), "theme.json"), JSON.stringify(theme));
    expect(problemsOf()).toEqual([["theme-mismatch", "../../../../themes/sample/1.0.0/theme.json"]]);
  });

  it("refuses a theme the contract refuses, at its path inside theme.json", () => {
    const theme = JSON.parse(readFileSync(join(themeDir(), "theme.json"), "utf-8"));
    theme.look.fonts.serif = "Garamond";
    writeFileSync(join(themeDir(), "theme.json"), JSON.stringify(theme));
    pinTheme();
    expect(problemsOf()).toEqual([["unknown-font", "../../../../themes/sample/1.0.0/theme.json#$.look.fonts.serif"]]);
  });

  it("path-escape: a room image that is a link out of the channel's themes", () => {
    const outside = join(root, "elsewhere.png");
    writeFileSync(outside, "not this theme's");
    unlinkSync(join(themeDir(), "rooms", "hall.png"));
    symlinkSync(outside, join(themeDir(), "rooms", "hall.png"));
    pinTheme();
    expect(problemsOf()).toEqual([["path-escape", "../../../../themes/sample/1.0.0/rooms/hall.png"]]);
  });

  it("missing-asset: a room image the theme names is not there", () => {
    unlinkSync(join(themeDir(), "rooms", "hall.png"));
    pinTheme();
    expect(problemsOf()).toEqual([["missing-asset", "../../../../themes/sample/1.0.0/rooms/hall.png"]]);
  });
});

describe("sharedRootsOf", () => {
  it("lets a render take assets from the channel's themes, and from nowhere else", () => {
    expect(sharedRootsOf(dir())).toEqual([join(channel(), "themes")]);
    rmSync(join(channel(), "themes"), { recursive: true });
    expect(sharedRootsOf(dir())).toEqual([]);
  });
});

````

Run: `cd studio/episode && npx vitest run tests/theme-load.test.ts`
Expected: FAIL. `sharedRootsOf` is not exported, and no theme is read.

- [ ] **Step 2: Implement**

````diff
diff --git a/studio/episode/src/episode-render.ts b/studio/episode/src/episode-render.ts
index 85cb0c1..9087352 100644
--- a/studio/episode/src/episode-render.ts
+++ b/studio/episode/src/episode-render.ts
@@ -23,7 +23,7 @@ import {
   type BuildProblem,
   type EditTimelineDoc,
 } from "./edit-timeline-builder.js";
-import { checkEpisode, compileEpisode, isSpecDriven, type SeriesFinding } from "./series-compile.js";
+import { checkEpisode, compileEpisode, isSpecDriven, sharedRootsOf, type SeriesFinding } from "./series-compile.js";
 
 const LABEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
 
@@ -355,6 +355,7 @@ export async function renderEpisode(episodeDir: string, options: EpisodeRenderOp
     result = await renderTimeline({
       timeline: current.timeline,
       assetRoot: episodeDir,
+      sharedRoots: sharedRootsOf(episodeDir),
       cacheDir: join(episodeDir, ".cache", "remotion"),
       outputPath: partialPath,
       ...(options.onProgress ? { onProgress: options.onProgress } : {}),
diff --git a/studio/episode/src/layout-sheet.ts b/studio/episode/src/layout-sheet.ts
index 3e65444..0b82b57 100644
--- a/studio/episode/src/layout-sheet.ts
+++ b/studio/episode/src/layout-sheet.ts
@@ -17,7 +17,7 @@ import { drawingCodeHash, renderLayoutSheet, timelineKits, type LockedKit } from
 import { canonicalJson } from "@studio/contracts/src/receipt.mjs";
 import { decideEditTimeline, SeriesRulesError, type TimelineDecision } from "./episode-render.js";
 import { EDIT_TIMELINE_PATH, type BuildOptions } from "./edit-timeline-builder.js";
-import { isSpecDriven, loadEpisode } from "./series-compile.js";
+import { isSpecDriven, loadEpisode, sharedRootsOf } from "./series-compile.js";
 import { sheetInstants, type SheetRules } from "./sheet-instants.js";
 
 export const LAYOUT_SHEET_DIR = "artifacts/layout-sheet";
@@ -113,7 +113,7 @@ export async function makeLayoutSheet(episodeDir: string, options: BuildOptions)
   const final = join(episodeDir, LAYOUT_SHEET_DIR);
   let report: LayoutSheetReport;
   try {
-    const result = await renderLayoutSheet({ timeline: decision.timeline, assetRoot: episodeDir, picks, outDir: temp, scale: SHEET_SCALE });
+    const result = await renderLayoutSheet({ timeline: decision.timeline, assetRoot: episodeDir, sharedRoots: sharedRootsOf(episodeDir), picks, outDir: temp, scale: SHEET_SCALE });
     report = {
       createdAt: new Date().toISOString(),
       timeline: { path: EDIT_TIMELINE_PATH, hash: inputs.timeline },
diff --git a/studio/episode/src/series-compile.ts b/studio/episode/src/series-compile.ts
index 892ecec..9beff05 100644
--- a/studio/episode/src/series-compile.ts
+++ b/studio/episode/src/series-compile.ts
@@ -17,6 +17,7 @@ import { EPISODE_SPEC_PATH, SERIES_TEMPLATE_MANIFEST, seriesTemplatePath } from
 import { validateNarrationTakes } from "@studio/contracts/src/narration-takes.mjs";
 import { SERIES_TEMPLATE_FILES, validateEpisodeSpec, validateTemplateBundle } from "@studio/contracts/src/series-templates.mjs";
 import { validateWordTiming } from "@studio/contracts/src/word-timing.mjs";
+import { THEME_FILE, themeReleasePath, validateChannelTheme, type ChannelTheme } from "@studio/contracts/src/channel-themes.mjs";
 
 export const NARRATION_TAKES_PATH = "artifacts/narration/takes.json";
 /** What the loader offers from assets/: every file in each folder, as <prefix>-<name>. */
@@ -98,6 +99,15 @@ export function loadEpisode(
   }
 }
 
+/**
+ * Folders outside the episode a render may take assets from: the channel's
+ * theme releases (library/<channel>/themes), when there are any (ADR-0040).
+ */
+export function sharedRootsOf(episodeDir: string): string[] {
+  const themes = join(dirname(dirname(dirname(dirname(resolve(episodeDir))))), "themes");
+  return existsSync(themes) ? [themes] : [];
+}
+
 /** Compile the episode's spec with its release's compiler. Writes nothing. */
 export function compileEpisode(
   episodeDir: string,
@@ -151,7 +161,8 @@ function load(episodeDir: string, episodeRef: { channel: string; series: string;
     const real = realpathSync(file);
     const root = realpathSync(within);
     if (real !== root && !real.startsWith(root + sep)) {
-      stop("path-escape", key, `${key} leads outside ${within === episodeDir ? "the episode" : "the series"} (${real})`);
+      const where = within === episodeDir ? "the episode" : within === seriesDir ? "the series" : "the channel's themes";
+      stop("path-escape", key, `${key} leads outside ${where} (${real})`);
     }
     if (!statSync(real).isFile()) stop("not-a-file", key, `${key} is not a file`);
     const bytes = readFileSync(real);
@@ -261,7 +272,41 @@ function load(episodeDir: string, episodeRef: { channel: string; series: string;
     }
   }
 
-  return { ok: true, input: { spec, template, narration, timings, assets, inputs }, releaseKey };
+  // ── The channel theme the release pins (ADR-0040) ─────────────────────────
+  // Read from library/<channel>/themes/<id>/<version>/, held to the pin's hash
+  // and to the contract; its room images (and monitor clips) are offered as
+  // theme-<room> (theme-<room>-monitor), with paths relative to the episode.
+  let theme: ChannelTheme | undefined;
+  if (template.theme) {
+    const themesDir = join(dirname(dirname(seriesDir)), "themes");
+    const themeDir = join(dirname(themesDir), themeReleasePath(template.theme.id, template.theme.version));
+    const themeKey = relative(episodeDir, themeDir).split(sep).join("/");
+    if (!existsSync(join(themeDir, THEME_FILE))) {
+      stop("missing-theme", `${releaseKey}/${SERIES_TEMPLATE_MANIFEST}#$.theme`, `the pinned theme ${template.theme.id}@${template.theme.version} is not in this channel (${themeKey})`);
+    }
+    const themeBytes = read(join(themeDir, THEME_FILE), themesDir, () => stop("missing-theme", `${themeKey}/${THEME_FILE}`, `${themeKey}/${THEME_FILE} is missing`));
+    if (sha256(themeBytes) !== template.theme.hash) {
+      stop("theme-mismatch", `${themeKey}/${THEME_FILE}`, `${themeKey}/${THEME_FILE} is not the theme the release pinned (${template.theme.hash}): pin the theme again in a new release`);
+    }
+    try {
+      theme = JSON.parse(themeBytes.toString("utf-8"));
+    } catch (error) {
+      return stop("bad-theme", `${themeKey}/${THEME_FILE}`, `${themeKey}/${THEME_FILE} is not JSON: ${(error as Error).message}`);
+    }
+    const themeProblems = validateChannelTheme(theme);
+    if (themeProblems.length > 0) throw new Stop(at(`${themeKey}/${THEME_FILE}`, themeProblems));
+    const offer = (id: string, file: string, kind: CompileAsset["kind"]) => {
+      const path = `${themeKey}/${file}`;
+      read(join(themeDir, file), themesDir, () => stop("missing-asset", path, `${path} is missing`));
+      assets[id] = { path, hash: inputs[path]!, kind };
+    };
+    for (const [name, room] of Object.entries(theme!.rooms).sort(([a], [b]) => (a < b ? -1 : 1))) {
+      offer(`theme-${name}`, room.image, "image");
+      if (room.monitor) offer(`theme-${name}-monitor`, room.monitor.video, "video");
+    }
+  }
+
+  return { ok: true, input: { spec, template, narration, timings, assets, inputs, ...(theme ? { theme } : {}) }, releaseKey };
 }
 
 const IN_TIMELINE = /^\$\.(tracks|profile|durationInFrames|resolution|assets|sections)\b/;
diff --git a/studio/series/src/types.ts b/studio/series/src/types.ts
index ea55c74..ac26e58 100644
--- a/studio/series/src/types.ts
+++ b/studio/series/src/types.ts
@@ -11,14 +11,15 @@ import type { EpisodeSpec, SeriesTemplate } from "@studio/contracts/src/series-t
 import type { NarrationTakes } from "@studio/contracts/bindings/ts/narration-takes.ts";
 import type { WordTiming } from "@studio/contracts/bindings/ts/word-timing.ts";
 import type { EditTimeline } from "@studio/contracts/bindings/ts/v1alpha2/edit-timeline.ts";
+import type { ChannelTheme } from "@studio/contracts/src/channel-themes.mjs";
 
-export type { EditTimeline, EpisodeSpec, NarrationTakes, SeriesTemplate, WordTiming };
+export type { ChannelTheme, EditTimeline, EpisodeSpec, NarrationTakes, SeriesTemplate, WordTiming };
 
 /** A file the timeline refers to, relative to the episode. */
 export interface CompileAsset {
   path: string;
   hash: string;
-  kind: "image" | "audio";
+  kind: "image" | "audio" | "video";
 }
 
 export interface CompileInput {
@@ -37,6 +38,11 @@ export interface CompileInput {
   assets: Record<string, CompileAsset>;
   /** Relative path → "sha256:…" of every file read, recorded as provenance. */
   inputs: Record<string, string>;
+  /**
+   * The channel theme the release pins (ADR-0040), already checked against
+   * the pin and the contract; its rooms' images are assets theme-<room>.
+   */
+  theme?: ChannelTheme;
 }
 
 /** Something in the input that stops compilation, located by a JSON path. */
````

Run:

```bash
npm run build --workspace @av/remotion-composer && npm run build --workspace @studio/series
cd studio/episode && npx tsc --noEmit && npx vitest run
```

Expected: PASS, 197 tests (3 skipped).

- [ ] **Step 3: README**

````diff
diff --git a/studio/episode/README.md b/studio/episode/README.md
index 9a52e48..6c298b5 100644
--- a/studio/episode/README.md
+++ b/studio/episode/README.md
@@ -16,7 +16,7 @@ adapters both call this package, so a tool and a stage never disagree.
 | `narration-manifest.ts` | The canonical `artifacts/narration/narration-manifest.json`: build, measure, validate, write |
 | `scene-images.ts` | Scene images in reading order and their lengths (legacy episodes) |
 | `edit-timeline-builder.ts` | `buildEditTimeline`: the timeline of an episode without a spec |
-| `series-compile.ts` | `loadEpisode`, `compileEpisode`, `checkEpisode`: a spec-driven episode, read, checked, compiled, held to its series' rules; offers `assets/images/*` as `image-<name>` and `assets/sounds/*` as `sound-<name>` |
+| `series-compile.ts` | `loadEpisode`, `compileEpisode`, `checkEpisode`: a spec-driven episode, read, checked, compiled, held to its series' rules; offers `assets/images/*` as `image-<name>` and `assets/sounds/*` as `sound-<name>`; reads the channel theme the release pins (ADR-0040) and offers its rooms as `theme-<room>`; `sharedRootsOf`: the channel's `themes/`, which renders and layout sheets may take assets from |
 | `episode-render.ts` | `writeEditTimeline`, `decideEditTimeline`, `currentEditTimeline`, `renderEpisode` |
 | `spec-init.ts` | `initEpisodeSpec`: a draft spec pinned to an exact template release; never replaces one |
 | `references.ts` | `proposeReference`: freeze an episode as a proposed golden reference |
````

- [ ] **Step 4: Commit**

```bash
git add studio/series/src/types.ts studio/episode/src/series-compile.ts studio/episode/src/episode-render.ts \
  studio/episode/src/layout-sheet.ts studio/episode/tests/theme-load.test.ts studio/episode/README.md
git commit -m "Episodes read the channel theme their release pins; renders take assets from the channel's themes (ADR-0040, avg-dcf.4.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Dentro i versi theme, and the test that holds the contract and the kits together

**Files:**
- Create:
  - `studio/series/fixtures/themes/dentro-i-versi/1.0.0/theme.json`;
  - `studio/series/fixtures/themes/dentro-i-versi/1.0.0/rooms/{atrio.png, sala.png, monitor.mp4}`;
  - `studio/series/test/theme-alignment.test.ts`.
- Modify: `studio/series/README.md`

- [ ] **Step 1: The theme**

Its values come from CreativeStudio's long-format runtime v10:
- the palette `K`;
- the guide's palette and the second recital's costume;
- the poses;
- the atrium's and the hall's geometry.

The images are placeholders until `avg-dcf.5`.

Create `studio/series/fixtures/themes/dentro-i-versi/1.0.0/theme.json`:

````json
{
  "apiVersion": "studio.video/v1alpha1",
  "kind": "ChannelTheme",
  "id": "dentro-i-versi",
  "version": "1.0.0",
  "look": {
    "colors": {
      "ink": "#0c1230",
      "text": "#f6f8ff",
      "textDim": "rgba(244,247,255,.92)",
      "accent": "#5fdcff",
      "highlight": "#ffbf5e",
      "glow": "#bfefff",
      "lightning": "#c3b8ff",
      "plate": "rgba(8,12,36,.86)",
      "plateLine": "rgba(255,255,255,.45)",
      "shadow": "rgba(4,6,20,.4)",
      "backdrop": "#0b1030",
      "signal": "#ff5d6c"
    },
    "fonts": {
      "display": "Anton",
      "serif": "Fraunces",
      "sans": "Inter"
    },
    "measures": {
      "plateRadius": 14,
      "textShadow": "0 2px 3px rgba(6,10,32,.85), 0 0 14px rgba(6,10,32,.55)",
      "minTextPx": 26
    }
  },
  "layout": {
    "safe": {
      "top": 120,
      "bottom": 960
    },
    "floorY": 950,
    "panel": {
      "x": 440,
      "y": 150,
      "w": 1060,
      "h": 596
    }
  },
  "characters": {
    "guida": {
      "variant": "attrice",
      "outfit": "gilet",
      "palette": {
        "ink": "#2e2620",
        "shirt": "#e9edf8",
        "shirtDark": "#c9d0e6",
        "vest": "#2a3266",
        "vestLight": "#4a56a0",
        "button": "#5fdcff",
        "inner": "#e9edf8",
        "innerDark": "#c9d0e6",
        "skin": "#f6b386",
        "skinDark": "#cf7c4e",
        "trousers": "#1a1f44",
        "shoe": "#fafaf5",
        "sole": "#dcd8cc",
        "hair": "#3b2216",
        "hairHi": "#6e4127",
        "hairGloss": "#a06a43"
      },
      "poses": {
        "riposo": {},
        "invoca": {
          "lu": 20,
          "lf": 54,
          "ru": 20,
          "rf": 54,
          "head": -2,
          "step": 1
        },
        "mani-al-cuore": {
          "lu": 38,
          "lf": 92,
          "ru": 22,
          "rf": 60,
          "head": -4,
          "lean": 2
        },
        "indica": {
          "ru": 126,
          "rf": 140,
          "head": 4
        },
        "apre": {
          "lu": 62,
          "lf": 72,
          "ru": 62,
          "rf": 72,
          "head": -4,
          "step": 1
        },
        "chiede": {
          "lu": 56,
          "lf": 72,
          "ru": 56,
          "rf": 72,
          "head": -4,
          "step": 1
        },
        "dialoga": {
          "lu": 34,
          "lf": 88,
          "ru": 34,
          "rf": 88,
          "head": -5,
          "dip": 1
        },
        "spalle": {
          "lu": 24,
          "lf": 110,
          "ru": 24,
          "rf": 110,
          "head": -3,
          "twist": 1
        },
        "braccio-alto": {
          "lu": 66,
          "lf": 78,
          "ru": 20,
          "rf": 58,
          "head": -3,
          "step": 1
        },
        "punta": {
          "lu": 92,
          "lf": 100,
          "ru": 14,
          "rf": 24,
          "head": -6,
          "twist": 0.3
        },
        "conta": {
          "lu": 14,
          "lf": 20,
          "ru": 70,
          "rf": 150,
          "head": 3
        },
        "pensa": {
          "lu": 12,
          "lf": 18,
          "ru": 40,
          "rf": 160,
          "head": 5,
          "lean": 1
        }
      }
    },
    "attore-illuminato": {
      "variant": "attore",
      "outfit": "gilet",
      "palette": {
        "ink": "#2e2620",
        "shirt": "#eef2ff",
        "shirtDark": "#c3cbe8",
        "vest": "#eef2ff",
        "vestLight": "#ffffff",
        "button": "#5fdcff",
        "inner": "#ffbf5e",
        "innerDark": "#e09a2e",
        "skin": "#f6b386",
        "skinDark": "#cf7c4e",
        "trousers": "#283066",
        "shoe": "#fafaf5",
        "sole": "#dcd8cc"
      },
      "poses": {
        "riposo": {},
        "invoca": {
          "lu": 20,
          "lf": 54,
          "ru": 20,
          "rf": 54,
          "head": -2,
          "step": 1
        },
        "mani-al-cuore": {
          "lu": 38,
          "lf": 92,
          "ru": 22,
          "rf": 60,
          "head": -4,
          "lean": 2
        },
        "indica": {
          "ru": 126,
          "rf": 140,
          "head": 4
        },
        "apre": {
          "lu": 62,
          "lf": 72,
          "ru": 62,
          "rf": 72,
          "head": -4,
          "step": 1
        },
        "chiede": {
          "lu": 56,
          "lf": 72,
          "ru": 56,
          "rf": 72,
          "head": -4,
          "step": 1
        },
        "dialoga": {
          "lu": 34,
          "lf": 88,
          "ru": 34,
          "rf": 88,
          "head": -5,
          "dip": 1
        },
        "spalle": {
          "lu": 24,
          "lf": 110,
          "ru": 24,
          "rf": 110,
          "head": -3,
          "twist": 1
        },
        "braccio-alto": {
          "lu": 66,
          "lf": 78,
          "ru": 20,
          "rf": 58,
          "head": -3,
          "step": 1
        },
        "punta": {
          "lu": 92,
          "lf": 100,
          "ru": 14,
          "rf": 24,
          "head": -6,
          "twist": 0.3
        },
        "conta": {
          "lu": 14,
          "lf": 20,
          "ru": 70,
          "rf": 150,
          "head": 3
        },
        "pensa": {
          "lu": 12,
          "lf": 18,
          "ru": 40,
          "rf": 160,
          "head": 5,
          "lean": 1
        }
      }
    }
  },
  "rooms": {
    "atrio": {
      "image": "rooms/atrio.png",
      "sky": [
        {
          "poly": [
            [
              0,
              0
            ],
            [
              310,
              128
            ],
            [
              310,
              560
            ],
            [
              0,
              560
            ]
          ],
          "period": 6.5,
          "seed": 7
        },
        {
          "poly": [
            [
              618,
              505
            ],
            [
              832,
              505
            ],
            [
              832,
              622
            ],
            [
              618,
              622
            ]
          ],
          "period": 2.8,
          "seed": 11,
          "scale": 0.7
        }
      ],
      "windows": [
        [
          [
            0,
            0
          ],
          [
            330,
            0
          ],
          [
            330,
            820
          ],
          [
            0,
            820
          ]
        ]
      ],
      "doors": [
        {
          "x": 588,
          "y": 372,
          "w": 252,
          "h": 380
        }
      ],
      "monitor": {
        "box": {
          "x": 1316,
          "y": 541,
          "w": 154,
          "h": 111
        },
        "video": "rooms/monitor.mp4"
      }
    },
    "sala": {
      "image": "rooms/sala.png",
      "sky": [
        {
          "poly": [
            [
              0,
              0
            ],
            [
              660,
              262
            ],
            [
              660,
              540
            ],
            [
              0,
              492
            ]
          ],
          "period": 7.5,
          "seed": 3
        }
      ],
      "windows": [
        [
          [
            0,
            0
          ],
          [
            660,
            170
          ],
          [
            660,
            600
          ],
          [
            0,
            760
          ]
        ]
      ]
    }
  },
  "brand": {
    "text": "DENTRO I VERSI",
    "icon": "bolt"
  },
  "metadata": {
    "source": "CreativeStudio formats/poesie-museo-long runtime v10 (K, guidePalette, COSTUME2, POSES, ATRIO_*, SALA_SKY, WINDOW); room images are placeholders until avg-dcf.5"
  }
}
````

```bash
git -C "$(git rev-parse --show-toplevel)" checkout 57f8a68 -- \
  studio/series/fixtures/themes/dentro-i-versi/1.0.0/rooms/atrio.png \
  studio/series/fixtures/themes/dentro-i-versi/1.0.0/rooms/sala.png \
  studio/series/fixtures/themes/dentro-i-versi/1.0.0/rooms/monitor.mp4
```

- [ ] **Step 2: The alignment test**

Create `studio/series/test/theme-alignment.test.ts`:

````ts
// The channel theme contract (studio/contracts, ADR-0040) and the composer's
// look vocabulary (lib/look) describe the same shape on two sides of a
// boundary the composer may not cross (it never imports the contracts). This
// holds them together: a theme the contract accepts draws in every neutral
// kit — its look and each of its characters pass the kits' own props schemas.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { BUNDLED_FAMILIES, KIT_VERSIONS } from "@av/remotion-composer";
import { BUNDLED_FONTS, validateChannelTheme, type ChannelTheme } from "@studio/contracts/src/channel-themes.mjs";

const require = createRequire(import.meta.url);
const themes: [string, ChannelTheme][] = [
  ["dentro-i-versi", JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "themes", "dentro-i-versi", "1.0.0", "theme.json"), "utf-8"))],
  ["sample (contracts)", JSON.parse(readFileSync(require.resolve("@studio/contracts/fixtures/channel-theme/sample/themes/sample/1.0.0/theme.json"), "utf-8"))],
];
/** The neutral kits: those whose props take a look. */
const neutral = KIT_VERSIONS.filter((k) => k.examples.some((e) => "look" in e.props));

test("the contract allows exactly the font families the composer bundles", () => {
  assert.deepEqual(Object.keys(BUNDLED_FONTS).sort(), [...BUNDLED_FAMILIES].sort());
});

test("the neutral kits are the lesson stage's ten", () => {
  assert.deepEqual(neutral.map((k) => `${k.name}@${k.version}`).sort(), [
    "block-title@1.0.0", "brand-mark@2.0.0", "chapter-opener@1.0.0", "cover@1.0.0", "figure-title@1.0.0",
    "interprete@1.1.0", "panel@1.0.0", "room@1.0.0", "verse-bar@1.0.0", "warp@1.0.0",
  ]);
});

for (const [name, theme] of themes) {
  test(`${name}: the contract accepts it`, () => {
    assert.deepEqual(validateChannelTheme(theme), []);
  });

  test(`${name}: its look draws in every neutral kit`, () => {
    for (const kit of neutral) {
      for (const example of kit.examples) {
        const result = kit.props.safeParse({ ...example.props, look: theme.look });
        assert.ok(result.success, `${kit.name}@${kit.version} ${example.id}: ${!result.success && JSON.stringify(result.error.issues)}`);
      }
    }
  });

  test(`${name}: each of its characters is drawn by interprete@1.1.0`, () => {
    const kit = KIT_VERSIONS.find((k) => k.name === "interprete" && k.version === "1.1.0")!;
    for (const [who, { poses: _poses, ...character }] of Object.entries(theme.characters)) {
      const result = kit.props.safeParse({ ...kit.examples[0]!.props, look: theme.look, character });
      assert.ok(result.success, `${who}: ${!result.success && JSON.stringify(result.error.issues)}`);
    }
  });
}
````

Run: `cd studio/series && node --import tsx --test test/theme-alignment.test.ts`
Expected: PASS, 8 tests, against the composer's `dist/` built in Task 4.

To see that it bites, temporarily change `"accent"` in the Dentro i versi theme to `"cyan"`. Both the contract test and the "draws in every neutral kit" test must fail. Then restore it.

- [ ] **Step 3: README, the whole suite**

````diff
diff --git a/studio/series/README.md b/studio/series/README.md
index aec9569..4811720 100644
--- a/studio/series/README.md
+++ b/studio/series/README.md
@@ -25,7 +25,11 @@ Everything arrives already read, checked and hashed — in the studio, by
 `compileEpisode` in `@studio/episode` (`studio/episode/src/series-compile.ts`), which also decides
 the asset ids (`image-<name>` for `assets/images/<name>.<ext>`,
 `sound-<name>` for `assets/sounds/<name>.<ext>`, `narration-<take>` for each
-take's audio). A timeline the validators refuse
+take's audio, `theme-<room>` for the rooms of the channel theme the release
+pins). With a pinned theme, `input.theme` is the `ChannelTheme` (ADR-0040):
+a compiler passes its `look` and characters through to channel-neutral kits
+untouched; `test/theme-alignment.test.ts` holds the contract and the kits'
+props schemas together. A timeline the validators refuse
 comes back with problem codes prefixed `timeline:` — a compiler bug, not bad
 input.
 
````

Run: `npx tsc --noEmit && npm test`
Expected: PASS, 136 tests.

- [ ] **Step 4: Commit**

```bash
git add studio/series/fixtures/themes studio/series/test/theme-alignment.test.ts studio/series/README.md
git commit -m "The Dentro i versi theme as the first ChannelTheme release; the contract and the neutral kits held together (avg-dcf.4.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Whole-branch checks

- [ ] **Step 1:** Run `git diff --stat 57f8a68 HEAD -- packages studio docs/adr docs/index.md docs/workspace.md`. It must show no difference, apart from files the prototype never committed (scratch scripts). Anything else is a deviation from the plan: explain or fix it.
- [ ] **Step 2:** From the root, run `npm run check && npm run docs:build`. Expected: PASS.
- [ ] **Step 3:** No commit. Report the test counts, the ten lock entries, and that no existing lock entry changed.
