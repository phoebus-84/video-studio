# Running the agent

Three ways to run, in increasing order of moving parts. Everything below was
executed against this repository, not inferred.

## 0. Once: install and point at a library

```bash
cd /Users/euripide/strange_things/video-studio
bun install
npm run doctor
```

The agent works on a **library** — the on-disk tree of channels, series and
episodes described in [workspace.md](workspace.md). It defaults to `./library`
relative to where you start Pi. The existing 1.7GB library currently lives in
the old workspace, linked in:

```bash
ln -sfn /Users/euripide/strange_things/avg/library library
```

`library/` is gitignored: it is production data, and ADR-0021 keeps generated
media out of git. To keep it elsewhere permanently, set `AVG_LIBRARY_ROOT`.

Check the runtime agrees the library is well-formed:

```bash
node studio/runtime/dist/src/cli.js doctor --library "$PWD/library" --json
```

`vpr` requires `--library` explicitly; it does not read `AVG_LIBRARY_ROOT`.

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

## Environment

| Variable | Default | Effect |
|---|---|---|
| `AVG_LIBRARY_ROOT` | `./library` | Where channels and episodes live |
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
error; the CLI requires that flag.

**A capability fails mid-session** — check `npm run doctor`. The agent is
designed to fail rather than substitute a provider, so an unmet requirement
surfaces as an error, not a quietly worse video.
