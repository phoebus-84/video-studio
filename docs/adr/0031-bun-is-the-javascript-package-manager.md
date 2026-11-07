# Bun is the package manager for all TypeScript modules

## Status

Accepted.

## Decision

All TypeScript modules standardize on Bun: `bun.lock` is the only lockfile, `package-lock.json` files are deleted, and install/test/build commands in READMEs and scripts use `bun` / `bunx`. Python modules (qwen-tts-worker) are unaffected. This removes the current mixed state where several modules carried both lockfiles and CI commands disagreed with local development.
