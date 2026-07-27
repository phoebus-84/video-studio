# Pipeline Authoring and Skill Conventions

**Version**: 1.0.0
**Phase**: foundation

## Quick Start for Contributors

### Adding a New Pipeline

1. Create `pipelines/<pipeline-id>/manifest.yaml` following [PIPELINE-MANIFEST.md](./PIPELINE-MANIFEST.md)
2. Run `npm run lint:pipeline pipelines/<pipeline-id>/manifest.yaml` to validate
3. Fix any lint errors before committing

### Adding a New Skill

1. Create `skills/<pipeline-id>/<skill-id>/SKILL.md` following [SKILL-FRONTMATTER.md](./SKILL-FRONTMATTER.md)
2. Run `npm run lint:skill skills/<pipeline-id>/<skill-id>/SKILL.md` to validate
3. Fix any lint errors before committing

### Overriding a Pipeline for a Series

1. Read [SERIES-OVERRIDES.md](./SERIES-OVERRIDES.md)
2. Create `series/<series-id>/overrides/pipelines/<pipeline-id>.yaml`
3. Never modify built-in manifests — series overrides are additive

## Documents

| Document                                              | Audience      | Purpose                                           |
|-------------------------------------------------------|---------------|---------------------------------------------------|
| [PIPELINE-MANIFEST.md](./PIPELINE-MANIFEST.md)        | Contributors  | Pipeline YAML schema and semantics                |
| [SKILL-FRONTMATTER.md](./SKILL-FRONTMATTER.md)        | Contributors  | Skill frontmatter schema and progressive disclosure |
| [STAGE-I-O-CHECKLIST.md](./STAGE-I-O-CHECKLIST.md)    | Contributors  | Stage input/output validation rules               |
| [REVIEWER-FORMAT.md](./REVIEWER-FORMAT.md)            | Contributors  | Reviewer skill output format                      |
| [SERIES-OVERRIDES.md](./SERIES-OVERRIDES.md)          | Contributors  | Series-local pipeline customization               |
| [ANTI-PATTERNS.md](./ANTI-PATTERNS.md)                | All           | Catalog of invalid patterns the linter rejects    |

## Lint Rules

Run lint on all fixtures:

```bash
npm run lint
```

Run individual linters:

```bash
npm run lint:pipeline <file.yaml>...
npm run lint:skill <SKILL.md>...
```

Exit codes:
- `0`: all files pass
- `1`: one or more files have lint errors (diagnostics printed to stderr)
- `2`: usage error (missing file, unreadable)

## Schemas

Machine-readable JSON schemas are available in `schemas/`:
- `pipeline-manifest.schema.yaml` — validates pipeline manifests
- `skill-frontmatter.schema.yaml` — validates skill frontmatter
