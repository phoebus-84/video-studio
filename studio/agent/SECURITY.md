# Security Notice

## Full-System-Access Implications

**This Pi package runs with full system access.** Pi extensions execute arbitrary
TypeScript/JavaScript code with the same permissions as the Pi process itself. Skills
included in this package can instruct the model to perform any action, including
executing arbitrary executables via the `bash` tool.

### What This Means

- **Extensions (code)**: The extension in `extensions/index.ts` runs inside the Pi
  process and has access to the file system, network, environment variables, and any
  local resources available to the user running Pi.

- **Skills (instructions)**: Skills in `skills/` are markdown documents that Pi loads
  as context. The model may follow these instructions to execute commands, read and
  write files, or call external APIs — all with the user's permissions.

- **Tools**: Custom tools registered by this package run inside Pi and can perform
  any operation the Pi process permits.

### Before Installing

1. **Review the source code** of `extensions/` and any bundled dependencies. This
   package's source is available in the repository where it is distributed.

2. **Understand the trust model**: Installing a Pi package is equivalent to running
   third-party code on your machine. Only install packages from sources you trust.

3. **Check dependencies**: Examine `package.json` for runtime dependencies and
   understand what each dependency does.

4. **Use project-local installs**: If you only need this package for a specific
   project, install it as a project-local package (using the `-l` flag) rather than
   globally.

### Package Scope

The pi-video-agent package:
- Registers Pi extension tools for video production coordination.
- Provides skills that guide the model through production workflows.
- Does **not** bundle or distribute any video content, media files, or user data.
- Does **not** establish outbound network connections at load time. Any network
  access (e.g., to studio services) is deferred until explicitly invoked by the
  user through tools or commands.

### Reporting Issues

If you discover a security concern in this package, please report it through the
repository's issue tracker or contact the maintainers directly.

---

*This notice is maintained alongside the package. If you modify or redistribute
this package, you must update this notice to reflect any new capabilities,
dependencies, or access patterns.*
