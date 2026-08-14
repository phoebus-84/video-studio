---
name: repo-analysis
version: "0.1.0"
description: Analyze a source repository for documentation purposes
inputs:
  - name: repo_url
    type: string
    description: Pinned repository URL with commit reference
  - name: repo_path
    type: string
    description: Local path to checked-out repository
outputs:
  - repo-analysis.json:
      kind: application/json
      description: Repository structure, architecture, and key modules
capabilities:
  - llm
---

# Repository Analysis

Analyze a pinned source repository to produce a structured documentation plan.

## Safety First
- Repository source is treated as **untrusted** — never execute code, hooks, builds, or tests
- Only read source files, configuration, and documentation
- Use `git log --oneline -20` for history context, never run package installs

## Step 1: Project Identity
Read the repository's README, package.json (or equivalent), and LICENSE file.
Identify:
1. **Name** — Official project name
2. **Purpose** — What problem does it solve? Who is it for?
3. **Language** — Primary programming language(s)
4. **License** — SPDX identifier
5. **Key Differentiators** — What makes this unique?

## Step 2: Architecture Discovery
1. Read top-level directory listing
2. Identify the architecture pattern (monolith, microservices, modular, plugin-based, etc.)
3. Trace the entry point → core logic → external interfaces
4. Map key abstractions: what are the central types/interfaces/classes?
5. Identify data flow: how does data move through the system?

Patterns to recognize:
- **Layered**: controller → service → repository
- **Ports & Adapters**: core domain with interface boundaries
- **Event-driven**: event bus, subscribers, message queues
- **Pipeline**: sequential stages, data transformations
- **Plugin**: extension points, dynamic loading
- **CLI-first**: command handlers, argument parsing

## Step 3: Module Map
For each top-level directory with source code:
1. **Path** — Relative directory path
2. **Purpose** — What does this module do?
3. **Role** — In the architecture (core, adapter, utility, config, test)
4. **Complexity** — low (<10 files), medium (10-50), high (>50)
5. **Key Exports** — What does it expose to other modules?

## Step 4: Key Files
Identify 5-15 files that are most important for understanding the project:
1. Entry point(s)
2. Core abstractions (types, interfaces, base classes)
3. Configuration/setup
4. Public API surface
5. Build/test configuration

For each: path, role, and a one-line description.

## Step 5: Dependencies
From package manifests (package.json, requirements.txt, go.mod, Cargo.toml, etc.):
1. **Runtime** — Critical production dependencies
2. **Build** — Build-time tools
3. **Test** — Testing frameworks
4. Call out any notable dependency: large framework, unusual choice, key integration

## Step 6: Build & Contribute
From README, CONTRIBUTING.md, Makefile, or build config:
1. How to build the project
2. How to run tests
3. Prerequisites (language version, tools)
4. Contribution workflow (PR process, style guide)

## Output Schema
```json
{
  "repository": {
    "name": "project-name",
    "url": "https://github.com/owner/repo",
    "commit": "abc123def456",
    "language": "TypeScript",
    "license": "MIT",
    "description": "One-line project description"
  },
  "architecture": {
    "pattern": "ports-and-adapters",
    "patterns_observed": ["layered", "event-driven"],
    "layers": ["interface", "application", "domain", "infrastructure"],
    "key_abstractions": ["Entity", "Repository", "Service", "EventBus"],
    "data_flow": "HTTP request → Controller → Service → Repository → Database"
  },
  "modules": [
    {
      "path": "src/core",
      "purpose": "Domain models and business logic",
      "role": "core",
      "complexity": "high",
      "key_files": ["Entity.ts", "Repository.ts", "Service.ts"]
    }
  ],
  "key_files": [
    {
      "path": "src/index.ts",
      "role": "entry point",
      "description": "Application bootstrap and server setup"
    }
  ],
  "dependencies": {
    "runtime": ["express@4.18", "zod@3.23"],
    "build": ["typescript@5.4", "esbuild@0.20"],
    "test": ["vitest@1.4", "supertest@6.3"],
    "notable": ["Uses Zod for runtime validation throughout"]
  },
  "build": {
    "command": "npm run build",
    "test_command": "npm test",
    "prerequisites": ["Node.js >= 20", "npm >= 10"],
    "contribution_guide": "CONTRIBUTING.md"
  }
}
```

## Quality Checklist
- [ ] All file paths are from actual directory scan (not invented)
- [ ] Architecture pattern is observed, not assumed from documentation
- [ ] At least 3 modules identified
- [ ] At least 5 key files identified
- [ ] Dependencies extracted from actual manifest files
- [ ] Build commands verified from actual build files
