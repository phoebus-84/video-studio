# Install and composition

## Requirements

| Tool | Needed for | Notes |
|---|---|---|
| Node ≥ 22 | everything | |
| Bun | dependency installation | the workspace lockfile is a `bun.lock` |
| FFmpeg + ffprobe | `video.compose`, `media.probe`, `graphics.animate` | `brew install ffmpeg` |
| Headless Chrome | `video.compose` (Remotion renders in it) | nothing to install: Remotion downloads `chrome-headless-shell` into `node_modules/.remotion` on the first render; `npm run doctor` says whether it is there |
| ImageMagick | vector animation in the agent | `brew install imagemagick` |
| Python 3 | `packages/voice` (MLX speech) | Apple Silicon for MLX acceleration |
| Blender 4.2–4.x or 5.2.x LTS | `scene.create`, `scene.render` | 5.2.1 live tested; bundled Python; set `BLENDER_BIN` if needed |

Credentials are environment-only (ADR-0030) — never committed:

| Variable | Needed for |
|---|---|
| `FAL_KEY` | `image.generate`, `image.edit` |
| `AVG_OPERATOR_KEY_FILE` | Pointing the gateway and `vpr` at the same operator key |

### The operator key

A human decision on a stage that declares `gates.review: human` only counts
when it is signed, and the gateway signs it only for whoever holds the
**operator key** — a file it generates on first start (`0600`, next to the
bearer token), not a role anyone assigns. `vpr` reads it; the browser studio
asks you to paste it once and keeps it in local storage. Pi is given only the
gateway token and cannot discover this file through its own config, so over
the API it can request a review but never grant one, and the gateway spawns
it with `AVG_HEADLESS=1` so its shell's `vpr` is headless too. A caller
without the key is **headless**: `vpr approve`/`vpr reject` still run, but
the decision is recorded as a request and the command exits non-zero, the
same as an unauthenticated gateway caller.

Rotating it (stop the gateway, delete the file, start it again) is
deliberately destructive: every existing signed human decision then reads
`does not verify` and must be re-granted (`unsigned` is what pre-v2 legacy
records read, under any key). See
[Running the agent → The operator key](running.md#the-operator-key) for the
full story, including `AVG_OPERATOR_KEY_FILE` and its default-path pitfall.

## The three commands

```bash
mise install                       # node, bun and python at the pinned versions
bun install                        # one install for every module
npm run compose -- --profile=full  # decide which pieces are wired
npm run doctor                     # check this machine can run them
```

Runtimes are pinned in `mise.toml` and are not interchangeable — most sharply
for `packages/voice`, whose hash-pinned Python dependencies exist only as cp312
wheels. Without mise, match those versions by hand; a newer `python3` fails
midway through the voice install with what looks like a broken dependency.

`bun install` runs `compose` automatically afterwards, so a plain
`bun install` leaves you with a working default composition. Running `compose`
by hand is how you change profile.

## Composition

This repository is not one program. It is a set of pieces, some useful on
their own. **Composition is the step that decides which pieces are wired**, and
it happens at install time rather than being hardcoded.

```bash
npm run compose -- --list
```

| Profile | What you get |
|---|---|
| `full` | Everything: the studio plus every reusable package |
| `studio` | The studio without the local MLX voice worker |
| `headless` | Production core, no browser studio — CLI and agent only |
| `blender` | Local 3D production, composer, agent and browser; no cloud image/MLX voice requirement |
| `voice` | Only the standalone voice tool |
| `render` | Only the graphics, infographics and composition packages |

Composition writes **`composed.json`**, the answer to "what is actually wired
here?" — the active components, which capability each provides, and what is
missing at composition time. Blender tools enforce their selected binding; older
agent/gateway paths are not yet uniformly composition-driven (see
[harness review](harness-review.md)). `doctor` rechecks live requirements rather
than trusting the stored readiness snapshot.

Two rules it will not break:

- **It never substitutes one provider for another.** A missing requirement is
  reported, not worked around (ADR-0015, and the "no silent fallback" rule in
  [architecture.md](architecture.md)).
- **It refuses ambiguity.** Multiple providers are allowed, but the profile
  must select a `defaultProviders` entry for each overlapping capability.

Re-running `compose` without `--profile` keeps whatever profile you last chose,
so a later `bun install` cannot silently reset a deliberate decision.

### Example: taking only the voice tool

```bash
npm run compose -- --profile=voice
```

```
Profile: voice — Only the standalone voice tool. No studio, no pipelines.
  ✓ voice           reusable  packages/voice
Capabilities:
  ✓ speech.synthesize    <- voice
```

Nothing from `studio/` is wired. `packages/voice` has no idea the studio
exists, which is the point.

### Blender scene production

```bash
npm run compose -- --profile=blender
npm run doctor
```

Install Blender 5.2 LTS (or 4.5 LTS) separately; composition never installs binaries. Standard
macOS Blender.app and `BLENDER_BIN` are recognized. Read the
[Blender package guide](packages/blender.md) for standalone examples and the
`blender-scene` skill for Pi-directed creation, previews and artist handoffs.
The initial workflow creates silent footage for composition, not automatic
narration or publishing.

## Skills

`skills/` is the source of truth; `.pi/skills/` is **generated** by composition
(ADR-0029). Never edit `.pi/skills/` by hand — the next compose overwrites it.

| Set | Contents |
|---|---|
| `skills/shared/` | Techniques useful in any agent workflow |
| `skills/studio/` | Production-stage skills bound to the studio pipelines |

The agent's own operating skill (`pva-executive-producer`) ships inside
`studio/agent`, because it is the agent's manual rather than a production stage.

## Verifying

```bash
npm run check     # paths + boundaries + typecheck + tests
```

Two of those checks exist to stop specific past failures returning:

- **`check:paths`** — the predecessor layout used `file:../` dependencies,
  which install as symlinks holding absolute paths. Authored under one home
  directory, they dangled everywhere else, and 20 of 28 runtime test files
  failed at import on any other machine. Use `workspace:*`.
- **`check:boundaries`** — `packages/*` may not depend on `studio/*`. A package
  that imports the studio's contracts is not a reusable tool any more.

## Troubleshooting

**`Cannot resolve @studio/runtime`** — run `bun install` at the repository
root, not inside a module.

**A capability shows `!` in compose or doctor** — its requirement is missing.
`doctor` prints which binary or variable. Nothing is substituted automatically.

**Tests fail with `spawn magick ENOENT` or ffmpeg errors** — install the system
tools above. These are genuine environment gaps, not code failures.
