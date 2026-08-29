# Vendored from upstream

This directory is a verbatim copy of Remotion's official agent skills. Do not
edit the files here — any change is lost at the next refresh.

| | |
|---|---|
| Upstream | https://github.com/remotion-dev/skills |
| Path taken | `skills/remotion-best-practices` |
| Version | 4.0.518 |
| Commit | `7a3d0ca45d2f6a00bf35cb3c525734a36d55a834` |
| Vendored | 2026-08-29 |

## Why this path, and not `npx skills add`

Upstream ships every skill twice: once as flat top-level siblings, and once
nested inside a self-contained `remotion-best-practices` router. We take the
nested form. `syncSkills()` in `tools/compose.mjs` copies each entry of
`skills/shared` into `.pi/skills/`, so one self-contained directory arrives as
one skill, with its own routing intact. The flat form would scatter a dozen
sibling skills into the agent's namespace instead.

## Refreshing

```bash
git clone --depth 1 https://github.com/remotion-dev/skills.git /tmp/remotion-skills
rm -rf skills/shared/remotion-best-practices
cp -R /tmp/remotion-skills/skills/remotion-best-practices skills/shared/
npm run compose -- --profile=full   # re-sync into .pi/skills/
```

Then update the table above, and check the new `version` against the Remotion
release that `packages/infographics` pins. The two drift independently; the
skills describe a release, they do not pin one.
