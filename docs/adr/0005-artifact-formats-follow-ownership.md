# Artifact formats follow ownership

Human-authored editorial artifacts use Markdown with YAML frontmatter, declarative pipeline and timeline structures use YAML, machine-generated manifests and reports use JSON, and execution history uses JSONL. Each concept has one canonical representation, and derivatives record source artifact revisions so direct GUI or filesystem edits can mark downstream narration, visuals, and renders stale without destroying prior attempts.
