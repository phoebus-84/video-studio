# Install and composition

## Requirements

| Tool | Needed for | Notes |
|---|---|---|
| Node ≥ 20 | everything | |
| Bun | dependency installation | the workspace lockfile is a `bun.lock` |
| FFmpeg + ffprobe | `video.compose`, `media.probe`, `graphics.animate` | `brew install ffmpeg` |
| ImageMagick | vector animation in the agent | `brew install imagemagick` |
| Python 3 | `packages/voice` (MLX speech) | Apple Silicon for MLX acceleration |

Credentials are environment-only (ADR-0030) — never committed:

| Variable | Needed for |
|---|---|
| `FAL_KEY` | `image.generate`, `image.edit` |

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
| `voice` | Only the standalone voice tool |
| `render` | Only the graphics, infographics and composition packages |

Composition writes **`composed.json`**, the answer to "what is actually wired
here?" — the active components, which capability each provides, and what is
missing. The agent and gateway read it instead of guessing.

Two rules it will not break:

- **It never substitutes one provider for another.** A missing requirement is
  reported, not worked around (ADR-0015, and the "no silent fallback" rule in
  [architecture.md](architecture.md)).
- **It refuses ambiguity.** If two components claim the same capability, that
  is an error for you to resolve, not a coin flip.

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
