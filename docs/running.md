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
`pva_synthesize_nonverbal_audio`, `pva_render_graphics`,
`pva_render_terminal`, `pva_render_vector_animation`, `pva_init_spec`,
`pva_upgrade_spec`, `pva_propose_reference`,
`pva_build_timeline`, `pva_check_episode`, `pva_layout_sheet`, `pva_compose_video`, `pva_compare_versions`, `pva_compose_multitrack_video`,
`pva_probe_media`

A tool whose capability is not ready will fail rather than silently degrade.
`npm run doctor` tells you which are ready; `pva_capability_status` tells the
agent the same thing from inside a session.

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
  subprocess. Until that lands, run the agent yourself as in section 1.
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
and reads the sheet.

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

### Budget

Paid calls are journal records (avg-91o). Before a paid tool calls a provider,
it **reserves** the call's estimated price. Afterwards it **settles** the
reservation with what the provider charged. If the call never reached the
provider, or the provider refused it, the tool **releases** the reservation
instead. Today the paid tools are `pva_generate_image` on a fal model and
`pva_generate_minimax_h3_video`. The Codex image provider bills your
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
| `AVG_HEADLESS` | unset (the gateway sets `1` for Pi) | Any value but empty or `0` makes `vpr` an agent without reading the operator key |
| `FAL_KEY` | — | Required for `image.generate` / `image.edit` |
| `AVG_TTS_WORKER_URL` | local worker | Speech synthesis endpoint |

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
