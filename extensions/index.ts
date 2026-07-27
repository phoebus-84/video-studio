/**
 * pi-video-agent — Agentic Video Studio executive producer
 *
 * This is the package entry point. It registers the foundation
 * extension with session lifecycle handlers and version reporting.
 * Child issues will register additional tools, commands, skills,
 * and TUI components.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Module metadata
// ---------------------------------------------------------------------------

const PACKAGE_NAME = "pi-video-agent";

/** Resolved from package.json at load time. */
let packageVersion = "0.1.0";

try {
  // During development this resolves the local package.json.
  // When installed as a Pi package the path is relative to the extension.
  const url = new URL("../package.json", import.meta.url);
  // In tests the URL may not resolve; fall back to the default.
  if (url.protocol === "file:") {
    // Use a static import compatible with jiti / Node resolution.
    // We read the file to avoid depending on JSON import assertions.
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(url, "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    if (pkg.version) packageVersion = pkg.version;
  }
} catch {
  // Keep the default version.
}

// ---------------------------------------------------------------------------
// Typed contracts
// ---------------------------------------------------------------------------

/** Health-check response returned by the `pva_version` tool. */
export interface PvaVersionResult {
  package: string;
  version: string;
  extensions: string;
  skills: string;
  ok: boolean;
}

/** Diagnostics collected during extension load. */
export interface PvaDiagnostics {
  packageName: string;
  packageVersion: string;
  extensionsPath: string;
  skillsPath: string;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Diagnostics builder
// ---------------------------------------------------------------------------

function buildDiagnostics(): PvaDiagnostics {
  const diagnostics: PvaDiagnostics = {
    packageName: PACKAGE_NAME,
    packageVersion,
    extensionsPath: "",
    skillsPath: "",
    errors: [],
    warnings: [],
  };

  try {
    const extUrl = new URL(".", import.meta.url);
    diagnostics.extensionsPath = extUrl.pathname;
  } catch {
    diagnostics.errors.push("Cannot resolve extensions directory URL");
  }

  try {
    const skillsUrl = new URL("../skills/", import.meta.url);
    diagnostics.skillsPath = skillsUrl.pathname;
  } catch {
    diagnostics.errors.push("Cannot resolve skills directory URL");
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
  const diagnostics = buildDiagnostics();
  const bootErrors: string[] = [...diagnostics.errors];
  const bootWarnings: string[] = [...diagnostics.warnings];

  // --- Lifecycle: session_start ----------------------------------------

  pi.on("session_start", (_event, ctx) => {
    const status = bootErrors.length > 0 ? "degraded" : "ready";

    if (bootErrors.length > 0) {
      ctx.ui.notify(
        `${PACKAGE_NAME} ${packageVersion} started with ${bootErrors.length} error(s): ${bootErrors.join("; ")}`,
        "error",
      );
    } else if (bootWarnings.length > 0) {
      ctx.ui.notify(
        `${PACKAGE_NAME} ${packageVersion} started with ${bootWarnings.length} warning(s)`,
        "warning",
      );
    } else if (ctx.mode === "tui") {
      ctx.ui.notify(
        `${PACKAGE_NAME} ${packageVersion} — ${status}`,
        "info",
      );
    }

    ctx.ui.setStatus("pva", `pva ${packageVersion} (${status})`);
  });

  // --- Lifecycle: session_shutdown -------------------------------------

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus("pva", "");
  });

  // --- Tool: pva_version -----------------------------------------------

  pi.registerTool({
    name: "pva_version",
    label: "PVA Version",
    description:
      "Report the package version, extension paths, skill paths, and load-time diagnostics for pi-video-agent.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const result: PvaVersionResult = {
        package: diagnostics.packageName,
        version: diagnostics.packageVersion,
        extensions: diagnostics.extensionsPath,
        skills: diagnostics.skillsPath,
        ok: bootErrors.length === 0,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        details: { pvaVersion: result, diagnostics },
      };
    },
  });

  // --- Tool: pva_diagnostics -------------------------------------------

  pi.registerTool({
    name: "pva_diagnostics",
    label: "PVA Diagnostics",
    description:
      "Return detailed load-time diagnostics for pi-video-agent including any errors or warnings.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const merged = {
        ...diagnostics,
        errors: [...bootErrors],
        warnings: [...bootWarnings],
      };

      const hasIssues = merged.errors.length > 0 || merged.warnings.length > 0;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(merged, null, 2),
          },
        ],
        details: { diagnostics: merged },
        isError: hasIssues
          ? (undefined as unknown as boolean)
          : undefined,
      };
    },
  });
}
