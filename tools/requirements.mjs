// Live readiness shared by composition and doctor. Never infer readiness from
// the installation-time snapshot after credentials/binaries have changed.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

export function resolveBinary(name, component) {
  if (name === "blender") {
    if (process.env.BLENDER_BIN) return process.env.BLENDER_BIN;
    const mac = "/Applications/Blender.app/Contents/MacOS/Blender";
    if (process.platform === "darwin" && existsSync(mac)) return mac;
  }
  // Only the Blender adapter currently honours this override. Do not report
  // other composition providers ready because of an executable they never use.
  if (name === "ffmpeg" && component?.path === "packages/blender" && process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  return name;
}
export function hasBinary(name, component) {
  const bin = resolveBinary(name, component);
  try {
    if (name === "blender") {
      const out = execFileSync(bin, ["--version"], { encoding: "utf8", timeout: 10000 });
      const match = out.match(/Blender (\d+)\.(\d+)/);
      return !!match && (
        (Number(match[1]) === 4 && Number(match[2]) >= 2) ||
        (Number(match[1]) === 5 && Number(match[2]) === 2)
      );
    }
    if (process.platform === "win32") execFileSync("where", [bin], { stdio: "ignore", timeout: 5000 });
    else execFileSync("/bin/sh", ["-c", 'command -v -- "$1"', "sh", bin], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch { return false; }
}
export function checkRequirements(component) {
  const missing = [];
  for (const name of component.requires?.system ?? []) {
    if (!hasBinary(name, component)) missing.push({ kind: "system", name });
  }
  for (const name of component.requires?.env ?? []) {
    if (!process.env[name]) missing.push({ kind: "env", name });
  }
  return missing;
}
