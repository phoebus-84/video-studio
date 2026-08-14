# Contributing to pi-video-agent

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) or Node.js 20+
- [Pi coding agent](https://pi.dev) (latest stable)

### Clone and Install

```bash
git clone <repo-url>
cd pi-video-agent
npm install
```

### Running Tests

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode for development
npm run typecheck     # TypeScript type checking
```

### Local Development Install

To use the package during development without publishing:

```bash
# From the pi-video-agent directory:
pi install ./path/to/pi-video-agent

# Or for a one-shot test:
pi -e ./extensions/index.ts
```

### Running Extension Smoke Tests

```bash
# Load the package temporarily and verify it starts without diagnostics:
pi -e ./extensions/index.ts --print "call pva_diagnostics"

# Verify production install path (no devDependencies available):
npm install --omit=dev
# Then load through pi install
```

## Package Structure

```
pi-video-agent/
├── extensions/           # Pi extension entry points
│   └── index.ts          # Main extension (package entry point)
├── skills/               # Skills loaded by Pi
│   └── pva-executive-producer/
│       └── SKILL.md      # Executive producer skill
├── tests/                # Test suite
│   └── ...               # Unit and integration tests
├── package.json          # Package manifest with pi key
├── tsconfig.json         # TypeScript configuration
├── SECURITY.md           # Full-system-access notice
├── CONTRIBUTING.md       # This file
└── README.md             # Public contract documentation
```

## Adding Extensions

1. Create or edit files in `extensions/`.
2. Ensure the entry point exports a default function accepting `ExtensionAPI`.
3. Register tools, commands, and lifecycle handlers.
4. Add tests covering success and failure paths.
5. Update the `pi.extensions` array in `package.json` if needed.

## Adding Skills

1. Create a directory under `skills/` containing a `SKILL.md`.
2. Add frontmatter with `name` and `description`.
3. Document setup instructions, usage patterns, and references.
4. Update the `pi.skills` array in `package.json` if needed.

## Code Style

- TypeScript with strict mode.
- All public APIs must have typed contracts.
- Error messages must be machine-readable and user-actionable.
- No fallback that silently downgrades capability — return typed errors instead.

## Testing Guidelines

- Tests must be deterministic (no network calls, no real paid services).
- Cover success paths and relevant failure paths.
- Test cancellation and restart scenarios where applicable.
- Use vitest for test running.

## Release

1. Ensure all tests pass: `npm test`
2. Ensure typecheck passes: `npm run typecheck`
3. Verify extension loads without diagnostics: `pi -e ./extensions/index.ts`
4. Update `CHANGELOG.md`.
5. Tag and publish.
