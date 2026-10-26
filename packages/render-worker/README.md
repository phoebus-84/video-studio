# render-worker

## Setting up an engine

An engine is a Linux machine that renders episodes for another one over SSH. It holds a clone of this repository (without `library/`) and, inside it, an ignored `.engine/` folder with pinned tools: Node, a static FFmpeg and FFprobe, and the browser Remotion downloads. Pinned versions mean two engines produce the same render pieces, so they can share a cache.

1. On the engine, create the clone: `git init ~/video-studio && git -C ~/video-studio config receive.denyCurrentBranch updateInstead`.
2. From the controlling machine, push a commit to it: `git push ssh://<user>@<host>/~/video-studio HEAD:refs/heads/engine`, then on the engine `git -C ~/video-studio checkout -f engine`.
3. On the engine, run `~/video-studio/packages/render-worker/setup.sh`. It installs the apt packages Chrome needs plus fonts (the only step that uses sudo; with a password, run it with `SETUP_SUDO_STDIN=1` and give the password on the first line of stdin), then Node, FFmpeg, Bun, `bun install` (Bun is pinned too, as the repository's package manager) and the browser. It can be repeated; finished steps are skipped. To change a version, edit the constants at its top.
4. It writes `.engine/env.sh`, which puts the pinned Node and FFmpeg first on `PATH` and sets `FFMPEG_PATH` and `FFPROBE_PATH`. `packages/render-worker/engine.sh <args>` sources it and runs the engine CLI; that is what the controlling machine calls.

## Rendering on an engine

`pva_compose_video` takes an optional `host`: a tailnet peer name, a host named in `render-hosts.json`, or `auto` for the first engine that answers. Without it the episode renders here, as before. With it, everything but the render stays on this machine (the decision and sheet checks, naming, the audit, `output/current.json`, the journal); only `renderTimeline` runs on the engine, through `remoteRenderer` from this package, which has its shape.

Nothing about the machines is written in code.

- **Discovery.** `auto` tries the hosts in `render-hosts.json`, then the tailnet's online Linux peers from `tailscale status --json`, and takes the first whose `engine.sh version` answers over SSH. The tailscale program is `AVG_TAILSCALE`, else `tailscale` on `PATH`, else where the installer puts it (`%ProgramFiles%\Tailscale\tailscale.exe` on Windows, which does not add it to `PATH`).
- **Settings.** `render-hosts.json` is `$AVG_RENDER_HOSTS`, else `library/render-hosts.json`; every field is optional:

  ```json
  { "user": "…", "repo": "~/video-studio", "cache": "~/.cache/video-studio/render",
    "hosts": { "<peer name>": { "address": "…", "user": "…", "repo": "…", "cache": "…" } } }
  ```

  A host's own entry wins, then `AVG_RENDER_SSH_USER`, `AVG_RENDER_ENGINE_REPO` and `AVG_RENDER_ENGINE_CACHE`, then the file's defaults. With no user, `ssh` and its own config decide. The address is the entry's, else the peer's tailnet IPv4, else the name. `AVG_RENDER_SSH` names the ssh program. The clone defaults to `~/video-studio`, and the cache root to `$XDG_CACHE_HOME/video-studio/render`.

A render goes like this:

1. **Code.** The engine renders with this clone's `HEAD`. A render is refused (`dirty-code`) while `packages/remotion-composer`, `packages/render-worker`, `package.json` or `bun.lock` has uncommitted changes. When the engine is not at that commit, the commit is pushed to `refs/render-worker/incoming`, checked out as branch `engine`, and `engine.sh sync <sha>` runs. That step runs `bun install --frozen-lockfile` when the manifests changed and rebuilds the composer's `dist` when its sources did. A machine whose clone cannot answer yet is bootstrapped the same way.
2. **Files.** Every asset, shared-root file and kit is hash-checked against the timeline (`hash-mismatch`, `missing-file`). Each one is mirrored under `files/` by its absolute local path: `F:\a\b` becomes `files/F/a/b`, and a UNC path becomes `files/unc/…`. The timeline's paths are rewritten only where the engine could not read them as they are. `diff` takes the manifest (`[{path, size, hash}]`) and answers with what is missing. `receive` takes a bundle: per file, one JSON header line `{path, size, hash}` followed by its raw bytes. Each file is checked on arrival, so an unchanged file never travels twice.
3. **Render.** `render <key>` reads the job (the timeline, roots and kits in `files/` terms) on stdin. It writes progress on stderr and the result JSON on stdout. Kits are loaded from the mirrored files, which are the same bytes, by hash, that the local render would load. `fetch <key>` streams `out.mp4` back, and the video is checked against the result's hash before it is moved to `outputPath`.

Each episode has its own folder on the engine, `<cache root>/<channel>/<series>/<episode>`. It holds `files/`, `index.json`, `cache/` (renderTimeline's `cacheDir`), `render.lock`, and `out.mp4`, which is written as `out.partial.mp4` until it is complete. Nothing is shared between episodes, and nothing is removed.

Errors keep their codes (`no-engine`, `dirty-code`, `code-sync-failed`, `engine-busy`, `timeline-invalid`, …) and their `problems`. The engine compares its binaries with `engine.env`'s pins and warns when they differ. Those pins live only in `engine.env`.

## Sharing a render between machines

`pva_compose_video` also takes `hosts`, a list of machines (`local` is this one, the others as for `host`), and an optional `assembleOn` (`local` by default, and it need not be in `hosts`). It is used only when the operator asks for it. `sharedRenderer` splits the video's one-second segments into contiguous runs, one per machine in order, and each machine draws its run in parallel: `local` into `<outputPath>.shared`, an engine with a `drawOnly` job into its `drawn/`. The assembler then joins every segment, adds the audio, normalises loudness and writes the mp4; only the assembler readies the soundtrack.

Segments travel through this machine. `send-drawn <key>` streams the segments an engine drew, as a bundle rooted at `drawn/`, and each one is checked against the hash its draw answered (`not what it drew`). `receive-drawn <key>` puts them in a remote assembler's `drawn/`. The assembler's job names every segment it should find there, by hash, its own included, so a missing or changed one fails with `missing-file` or `hash-mismatch` before anything is joined. Segments encoded on different systems (Windows and Linux) cannot be joined, and the join refuses them. A failed share fails the whole render and removes `<outputPath>.shared`.
