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
import { resolveConfig, checkServiceHealth } from "../src/config.js";
import { registerWorkspaceTools } from "../src/workspace-tools.js";
import { registerPipelineTools } from "../src/pipeline-tools.js";
import { registerCapabilityTools } from "../src/capability-tools.js";
import { registerBlenderTools } from "../src/blender-tools.js";
import { registerArchiveTools } from "../src/archive-tools.js";
import { registerSourceTools } from "../src/source-tools.js";
import { registerSkillTools } from "../src/skill-tools.js";
import { registerSlashCommands } from "../src/slash-commands.js";
import { registerTuiComponents } from "../src/tui-status.js";
import { registerRpcHardening } from "../src/rpc-hardening.js";

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

    // Say up front whether the studio can see what this session will produce.
    // The agent resolves its library root from the working directory unless
    // AVG_LIBRARY_ROOT says otherwise, so starting Pi one directory over sends
    // a whole episode somewhere the gateway does not serve — silently, because
    // from the agent's side nothing is wrong. Probed rather than awaited: a
    // slow or absent gateway must not delay the session.
    void (async () => {
      try {
        const config = await resolveConfig();
        const { health } = await checkServiceHealth(config);
        const visibility = health["library-visibility"];
        if (visibility && !visibility.available) {
          ctx.ui.notify(visibility.message, "warning");
        }
      } catch {
        // Advisory only. Never fail a session over a diagnostic.
      }
    })();
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

  // --- Tool: pva_config ------------------------------------------------

  pi.registerTool({
    name: "pva_config",
    label: "PVA Configuration",
    description:
      "Resolve the Agentic Video Studio configuration including library root, gateway URL, and service endpoints. Never logs secret values.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const config = await resolveConfig();

      // Strip secrets from output
      const safe = {
        libraryRoot: config.libraryRoot,
        gatewayUrl: config.gatewayUrl,
        gatewayToken: config.gatewayToken ? "***" : "<not set>",
        falKeyRef: config.falKeyRef ? "***" : "<not set>",
        ttsWorkerUrl: config.ttsWorkerUrl,
        graphicsRendererPath: config.graphicsRendererPath,
        ffmpegComposerPath: config.ffmpegComposerPath,
        resolved: config.resolved,
        diagnostics: config.diagnostics,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(safe, null, 2),
          },
        ],
        details: { config: safe },
      };
    },
  });

  // --- Tool: pva_health -------------------------------------------------

  pi.registerTool({
    name: "pva_health",
    label: "PVA Health Check",
    description:
      "Check the health of all configured studio services (library, gateway, TTS worker).",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const config = await resolveConfig();
      const clients = await checkServiceHealth(config);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(clients, null, 2),
          },
        ],
        details: { health: clients },
        isError: !clients.healthy ? true as unknown as boolean : undefined,
      };
    },
  });

  // --- Register workspace tools ----------------------------------------

  registerWorkspaceTools(pi);

  // --- Register pipeline tools ------------------------------------------

  registerPipelineTools(pi);

  // --- Register capability tools ----------------------------------------

  registerCapabilityTools(pi);
  registerBlenderTools(pi);
  registerArchiveTools(pi);
  registerSourceTools(pi);

  // --- Register skill and context tools ---------------------------------

  registerSkillTools(pi);

  // --- Register slash commands ------------------------------------------

  registerSlashCommands(pi);

  // --- Register TUI components ------------------------------------------

  registerTuiComponents(pi);

  // --- Register RPC hardening -------------------------------------------

  registerRpcHardening(pi);
}
