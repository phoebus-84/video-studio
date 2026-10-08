# vpr runs the pipeline the library declares

**Issue:** `avg-sxk`.
**Asked by the user, 2026-10-08:** "why does Il lampo inherit the narrated-illustrated-video pipeline instead of having its own?"
**Date:** 2026-10-08

## Problem

An episode's pipeline is declared in the library: the `pipeline:` key of `pipeline.yaml`, looked up in the episode, then the series, then the channel. The dentro-i-versi series declare `series-production`.

The gateway reads that declaration (`FileSystemWorkspaceService.resolvePipeline`), but `vpr` doesn't. `vpr` uses its hardcoded `DEFAULT_PIPELINE`, `narrated-illustrated-video`, unless `--pipeline` is passed, so on Il lampo:
- `vpr status` and `vpr run` report and claim stages of the wrong pipeline;
- `vpr pin renew` records the wrong `usedBy` stages;
- `vpr` also finds no built-in pipeline at all unless `AVG_BUILTIN_PIPELINES` is set.

Pi's agent manifest (`studio/agent/src/agent.ts`) lists the pipelines without `series-production` or `blender-animation`.

## Decisions

1. **One function in the runtime reads the declaration.** `declaredPipeline(libraryRoot, ref)` lives in `studio/runtime/src/pipeline/declared.ts` and is exported from `@studio/runtime`.
   - It reads `pipeline.yaml` in the episode, the series and the channel, in that order (the contracts' `episodePath`, `seriesPath`, `channelPath`).
   - The first file with a `pipeline:` key wins. It answers `{ name, file }`, where `file` is the declaring file relative to the library root.
   - It answers `null` when no file declares one.
   - It throws `PipelineDeclarationError` instead of guessing in two cases, both naming the file:
     - a file that doesn't parse (`bad-declaration`);
     - a `pipeline:` value that isn't a slug (`bad-name`).

     A file without the key is skipped.
2. **`vpr` resolves a pipeline in one place.** `pipelineFor(args, ref)` in the CLI answers `--pipeline`, else the declaration, else `DEFAULT_PIPELINE`.
   - Every command that used `pipelineName ?? DEFAULT_PIPELINE` uses it: `resolve`, `status`, `pin renew`, `validate pipeline`, `rerun`, `review`, `takes`, `select`, `run` and `complete`.
   - A bad declaration fails the command with exit 2 (`EX_RUNTIME`) and the error's message. Nothing is claimed or written.
   - `completionCommand` keeps carrying only an explicit `--pipeline`. The pasted line resolves the same declaration again.
3. **`vpr` finds the built-in pipelines itself.** `builtinPipelines()` in the CLI answers `AVG_BUILTIN_PIPELINES` when set, else `@studio/pipelines`' `pipelines/` directory resolved through the package, as the gateway's `builtinPipelinesPath`, else `undefined`.
   - `makeLoader`, `makeService` and `serviceLoader` all use it.
   - Only the CLI, the composition root, resolves the package. The runtime library still takes the path as a parameter (`createDefaultLoader`'s comment).
4. **The gateway is unchanged.** It already honours the declaration. Moving it onto `declaredPipeline` touches `filesystem-service.ts`, which holds the user's uncommitted work, so that is left to a follow-up.
5. **Pi's manifest lists every built-in pipeline:** `blender-animation`, `fairy-tale-adaptation`, `narrated-illustrated-video`, `repository-documentation` and `series-production`.

## Testing

- **Unit** (`studio/runtime/test/unit/declared-pipeline.test.ts`):
  - an episode declaration overrides the series one, and a series one overrides the channel one;
  - nothing is declared, giving `null`;
  - a file without the key is skipped;
  - unparsable YAML gives `bad-declaration`;
  - a non-slug name (`../x`) gives `bad-name`.
- **CLI** (spawned `dist/src/cli.js`, as the existing CLI tests):
  - `vpr status` on an episode whose series declares a library pipeline reports that pipeline without `--pipeline`;
  - `--pipeline` still wins;
  - a bad declaration exits 2.
- **Built-ins:** `vpr status --pipeline series-production` on a library without its own pipelines finds the built-in, with `AVG_BUILTIN_PIPELINES` unset.

## Out of scope

- The gateway's own copy of the lookup (decision 4).
- A pipeline declared in `episode-spec.json` or the series template.
