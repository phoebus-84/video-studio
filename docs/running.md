# Running the agent

Three ways to run, in increasing order of moving parts. Everything below was
executed against this repository, not inferred.

## 0. Once: install and point at a library

```bash
cd /path/to/video-studio
mise install      # node, bun and python at the pinned versions
bun install
npm run doctor
```

`mise install` is not optional politeness. The runtimes are pinned in
`mise.toml` because they are not interchangeable — `packages/voice` pins its
Python dependencies with hashes compiled against CPython 3.12, and installing
them under a different Python fails partway through with a missing wheel, which
reads like a broken package rather than a wrong interpreter. If you do not use
mise, match the versions in `mise.toml` by hand.

The agent works on a **library** — the on-disk tree of channels, series and
episodes described in [the workspace layout](./workspace). It defaults to `./library`
relative to where you start Pi. If your library lives outside the repository — the existing 1.7GB one
does — link it in:

```bash
ln -sfn /path/to/your/library library
```

`library/` is gitignored: it is production data, and ADR-0021 keeps generated
media out of git. To keep it elsewhere permanently, set `AVG_LIBRARY_ROOT`.

Check the runtime agrees the library is well-formed:

```bash
node studio/runtime/dist/src/cli.js doctor --library "$PWD/library" --json
```

`doctor` is the one command that requires `--library` outright: it reads no
environment variable and refuses without the flag. Everywhere else `--library`
wins, `AVG_LIBRARY_ROOT` is the fallback, and with neither set the root is the
working directory — where there is usually no library, so every episode
reports `Pipeline not found`. Pass the flag. Which root is in effect matters
more than it used to: `vpr run` and `vpr complete` write the episode's
journal, and the journal is the only record of what ran — pointed at the wrong
tree, it is authoritative about the wrong episode.

## 1. Agent alone — the normal way to work

From the repository root:

```bash
pi -e studio/agent/extensions/index.ts
```

That drops you into Pi's TUI with the studio extension loaded: 25 production
tools and the slash commands below. Add a prompt to go straight to work, or
`-p` for one non-interactive answer:

```bash
pi -e studio/agent/extensions/index.ts -p "list the channels in the library"
```

To avoid retyping the flag, install the package once:

```bash
pi install ./studio/agent     # then just: pi
pi list                       # confirm it is registered
```

### Slash commands

| Command | Purpose |
|---|---|
| `/video` | Start or continue an episode |
| `/vstatus` | Stage status for the current episode |
| `/ctx` | Show resolved channel / series / episode context |
| `/skills` | List discovered skills |
| `/request-approval` | Ask the operator to review a stage waiting at a gate |
| `/resume` | Resume an interrupted run |
| `/render` | Render the current timeline |
| `/create` | Create a channel, series or episode |
| `/status` | Overall workspace status |

### Tools the agent can call

Workspace: `pva_channels`, `pva_series`, `pva_episodes`, `pva_episode_detail`,
`pva_create_channel`, `pva_create_series`, `pva_create_episode`, `pva_journal`

Pipeline: `pva_snapshot`, `pva_run_pipeline`, `pva_run_stage`, `pva_request_approval`,
`pva_plan_rerun`, `pva_check_staleness`, `pva_budget_status`,
`pva_capability_status`

Production: `pva_generate_image`, `pva_synthesize_speech`, `pva_register_take`,
`pva_synthesize_nonverbal_audio`, `pva_synthesize_sound`, `pva_render_graphics`,
`pva_render_terminal`, `pva_render_vector_animation`, `pva_init_spec`,
`pva_upgrade_spec`, `pva_propose_reference`,
`pva_build_timeline`, `pva_check_episode`, `pva_layout_sheet`, `pva_compose_video`, `pva_compare_versions`, `pva_compose_multitrack_video`,
`pva_probe_media`

`pva_synthesize_sound` makes a series' sounds at $0, locally: wind, sea, rain,
fire, steam, birds, thunder, applause, a whoosh, a shimmer, and a music bed (a
soft chord progression in a key, major or minor). The same id always gives
the same WAV, in `assets/sounds/<soundId>.wav`, with
`<soundId>.sound.json` beside it saying how it was made. They are synthesized
stand-ins a person hears as what they name, not recordings.

A tool whose capability is not ready will fail rather than silently degrade.
`npm run doctor` tells you which are ready; `pva_capability_status` tells the
agent the same thing from inside a session.

### Render memory

A render opens one Chrome tab per worker, each holding the frame's pictures
and kits: about 2 GB with large paintings.
- **The default.** An episode's render (`pva_compose_video`) uses as many
  tabs as the available memory allows, at most half the cores and at least one. On macOS,
  inactive pages count as available.
- **When memory is short,** for instance with a virtual machine running, it
  renders with one tab: slower, but Chrome does not crash.
- **Overriding it.** `AVG_RENDER_CONCURRENCY=<n>` forces the number of tabs.

### The layout sheet

Before a render is spent, look at the **layout sheet**: small stills of the
timeline a render would use, at the first and last frame, spread over its
sections and at the instants its series' template declares, with one grid of
them labelled by number, time and reason. Ask the agent for it
(`pva_layout_sheet`; the `review-layout-sheet` skill reads it tile by tile),
or let the `series-production` pipeline make it at its `sheet` stage. It is
written to `artifacts/layout-sheet/` in the episode:

- `sheet.jpg` — the grid to read;
- `frames/NNN.jpg` — each still at a quarter of the video's size;
- `sheet.json` — the timeline it shows (by hash), the rules, the kits, the
  composer's drawing code and the `inputsHash` that says when the sheet is stale.

The pipeline's `render` stage refuses a sheet that is missing, whose grid or
stills were replaced, or that no longer shows exactly what it would render —
a composer upgrade included. To
render any timeline at chosen times without an episode, the composer has a
command of its own:

```bash
node packages/remotion-composer/dist/sheet-cli.js timeline.json out/ --assets episode/ --times 0,2.5,10
```

### Comparing two versions

After a correction, prove it changed only what was asked: render the new
version, then ask the agent to compare it with the render the person received
(`pva_compare_versions`, with `old` that render's id — or
`reference:<template>/<id>` for a golden reference — and `expect` the
sections the correction should touch; the `compare-versions` skill walks it).
Both videos are decoded with ffmpeg at the same instants — the layout sheet's,
about 24, or the `times` you ask for — aligned section by section through the
timeline every render keeps beside it (`output/<render-id>.timeline.json`).
Only those instants are seen; sections added, removed or resized are reported
whatever was sampled. The result is in `reviews/compare/<old>--<new>/` (a
reference is written `reference_<template>_<id>`):

- `report.json` — every pair of frames measured, the sections that changed
  shape, the verdict (`ok`, `unexpected-changes`, or `listed` without an
  expectation) and warnings;
- `pairs/NNN.jpg` and `changed.jpg` — each changed frame as old | new |
  difference.

### Speech: start the voice worker first

`speech.synthesize` is the one capability that is a **separate long-running
process**. Everything else the agent calls is either in-process or a remote
API; the TTS worker keeps MLX models warm, so it is started once and left
running — not spawned per tool call.

Once, to set it up:

```bash
mise run voice-setup                    # venv + pinned deps, on Python 3.12
cd packages/voice
.venv/bin/qwen-tts install 1.7B --profile custom_voice   # ~GBs, one time
```

Then, in its own terminal, before or alongside the agent:

```bash
mise run voice-serve
```

Confirm it is up and that both sides agree on where it is:

```bash
cd packages/voice && .venv/bin/qwen-tts doctor
```

Ports are the thing to watch. The worker's own default is **8000**; the studio
looks for speech on **5197** (`AVG_TTS_WORKER_URL`, and the gateway's health
probe). `mise.toml` sets `QTW_PORT` and `QTW_URL` to 5197 so the worker, its
CLI and the studio all agree. Running `qwen-tts serve` outside a mise
environment binds 8000, and the studio reports `tts: down` while the worker is
plainly running.

On macOS `qwen-tts serve` (and so `voice-serve`) reads its models, voices and
outputs from `~/Library/Application Support/QwenTTSWorker/`, where
`qwen-tts install` put them, unless `QTW_MODELS_DIR`, `QTW_VOICES_DIR` or
`QTW_OUTPUTS_DIR` say otherwise. `pva_capability_status` reports speech as
available only when the worker has a CustomVoice model installed, and
alignment only when it answers `/align`. Pass it a channel and series to see
which image route that series uses (fal.ai or openai-codex) and whether that
route is ready.

`pva_synthesize_speech` takes the speaker (`aiden`, `dylan`, `eric`,
`ono_anna`, `ryan`, `serena`, `sohee`, `uncle_fu`, `vivian`, or an alias such
as `narrator`) and a `language` (`italian`, `english`, …; `auto` by default).
Beside each `<scene>.wav` it writes `<scene>.synthesis.json`, the receipt: the
worker's job, model, speaker, language and the WAV's hash.

There is no supervisor that starts the worker for you: the agent will report
`speech.synthesize` as unavailable rather than launching a multi-gigabyte model
server behind your back.

### Registering a take

A speech tool leaves a file; a series reads takes. `pva_register_take` makes a
file a take of `artifacts/narration/takes.json` (avg-dcf.6.6):
- its audio is copied to `assets/takes/<take>.<hash8>.<ext>`, hashed and measured. Naming the file by its content means no take ever overwrites another's;
- its text, the voice that said it, and its language and role are recorded;
- it is placed in a unit's sequence. A short's `recital`, for example, is
  `titolo`, then `recita` with `pauseBefore` 1. `position` puts a take at a
  given place (0 = first).

Registering a take again replaces it in place. A timing that measured other
audio or text is dropped, so align the take again.

### Word timing: aligning a take

A take's word timing — when each word of its text is said — is measured by
forced alignment ([ADR-0038](adr/0038-word-timing-comes-from-forced-alignment.md)).
Ask the agent to align a take (`pva_align_take`, with the take's id from
`artifacts/narration/takes.json`); the timing is written beside it
(`artifacts/timing/<take>.json`) and `takes.json` names it.

- By default the voice worker aligns it locally with Qwen3-ForcedAligner. The
  first alignment downloads the model (about 1.3 GB); after that it stays
  loaded like the speech model. `GET /align` on the worker says which model
  and whether it is loaded.
- With `provider: "elevenlabs"` ElevenLabs aligns it instead — only when you
  ask, never as a fallback. It needs `ELEVENLABS_API_KEY` in the agent's
  environment, and each call goes through the episode's spend ledger at an
  estimated price per minute of audio.
- At most 300 s of audio at a time; a take without a `language` needs one
  given (`it`, `en`…).

### Clone voices

The voice worker can speak with an enrolled clone voice, through the Qwen3-TTS
**Base** model.
- **Enrolling** (`POST /voices/enroll`) is the operator's act. It needs a
  reference of 3–30 s, its exact transcript, and a written consent that names
  the source (`self_recorded`, `licensed` or `synthetic`) and its terms.
- **Using it:** Pi lists the voices with `pva_voices` and speaks with one by
  passing `voice: "clone:<id>"` to `pva_synthesize_speech`.
- **Sampling:** `temperature` and `repetitionPenalty` can be set on any
  voice. Without them the worker's defaults apply: temperature 0.7, and a
  repetition penalty of 1.5 for a clone or 1.05 for a preset. Values out of
  range are refused before synthesis. On Novembre the recital read better at
  1.1, synthesized one stanza at a time with each verse on its own line.
- **The receipt** names the voice's revision, the reference's hashes, the
  model, the seed, and the sampling when it was set.
- **A channel's characters** name their voice in `voices/registry.local.json`.

### Editing audio

`pva_edit_audio` makes one audio file from others, from a recipe saved
beside it as `<file>.edit.json` (ADR-0047). The recipe can:
- cut takes on words (at the quietest point of the pause, with short
  crossfades);
- reshape pauses with the take's own room tone;
- layer tracks with gains, fades, gain curves and ducking;
- master the mix: loudness, true peak, trims, fades.

The file's report names clicks, level jumps and clipping, and the record
keeps the words carried from the takes. A take made this way registers like
any other and gets its timing with `pva_align_take` `provider: "derived"`.
`pva_analyze_audio` measures any file. The skill is `audio-editing`; the
engine is `@av/audio-edit`.

### Verifying a take

Before a take is used, ask the agent to verify it (`pva_verify_take`). The
voice worker transcribes it locally (Whisper, $0) without knowing the text,
and the studio compares the two. The report goes to
`artifacts/takes/<take>.verification.json`, with:
- **Words:** words or whole lines missing, extra or heard differently.
- **Squeezed runs:** words the alignment gave almost no time. Either they
  were not said, or, when the transcription heard them, the timing is wrong
  there.
- **Pauses:** every pause at a verse end, a stanza end and inside a line.
- **Edges:** the take's start and end, and whether it ends while still
  loud.

Which pauses are too short is the series' or the channel's rule, in its skill
or validator.

## 1b. The same agent in Claude Code

The tools above are written once, against Pi's extension API, in
`studio/agent/`. Claude Code gets the same ones from an MCP server that hosts
that extension unchanged (`studio/agent/mcp/server.ts`, ADR-0048). From the
repository root:

```bash
claude
```

That is all: `.mcp.json` starts the `pva` server (Claude Code asks once to
trust it), and `.claude/settings.json` adds the hooks below. Start it from the
repository root, as with Pi: the server resolves `tsx` and the library from the
directory it starts in. `npm run studio:mcp` runs the server alone, for any
other MCP client.

| Under Pi | Under Claude Code |
|---|---|
| tools `pva_*` | `mcp__pva__pva_*` (same names, descriptions, schemas) |
| `/video`, `/render`, … | the server's prompts: `/mcp__pva__video create <c>/<s>/<e>`, `/mcp__pva__render …` |
| skills from `.pi/skills/` | `.claude/skills/<name>/SKILL.md`, written by `npm run compose` from the same sets, plus `pva-executive-producer` |
| the library-visibility warning at session start | a `SessionStart` hook (`studio/agent/claude/session-start.ts`) |
| review activity starts a turn | live with `npm run studio:claude` (see below); otherwise it waits for your next prompt (a `UserPromptSubmit` hook) |
| stage updates in the conversation | the same hook, on the next prompt |
| the status bar | `studio/agent/claude/statusline.mjs` (opt in, below) |
| `/login` for the Codex image route | Pi's login still works when Pi is installed; or `codex login`; or `AVG_CODEX_TOKEN` |

Read-only tools (`pva_channels`, `pva_journal`, `pva_budget_status`, …) are
allowed in `.claude/settings.json`; anything that writes or spends asks first,
as Claude Code does. Under Pi nothing asks.

**Live review activity.** Under Pi, an operator's review comment starts a turn
as it arrives. Claude Code takes such a push only from a *channel*, a research
preview that works in interactive sessions:

```bash
npm run studio:claude        # claude --dangerously-load-development-channels server:pva
```

Claude Code shows a confirmation at start. Without it the activity is not lost:
it reaches the agent with your next prompt.

**Status line.** It is a personal choice, so the repository does not set it.
In `.claude/settings.local.json`:

```json
{ "statusLine": { "type": "command",
    "command": "node \"$CLAUDE_PROJECT_DIR\"/studio/agent/claude/statusline.mjs" } }
```

**Long renders.** A tool call that runs past two minutes moves to the
background in Claude Code and its result arrives when it settles. When the
client asks for progress, the server reports it every minute, so a render is
not taken for an idle call (Claude Code gives a silent stdio call 30 minutes;
`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` changes that).

## 2. Agent plus gateway plus web studio

The gateway owns Pi RPC processes and streams events to the browser. Start it
in its own terminal:

```bash
cd studio/gateway
npx tsx src/index.ts config.json      # or: npm run dev
```

Verify:

```bash
curl -s http://127.0.0.1:5198/health
```

Expect `"overall":"healthy"` with `gateway: ready` and `runtime: ready`.

Two entries are *expected* not to be ready yet, and are not your setup being
wrong:

- `pi: Pi RPC not yet wired (vsg-e57.6)` — the gateway cannot yet drive Pi as a
  subprocess. Until that lands, run the agent yourself as in section 1, or
  let the gateway run Claude (below).
- `adapter: degraded` — a provider whose requirement is unmet. `FAL_KEY` unset
  means `image.generate` is unavailable; nothing is substituted for it.

Then the browser studio:

```bash
cd studio/web
npm run dev            # http://localhost:5173
```

The agent finds the gateway at `http://127.0.0.1:5198` and authenticates with
`library/.gateway-token`. Override with `AVG_GATEWAY_URL` and
`AVG_GATEWAY_TOKEN`.

### Which agent the studio drives

The studio's agent bar sends intents (`POST /api/intent`) to one session per
episode. By default that session is Pi's. With

```bash
AVG_AGENT_BACKEND=claude npx tsx src/index.ts config.json
```

it is a Claude Agent SDK session instead: the same tools (the MCP server of
section 1b), the repository's `CLAUDE.md`, skills and hooks, the library the
gateway serves, and the environment Pi would get (no operator key,
`AVG_HEADLESS=1`). Intents become turns — a prompt, guidance, an answer, a
rerun to plan, an edited artifact — cancel interrupts the turn in progress, and
operator review activity starts one. What the agent does is published on the
agent's event channel (`pi`): `agent_start`, `tool_execution_start`,
`message_end`, `agent_end` (with its cost), each with `backend: "claude"`.
`GET /` names the backend, and the agent bar says who it is talking to.

Nobody is there to approve a tool call, so the session runs in Claude Code's
`dontAsk` mode: the studio's tools, file reading and editing, the shell and
skills are allowed — what Pi has — and anything else is refused. Change that
with `AVG_CLAUDE_ALLOWED_TOOLS` and `AVG_CLAUDE_PERMISSION_MODE`. It uses the
Claude credentials of the user running the gateway (`claude` login or
`ANTHROPIC_API_KEY`); `AVG_CLAUDE_MODEL` picks the model.

## 3. Agent as an RPC subprocess

How the gateway will drive it once Pi RPC is wired. Useful for debugging the
protocol directly:

```bash
echo '{"id":"1","method":"health","params":{}}' \
  | node --import tsx studio/agent/src/agent.ts
```

JSONL request in, JSONL response out. Pi's own RPC mode is `pi --mode rpc`.

## 4. Driving stages by hand: `vpr run`, `complete`, `status`

The execution service owns what ran, when, and whether it counted. `vpr` is one
of its callers; the gateway and the agent are the others, and all three go
through the same service, so a stage claimed in one is visible to the rest.

Every command below takes `--library <path>` (see section 0) and `--json`.

**Which pipeline.** A command runs the pipeline the library declares for the
episode: the `pipeline:` key of `pipeline.yaml` in the episode, else its
series, else its channel (the files the gateway reads too). The key holds a
pipeline id, or a pipeline defined inline, which runs by its `id`. With no
declaration it runs `narrated-illustrated-video`; `--pipeline <name>` overrides
both. A `pipeline.yaml` that doesn't parse, or names something that isn't a
pipeline id, fails the command (exit 2) without claiming anything; the gateway
still passes over such a file. The built-in
pipelines are found through `@studio/pipelines`; `AVG_BUILTIN_PIPELINES`
points elsewhere.

**A series episode's stages follow its files.** An episode with an
`episode-spec.json` is made with the studio's tools (`pva_init_spec`,
`pva_generate_image`, `pva_register_take`, `pva_align_take`,
`pva_build_timeline`, `pva_layout_sheet`, `pva_compose_video`), which write
files, not the journal. So `vpr status`, the gateway's `/status`, Pi's
`pva_gather_context` and the web studio read its `series-production` stages
from those files (`"source": "files"`):
- the spec is done when it has no `__FILL__` left and loads;
- pictures when every asset it names is in `assets/`;
- takes when they are registered and aligned;
- the timeline when it matches what the compiler makes of them;
- the check when the series rules pass;
- the sheet when it pictures that timeline and the operator approved it (web
  Storyboard, or `vpr sheet approve`);
- the render when `output/current.json` names an audited render of that
  timeline.

A changed file makes its stage stale by itself. Each stage's `stateReason`
says what is missing and which tool makes it. The stage panel offers no run,
approve or reject for such an episode: those go through the journal. Claims
still do, for the stages the gateway can perform itself, but a sheet approved
only at the journal's gate (`vpr review`) is not seen here: approve it in the
Storyboard or with `vpr sheet approve`.

**`vpr run`** claims the next runnable stage — or the one named by `--stage` —
and prints the command that closes it:

```bash
node studio/runtime/dist/src/cli.js run my-channel/my-series/ep001 \
  --library "$PWD/library"
# Claimed "brief" until 2026-09-21T10:35:00.000Z. Perform it, then:
#   vpr complete my-channel/my-series/ep001 brief --library … --lease l-7 --outputs PATH
```

It claims; it does not perform. The lease is what the claim is worth: hold it,
do the work, and close the stage before it expires (`AVG_CLAIM_TTL_MS`, default
fifteen minutes). An abandoned claim needs no cleanup command — the lease lapses
and the stage becomes runnable again.

`--dry-run` says which stage it *would* claim and takes no lease.

**`vpr complete`** closes a claimed stage. `--outputs` is required unless you
pass `--failed`: the performer is the only party that knows what it produced,
and a completion with no outputs named is a claim that a stage ran with nothing
to show for it.

```bash
node studio/runtime/dist/src/cli.js complete my-channel/my-series/ep001 brief \
  --library "$PWD/library" --lease l-7 --outputs artifacts/brief.md
node studio/runtime/dist/src/cli.js complete my-channel/my-series/ep001 brief \
  --library "$PWD/library" --failed --error "the model refused"
```

Outputs must exist and must live inside the episode directory. A stage whose
pipeline declares a review gate completes as `awaiting_review`, and exits 0 —
completion is what happened, acceptance is a separate decision.

**`vpr status`** replays the episode's journal and reports each stage's state:

```bash
node studio/runtime/dist/src/cli.js status my-channel/my-series/ep001 \
  --library "$PWD/library" --json
```

It reports what the journal records, not what is on disk. **An episode full of
artifacts but with no journal reports every stage `pending`** — that is
correct, not a bug: files in a directory are not evidence that a stage ran
under a lease, and the previous behaviour (inferring completion from file
existence) is what made the CLI's report disagree with everything else.

Its output carries the episode's budget, from the spend ledger described in
"Budget" below.

**`vpr approve`** and **`vpr reject`** (which requires `--note <text>`)
decide a stage that completed with `gates.review: human` — the same call the gateway's
`/approve` and `/reject` routes and the browser studio make
(avg-qr4.3). Whether either one actually grants anything depends on who is
running it: see "The operator key" below.

### Takes

A stage that runs again does not destroy the result it replaces (avg-qr4.6).
Every completed attempt is kept read-only, as a **candidate**, under
`attempts/<stage>/<attempt>/` in the episode. The journal records which
candidate the stage currently stands on, called its **take**. By default each
new completion becomes the take, which is how it always worked.

**`vpr takes`** lists the candidates of each stage, or of one stage. For each it
shows which one is selected, who selected it, and whether the files on disk
still match it. The last of these is reported as `drifted`.

**`vpr reference`** manages a series' golden references (ADR-0037). Pi can
only propose one (`pva_propose_reference`, which freezes the episode's spec,
timeline and render in `reviews/references/<id>/`); the operator approves it,
signed with the operator key, and can later withdraw it. `verify` exits 0 only
for a trusted reference.

```bash
node studio/runtime/dist/src/cli.js reference approve my-channel/my-series/ep001 ep001-v1 \
  --note "the series' standard" --library "$PWD/library"
node studio/runtime/dist/src/cli.js reference verify my-channel/my-series my-template ep001-v1 --library "$PWD/library"
node studio/runtime/dist/src/cli.js reference list my-channel/my-series --library "$PWD/library" --json
node studio/runtime/dist/src/cli.js reference withdraw my-channel/my-series my-template ep001-v1 \
  --reason "the recital was re-recorded" --library "$PWD/library"
```

**`vpr sheet`** records the operator's review of an episode's layout sheet
(avg-3th.2). A spec-driven episode renders only when its current sheet was
approved: making the sheet again clears the review, and an edit that changes
what the sheet would show makes it stale. `approve` and `reject` sign with the
operator key exactly the sheet on disk (`artifacts/layout-sheet/review.json`);
a rejection needs a note. `status` exits 0 only for an approval. Pi only makes
and reads the sheet. The web studio does the same from an episode's
**Storyboard** tab (avg-goz): the stills, their state, and Approve / Reject
when the browser holds the operator key; its **Narration** tab plays the
registered takes, their words lit as they are said.

```bash
node studio/runtime/dist/src/cli.js sheet approve my-channel/my-series/ep001 --library "$PWD/library"
node studio/runtime/dist/src/cli.js sheet reject my-channel/my-series/ep001 \
  --note "the verse bar covers the hand at 0:12" --library "$PWD/library"
node studio/runtime/dist/src/cli.js sheet status my-channel/my-series/ep001 --library "$PWD/library"
```

**`vpr theme seal`** and **`vpr template release`** change a channel's look
(ADR-0040, avg-dcf.6.10). `theme seal` writes each file a theme release names,
with its hash, into its `theme.json`, and prints the hash a template release
pins; it refuses a release already sealed or already pinned. `template release`
copies a template release to a new version, pinned to a sealed theme with
`--theme`, or naming another compiler or validator version with `--compiler` /
`--validator` (a new layout is a new compiler version and a new release).
Episodes then move onto it with Pi's `pva_upgrade_spec`.

```bash
node studio/runtime/dist/src/cli.js theme seal my-channel/my-theme/1.1.0 --library "$PWD/library"
node studio/runtime/dist/src/cli.js template release my-channel/my-series my-template 1.1.0 \
  --from 1.0.0 --theme my-theme@1.1.0 --library "$PWD/library"
```

**`vpr template seal`** and **`vpr template verify`** handle a series
release's own code (ADR-0041). A release may hold its compiler and validator
as source, `compiler/index.ts` and `validator/index.ts`, exporting `compiler`
and `validator`.
- **`template seal`** builds each into one self-contained file
  (`compiler/compiler.cjs`), names it with its hash in `series-template.json`,
  and rehashes the release's files. Episodes on that release then compile with
  it, not with the application's registered compiler. It refuses a release an
  episode pins: make a new one with `template release --from`, change its code,
  seal it.
- **`template verify`** checks:
  - that the bundles are the sealed ones;
  - that the source still builds to them (a warning only: the studio code it
    inlines may have changed since, and the sealed bundle is what runs);
  - that each `fixtures/<name>/input.json` compiles, and passes the
    validator, to its `expected-timeline.json`.

  `--update` writes the goldens; once an episode pins the release, only the
  goldens it lacks, never rewriting one. `--dry-run` writes nothing.
- **`template fixture`** keeps a real episode's compile input (spec, takes,
  timings, assets, named relative to the episode) as
  `fixtures/<name>/input.json` of its release, or of another release of the
  same template with `--to <version>`; `verify --update` then writes its
  golden.

```bash
node studio/runtime/dist/src/cli.js template seal my-channel/my-series my-template 1.1.0 --library "$PWD/library"
node studio/runtime/dist/src/cli.js template verify my-channel/my-series my-template 1.1.0 --library "$PWD/library"
node studio/runtime/dist/src/cli.js template fixture my-channel/my-series/ep001 ep001 --library "$PWD/library"
```

**Writing a new series** is Pi's `author-series` skill. It decides first
whether the product is a spec-driven series at all, then writes, seals and
verifies everything the series needs in its channel's library, ending with a
series-local skill for its episodes.

**`vpr kit seal`** and **`vpr kit verify`** handle a kit a channel or a
series carries (ADR-0042). The kit lives in `library/<channel>/kits/<name>/<version>/`
(or the series' own `kits/`). Its source is `kit/index.tsx`, exporting
`kit`, the same shape as the composer's kits.
- **`kit seal`** builds `kit.cjs`, with React, Remotion and zod left to the
  studio, and writes `kit.json`.
- **A series release draws with the kit** once its `series-template.json`
  lists it, as `"kits": [{"name": "…", "version": "…", "level": "channel"}]`,
  and `template seal` fills in the hash.
- **`kit verify`** checks the bundle, warns if the source no longer builds to
  it, and checks the examples' props.

```bash
node studio/runtime/dist/src/cli.js kit seal my-channel my-card 1.0.0 --library "$PWD/library"
node studio/runtime/dist/src/cli.js kit verify my-channel/my-series my-hall 1.0.0 --library "$PWD/library"
```

**The toolbox** (ADR-0043) is what library code imports and never copies:
- a compiler or validator imports `@studio/series/toolbox/1.0.0`. It holds
  `frames`, `round3`, `tokens`, `normalizeWord`, `noise`, `lanes`,
  `findWord`, `kitsOf` and more; `template seal` inlines it;
- a kit imports the composer's libraries by version,
  `@av/remotion-composer/kits/lib/fonts/1.1.0`, `…/stage-math/1.0.0` and the
  rest; `kit seal` leaves them to the studio, so the fonts load once.

**A channel is its own git repository** (ADR-0045). `vpr channel init` sets
it up: its text in git, its heavy media out, each named by hash and size in
`media.lock.jsonl`, one line a file. After a `git pull`, `vpr channel media
--check` lists the media this machine lacks or holds in another version
(`--verify` rehashes every byte); after new media, `vpr channel media` updates
the list, to commit with the work. The list never forgets a file only because
this machine lacks it: `--prune` forgets the files deleted on purpose. An
optional [media remote](#channel-media-backup-and-restore) backs up and restores
the named bytes with `channel media push` and `channel media pull`.

```bash
node studio/runtime/dist/src/cli.js channel init my-channel --commit --library "$PWD/library"
node studio/runtime/dist/src/cli.js channel media my-channel --check --library "$PWD/library"
```

**A channel's sources** (ADR-0035) are material made once and pinned by the
episodes that use it: a poem's text, recital, timing and pictures, shared by a
short and a long. Each lives in `library/<channel>/sources/<name>/`.
- **Structure:** its structure is free. Its `README.md` says what it holds,
  how it was made and how to use it, with `status: draft` or `ready` in its
  frontmatter.
- **Making one:** Pi creates a source with `pva_create_source`, and makes its
  contents with the usual tools, passing `source: "<name>"` in place of
  `series` and `episode`. It follows the channel's procedure: a channel skill
  in `library/<channel>/skills/`, found after the series' skills and before
  the studio's.
- **Using one:** episodes pin it
  (`vpr pin add <channel>/<series>/<episode> <id> --source channel:<name> --used-by timeline`).
  Its takes, timings and pictures then reach the series' compiler like those
  of a pinned episode.
- **Context:** `pva_gather_context` names the README of the channel, the
  series and every pinned source.
- **Paid calls:** a source has no budget, so a paid call runs in an episode.

**Archive and stock media** (ADR-0046) come from public collections, free,
each with a licence anyone can verify: the Art Institute of Chicago, the Met,
the Cleveland Museum of Art, Wikimedia Commons, NASA, the Internet Archive,
Openverse, Rijksmuseum, Wellcome, iNaturalist, ccMixter, Iconify, Fluent/Noto/
OpenMoji emoji and LottieFiles, none of which needs a key; with a key, Pexels,
Pixabay, Unsplash, Coverr, Smithsonian, Jamendo, Mapillary and Freesound.
- **Finding and fetching.** Pi finds them with `pva_search_media` and fetches
  the original with `pva_fetch_media` (pass `rendition` to pick a listed
  provider rendition). The `find-archive-media` skill says how to choose.
- **Reuse before re-fetching.** `pva_search_local_media` finds an asset already
  licensed in the channel; `pva_reuse_local_media` copies its bytes, record and
  evidence without calling a provider, and never copies the same SHA-256 twice.
- **Vectors, emoji and animation.** Provider SVG is rasterized to an inert PNG
  (never saved as active XML); LottieFiles is fetched as its MP4 rendition.
- **Derivatives.** `pva_derive_media` trims and optionally centre-crops a
  fetched video or sound into a new recorded asset; the original is untouched.
- **Mapillary.** `pva_mapillary` (needs `MAPILLARY_TOKEN`) queries coverage,
  a sequence, photos, history, map features and detections, and produces into
  an episode: a still, a hyperlapse along a sequence, a pan inside a 360°
  image, or a tiny planet. Every output carries the CC BY-SA 4.0 credit and,
  for derivatives, the share-alike obligation.
- **What a file brings.** It arrives in `assets/` with `<name>.source.json`
  (its provider, licence and credit) and the provider's response as evidence
  in `artifacts/provenance/`. `ATTRIBUTIONS.md` is made from the records.
- **Freesound.** Its recorded effects and ambiences come in when
  `FREESOUND_API_KEY` is in Pi's environment. The key is free at
  freesound.org/apiv2/apply. The file is Freesound's high-quality preview,
  and its record says so.
- **Keys.** Besides Freesound: `PEXELS_API_KEY`, `PIXABAY_API_KEY`,
  `UNSPLASH_ACCESS_KEY`, `COVERR_KEY`, `SMITHSONIAN_KEY`, `JAMENDO_CLIENT_ID`,
  `MAPILLARY_TOKEN`. Platform licences (Pexels, Pixabay, Unsplash, Coverr,
  LottieFiles, icon sets) are opt-in, e.g. `provider:pexels`.
- **Policy.** A channel decides which licences it accepts in `settings.yaml`.
  The default is public domain, CC0, CC BY and CC BY-SA, with at least
  1600 px on an image's long side.
- **Checking.** `pva_check_provenance` checks that every file is still the one
  fetched.

```yaml
# library/<channel>/settings.yaml
archiveMedia:
  licences: [public-domain, CC0, CC-BY, CC-BY-SA]
  minImageLongSide: 1600
  minVideoHeight: 720
```

**`vpr select`** puts an earlier candidate back in place. The gateway offers
the same thing as `POST …/stages/:stage/select`, and `GET …/episodes/:episode/takes`
lists the candidates.

```bash
node studio/runtime/dist/src/cli.js takes my-channel/my-series/ep001 illustrations \
  --library "$PWD/library" --json
node studio/runtime/dist/src/cli.js select my-channel/my-series/ep001 illustrations 2 \
  --expect 3 --library "$PWD/library"
```

- **`--expect`** names the attempt you saw selected, or `none`. If someone else
  selected a different take in between, the command refuses instead of
  silently overwriting their choice.
- **The operator's selection is a lock.** It is signed with the operator key.
  From then on, a stage that runs again keeps its new result as a candidate and
  puts the operator's take back: neither an automatic run nor Pi replaces it.
  Only the operator can change it, by selecting another take.
- **A different take means downstream stages are out of date.** Selecting one
  marks the stages that depend on it stale. On a stage with a review gate it
  also records a new review request, because nobody has approved those bytes.
- **Candidates are never pruned.** An episode that runs a stage many times
  keeps every result.

### Channel media backup and restore

Version a `media.remote.json` in the channel repository, following the
[workspace contract](workspace.md#media-remote). It selects an S3-compatible
bucket/prefix and tiers; credentials stay in the environment or your AWS
profile. The runtime never creates buckets, deletes objects, changes the lock
while transferring, or grants an approval.

```bash
# After making media, update and commit the lock with the editorial changes.
vpr channel media my-channel --library "$PWD/library"

# Inspect selection and remote availability before paying for uploads.
vpr channel media push my-channel --dry-run --library "$PWD/library"
vpr channel media push my-channel --library "$PWD/library"

# On a collaborator's clone, fetch just one episode (and its locked link targets).
vpr channel media pull my-channel --episode my-series/ep001 --dry-run --library "$PWD/library"
vpr channel media pull my-channel --episode my-series/ep001 --library "$PWD/library"
vpr channel media my-channel --check --episode my-series/ep001 --verify --library "$PWD/library"
```

Use `node studio/runtime/dist/src/cli.js` instead of `vpr` if the CLI is not
on your PATH. Set `AWS_PROFILE` or the standard AWS credential environment
variables in the shell that runs it; do not commit them. Region comes from
`media.remote.json`. Only run transfers against a remote you trust: its endpoint
is a versioned configuration choice, not a server discovered by the application.

**Selection.** `--tier paid,approved` (or repeated `--tier`) overrides the
remote's `keep`; `--tier all` includes everything, including derived files and
long deliveries. `--episode` works on push, pull and check. It scopes paths to
that episode and, for remote operations, includes transitive locked symlink
targets. It does not discover references embedded in arbitrary specs, pins or
templates: pull broader scope when those name shared assets outside the episode.

Default `keep` excludes deliveries and explicitly classified derived media;
unknown files are `other` and included. Configure `rules` for your actual
receipt-backed loop/atlas/soundtrack directories to avoid uploading thousands
of rebuildable PNGs. These explicit labels do not confer approval or a licence.
Every report includes excluded counts and bytes by tier. Push deduplicates
object bytes; pull counts bytes restored to each local path.

**Safety and resuming.** Local changed files are never overwritten. A merged
lock naming multiple versions of one path is reported `ambiguous`, never
resolved automatically. Choose the intended bytes and deliberately refresh the
lock before retrying. Downloads are hash/size-checked before exclusive atomic
publication. The destination filesystem must support hard links. Symlinked
parent directories, escaping/cyclic links and targets absent from the lock are
refused. Fix the layout or lock rather than disabling these checks.

Workers are bounded (`--concurrency 4` by default, 1–16 allowed). Large uploads
use multipart. Interrupt with Ctrl-C and rerun: completed objects/files are
skipped, but an incomplete object starts again. SIGINT/SIGTERM trigger best-effort
cleanup; a hard kill may leave a private upload snapshot in the system temp
directory or a `.media-pull-*.tmp` beside its destination. These leftovers are
not locked media and may be removed once no transfer is running. Upload
snapshots need free temporary disk space up to the combined size of active
uploads, in addition to the originals. `--dry-run` reads local media and remote
HEAD metadata but creates no files and issues no GETs or PUTs.

**Checking.** With a remote configured, `--check` distinguishes `remote`
(restorable, but missing locally) from `missing` (not available remotely either).
A link is restorable from git when its target is available. Remote availability
still exits 2: it is not local readiness. Authentication/service failures are
reported as errors, not as missing objects. `--check --offline` makes no network
requests; without a configured remote, checks remain local automatically.
`--verify` bypasses the local size/mtime hash cache. Checks write nothing.

**Provider requirements.** The S3 endpoint must support conditional
`If-None-Match: *` writes on PUT and multipart completion; unsupported conditions
fail rather than silently allowing overwrites. Optional request checksums can
be disabled with `checksum: false` for compatible servers that lack them, but
local verification cannot. Test the chosen provider before relying on it as a
backup; the automated tests use a fake HTTP S3 server, not a certification of
R2, B2, Garage, SeaweedFS or MinIO.

Read-only users need object-read permission; writers additionally need object
write and multipart-abort permission. S3 may return 403 instead of 404 for
absent objects without bucket-list permission, so allow the required bucket
metadata access if you want missing objects distinguished from access failures.
No remote objects are listed or deleted by these commands. Configure bucket
lifecycle to abort abandoned multipart uploads; do not automatically expire
completed hash objects. Local lock `--prune` never deletes a remote object.

**Full fresh-clone acceptance.** The issue's stronger goal is *every locked
file matching*, not merely a successful selective backup. For that test:

```bash
# Source machine: include all media needed by the test, not only default tiers.
vpr channel media push my-channel --tier all --library "$PWD/library"

# After cloning the channel text into another library:
vpr channel media pull my-channel --episode my-series/ep001 --tier all --library "$PWD/library"
vpr channel media my-channel --check --episode my-series/ep001 --verify --library "$PWD/library"
```

Alternatively rebuild excluded derivatives/deliveries, then verify their hashes.
The test on `ambient-through-time` and acceptance of its existing signed layout
sheet by `pva_compose_video` remain an operator-run production check. No transfer
creates an approval, and approval verification still requires the existing
shared operator HMAC key (ADR-0045). A render on another machine need not be
byte-identical. Do not claim a backup exists for a locked file missing both
locally and remotely: hashes cannot recreate lost paid generations.

### Budget

Paid calls are journal records (avg-91o). Before a paid tool calls a provider,
it **reserves** the call's estimated price. Afterwards it **settles** the
reservation with what the provider charged. If the call never reached the
provider, or the provider refused it, the tool **releases** the reservation
instead. Today the paid tools are `pva_generate_image` on a fal model,
`pva_generate_minimax_h3_video` and `pva_generate_wan_video`. The Codex image provider bills your
ChatGPT plan, not money, so it reserves nothing.

The limit is the nearest `budget:` in `settings.yaml`, looked up in the
episode first, then the series, then the channel:

```yaml
budget:
  currency: USD
  limitMicros: 5000000   # $5.00
  warnAtMicros: 4000000  # optional
```

- **The check is atomic.** A reservation is checked and written under the
  episode's budget lock, so two sessions cannot both spend the last dollar.
  A call that would take committed spend (spent plus reserved) past the limit
  is refused before fal is called, and the refusal states the figures.
- **A paid stage stops when the budget is used up.** Once the budget is spent,
  a stage that declares a paid capability (`image.generate`, `image.edit`,
  `video.generate`) is reported `blocked` and refuses to start. Stages that
  spend nothing still run.
- **No `budget:` means no cap, not no record.** Every call is still recorded.
- **A model with no known price** is refused under a budget, because there is
  nothing to check it against. Without a budget it is recorded as unpriced.
- **An open reservation counts.** A process that died mid-call may still have
  been billed. `vpr budget` lists what is open. Check the provider's dashboard,
  then release the call yourself:

```bash
node studio/runtime/dist/src/cli.js budget my-channel/my-series/ep001 --library "$PWD/library"
node studio/runtime/dist/src/cli.js budget my-channel/my-series/ep001 release rsv_01J… \
  --note "no charge on the fal dashboard" --library "$PWD/library"
```

Only the operator can release a reservation, because releasing frees budget.
The gateway's `POST …/budget/reservations/:id/release` has the same rule.

**What the budget does not stop:** the ledger keeps Pi's *tools* honest. Pi's
environment holds `FAL_KEY`, so a `curl` from its shell reaches fal with no
reservation, and spend lines are not signed. This is the same same-user
boundary as the operator key (avg-qr4.8).

## The operator key

A human decision only counts when it is signed, and only the **operator** can
sign one. The operator is not a role anyone assigns — it is whoever can read
the operator key file, so treat that file the way you would treat a password.

- The gateway generates it the first time it starts, alongside the bearer
  token: `studio/gateway/.operator-key`, mode `0600`. Both files are 0600 for
  the same reason — either one readable by another user makes them the
  operator, not you.
- `vpr` reads it. The browser studio asks you for it once — paste the
  contents of the file into the operator-key field beside the gateway token —
  and keeps it in that browser's local storage. It is never built into the
  web bundle or served by the dev server.
- **What is closed for Pi, and what is not.** The API path is closed: Pi
  holds only the gateway token, which the gateway resolves to the `agent`
  principal, so `pva_request_approval` — or any call Pi makes to `/approve` —
  can only *request* a review, never grant one (avg-qr4.3, and the harness
  review's approval P0). Pi's own shell is guarded against accidents: the
  gateway spawns Pi with `AVG_HEADLESS=1`, and `vpr` run with that set is an
  `agent` without even reading the key file, so `vpr approve` from Pi's bash
  tool records a request. A Pi you start yourself with `pi -e …` inherits
  your shell's environment instead; export `AVG_HEADLESS=1` there to get the
  same guard. What this does **not** stop is a same-user process that
  deliberately reads the key file, or unsets `AVG_HEADLESS` first — that is
  outside this issue's boundary and is avg-qr4.8's OS-isolation work.
- Without it, `vpr approve`/`vpr reject` still run: the decision is recorded
  as a **request** rather than a grant, and the command exits non-zero — the
  same downgrade an unauthenticated gateway caller gets.
- **Rotation:** stop the gateway, delete the key file, start the gateway
  again, and paste the new key into the studio. This is not a maintenance
  no-op: every existing signed human decision on every episode now reads
  `does not verify` and must be re-granted. That is intended — the whole
  point of signing is that deleting the key is exactly as consequential as it
  looks. (`unsigned` is a different reason: it is what pre-v2 legacy records,
  written before approvals were signed, read under any key.)
- **The limit this does not close:** the key is a file, not a hardware
  secret. Anything running as your own user — a script, another agent, a
  compromised dependency — can read it and sign as you (avg-qr4.8 tracks
  hardening this further). It stops Pi from minting its own approvals; it
  does not stop your own account from doing so.

`AVG_OPERATOR_KEY_FILE` points the gateway and `vpr` at **one** key file,
which matters once either runs from somewhere other than its usual directory.
Without it:

- the gateway writes and reads `.operator-key` in **its own working
  directory** (so start it from `studio/gateway/`, or set the variable);
- `vpr` defaults to `studio/gateway/.operator-key`.

The gateway refuses to start when its token file or operator key file lies
inside the library root it serves: `/library/` is served without
authentication, so a credential there is one GET away from anything that can
reach the port.

Those two defaults only agree when the gateway is started from
`studio/gateway/`. If you start it elsewhere, set `AVG_OPERATOR_KEY_FILE` to
the same absolute path for every process that needs to be the operator.

## Environment

| Variable | Default | Effect |
|---|---|---|
| `AVG_LIBRARY_ROOT` | `./library` | Where channels and episodes live |
| `AVG_CLAIM_TTL_MS` | 900000 (15 min) | How long a `vpr run` claim holds its lease |
| `AVG_GATEWAY_URL` | `http://127.0.0.1:5198` | Gateway to stream events to |
| `AVG_GATEWAY_TOKEN` | `library/.gateway-token` | Gateway auth |
| `AVG_OPERATOR_KEY_FILE` | gateway: `.operator-key` in its cwd; `vpr`: `studio/gateway/.operator-key` | Which file makes a caller the operator — see "The operator key" above |
| `AVG_BUILTIN_PIPELINES` | `@studio/pipelines`' `pipelines/` | Where `vpr` finds the built-in pipelines |
| `AVG_HEADLESS` | unset (the gateway sets `1` for Pi) | Any value but empty or `0` makes `vpr` an agent without reading the operator key |
| `FAL_KEY` | — | Required for `image.generate` / `image.edit` |
| `AVG_TTS_WORKER_URL` | local worker | Speech synthesis endpoint |
| `AVG_AGENT_BACKEND` | `pi` | Which agent the gateway runs per episode: `pi` or `claude` |
| `AVG_CLAUDE_MODEL` | Claude Code's default | Model of the gateway's Claude sessions |
| `AVG_CLAUDE_PERMISSION_MODE` | `dontAsk` | Permission mode of the gateway's Claude sessions |
| `AVG_CLAUDE_ALLOWED_TOOLS` | `mcp__pva,Skill,Read,Write,Edit,Glob,Grep,Bash` | Tools those sessions use without asking |
| `AVG_CLAUDE_CHANNEL` | unset (`npm run studio:claude` sets `1`) | The MCP server pushes review activity as channel events |
| `AVG_CLAUDE_STATE_DIR` | `.claude/pva` | Where the MCP server leaves status and inbox for Claude Code's hooks |
| `AVG_CODEX_TOKEN` | — | OpenAI Codex token for the image route outside Pi |

Secrets are environment-only (ADR-0030). Put them in your shell profile or an
untracked `.env`, never in a committed file.

## If something is wrong

**The studio says `Failed to fetch`, and the gateway exits with
`ERR_MODULE_NOT_FOUND … @studio/…`** — usually right after switching branches.
The branch added or changed a workspace, and `node_modules` has neither its link
nor its `dist/`. Run `bun install` at the repository root: it links every
workspace and its postinstall builds the ones imported from `dist/`. Then
restart the gateway. The studio's error is only the symptom; the gateway's own
output names the missing package.

**`No packages installed` from `pi list`** — expected unless you ran
`pi install ./studio/agent`. The `-e` flag works without installing.

**Gateway: `Library root ... does not exist`** — `libraryRoots` in
`studio/gateway/config.json` resolves relative to the gateway directory, so the
repository root is `../../library`.

**`vpr exited with code 1`** — run it by hand with `--library` to see the real
error. Pass the flag rather than relying on `AVG_LIBRARY_ROOT`: the fallback
exists, but a command that journals into a library you did not mean is worse
than one that refuses.

**A capability fails mid-session** — check `npm run doctor`. The agent is
designed to fail rather than substitute a provider, so an unmet requirement
surfaces as an error, not a quietly worse video.

**`gateway:unauthorized … Gateway rejected the token (4001)`** — the agent and
the gateway disagree about the token. Almost always a gateway from an older
checkout still holding port 5198 with its own token:

```bash
lsof -ti:5198 | xargs -r ps -o pid=,command=   # see who owns the port
lsof -ti:5198 | xargs -r kill                  # stop it
```

Then start the gateway from this repository. It writes
`studio/gateway/.gateway-token`, which is the first place the agent looks. To
be explicit:

```bash
export AVG_GATEWAY_TOKEN="$(cat studio/gateway/.gateway-token)"
```

The agent no longer retries after a 4001 — a rejected token will not fix itself
— and it keeps working without the event stream, so this is a degraded mode
rather than a stopped one.
