# FFmpeg compiles a typed edit timeline

Episodes express editorial decisions in a versioned declarative timeline rather than agent-authored shell commands. A dedicated composer validates that timeline, compiles FFmpeg filter graphs, runs FFmpeg and ffprobe, and emits the deliverable plus a render report; preserving the resolved command gives debuggability without making unsafe, opaque command text the production source of truth.
