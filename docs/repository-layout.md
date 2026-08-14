# Repository layout

## The line

```
packages/     reusable outside this project
studio/       the product, built on packages/
skills/       shared/ for any workflow, studio/ for production stages
tools/        workspace tooling (compose, checks, doc generation)
docs/         all documentation
```

The split exists because some of these pieces are tools in their own right. A
speech synthesizer is a speech synthesizer. That this studio uses it to narrate
episodes is the studio's business, not the tool's.

So the rule is one-directional:

> **`packages/*` may not depend on `studio/*`.**

`npm run check:boundaries` enforces it, failing on a declared `@studio/*`
dependency, a `@studio/*` import, or any workspace reaching into another by
relative path. See [ADR-0032](adr/0032-single-repository-with-reusable-packages.md).

## Where does my code go?

| If it… | It goes in |
|---|---|
| …could be useful to someone who never heard of this studio | `packages/` |
| …knows what an episode, series, pipeline or stage is | `studio/` |
| …connects a package to the studio's contracts | `studio/agent` |
| …teaches Pi a technique reusable in other workflows | `skills/shared/` |
| …teaches Pi how to perform a production stage | `skills/studio/` |

The third row is the one people get wrong. When `packages/voice` needs to
produce narration segments that satisfy the studio's narration contract, that
translation is studio work. It goes in `studio/agent`, and `packages/voice`
stays a voice tool.

## Naming

| Scope | Meaning |
|---|---|
| `@av/*` | reusable package |
| `@studio/*` | part of the product |

The scope tells you which side of the line you are on, so a wrong import is
visible while reading, before any tool runs.

Two names deliberately differ from their directory:

- `studio/agent`'s npm package is `@studio/agent`, but the **Pi extension
  identity** it registers is still `pi-video-agent`. That name is user-facing.
- `packages/voice` is a Python project; its distribution name lives in its own
  `pyproject.toml` and is not part of the Bun workspace.

## History

All eleven predecessor repositories were imported with `git subtree`, so
`git log --follow` works across the move and 335 commits of history survive.
