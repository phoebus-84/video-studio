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

Analyze a pinned source repository to produce a documentation plan.

## Analysis Sections
1. **Project Overview** — What it does, primary language, license
2. **Architecture** — High-level architecture pattern, key abstractions
3. **Module Map** — Directory structure with module descriptions
4. **Key Files** — Most important source files and their roles
5. **Dependencies** — External libraries and frameworks
6. **Build System** — How to build, test, and contribute

## Output
```json
{
  "repository": {
    "name": "...",
    "url": "...",
    "commit": "abc123",
    "language": "TypeScript",
    "license": "MIT"
  },
  "architecture": {
    "pattern": "modular monolith",
    "layers": ["..."]
  },
  "modules": [
    { "path": "src/core", "purpose": "...", "complexity": "high" }
  ],
  "key_files": [
    { "path": "src/index.ts", "role": "entry point" }
  ]
}
```
