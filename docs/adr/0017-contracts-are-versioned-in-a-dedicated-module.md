# Contracts are versioned in a dedicated module

Workspace, pipeline, provider-job, timeline, event, and RPC payload schemas live in a dedicated language-neutral contracts module with semantic versions, compatibility fixtures, and generated TypeScript and Python bindings. This adds release discipline but prevents independently versioned modules from drifting into mutually unreadable files or events.
