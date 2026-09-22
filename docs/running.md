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
| `/approve` | Approve a stage waiting at a gate |
| `/resume` | Resume an interrupted run |
| `/render` | Render the current timeline |
| `/create` | Create a channel, series or episode |
| `/status` | Overall workspace status |

### Tools the agent can call

Workspace: `pva_channels`, `pva_series`, `pva_episodes`, `pva_episode_detail`,
`pva_create_channel`, `pva_create_series`, `pva_create_episode`, `pva_journal`

Pipeline: `pva_snapshot`, `pva_run_pipeline`, `pva_run_stage`, `pva_approve`,
`pva_plan_rerun`, `pva_check_staleness`, `pva_budget_status`,
`pva_capability_status`

Production: `pva_generate_image`, `pva_synthesize_speech`,
`pva_synthesize_nonverbal_audio`, `pva_render_graphics`,
`pva_render_terminal`, `pva_render_vector_animation`, `pva_compose_video`,
`pva_compose_multitrack_video`, `pva_probe_media`

A tool whose capability is not ready will fail rather than silently degrade.
`npm run doctor` tells you which are ready; `pva_capability_status` tells the
agent the same thing from inside a session.

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

There is no budget line in the output. There is no ledger behind one yet
(avg-91o), and a zero is a number an operator would act on.

## Environment

| Variable | Default | Effect |
|---|---|---|
| `AVG_LIBRARY_ROOT` | `./library` | Where channels and episodes live |
| `AVG_CLAIM_TTL_MS` | 900000 (15 min) | How long a `vpr run` claim holds its lease |
| `AVG_GATEWAY_URL` | `http://127.0.0.1:5198` | Gateway to stream events to |
| `AVG_GATEWAY_TOKEN` | `library/.gateway-token` | Gateway auth |
| `FAL_KEY` | — | Required for `image.generate` / `image.edit` |
| `AVG_TTS_WORKER_URL` | local worker | Speech synthesis endpoint |

Secrets are environment-only (ADR-0030). Put them in your shell profile or an
untracked `.env`, never in a committed file.

## If something is wrong

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
