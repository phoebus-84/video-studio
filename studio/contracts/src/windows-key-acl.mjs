// Windows mode bits do not describe who can read a file. Refuse broad ACLs
// rather than silently skipping the operator-key privacy boundary.
import { execFileSync } from "node:child_process";

export function assertPrivateWindowsAcl(acl) {
  const privileged = new Set([acl?.current, "S-1-5-18", "S-1-5-32-544"]); // SYSTEM, Administrators
  if (typeof acl?.current !== "string" || !/^S-1-/.test(acl.current) || acl.owner !== acl.current || !Array.isArray(acl.access)) throw new Error("Operator key permissions: cannot verify the Windows owner/ACL");
  for (const entry of acl.access) {
    if (typeof entry?.sid !== "string" || typeof entry.allow !== "boolean" || (entry.allow && !privileged.has(entry.sid))) throw new Error("Operator key permissions: Windows ACL grants access to another identity. Restrict it to the current user, SYSTEM and Administrators with icacls.");
  }
}
export function checkWindowsKeyAcl(file) {
  // The path is an environment value, never interpolated into PowerShell code.
  const script = `$ErrorActionPreference = 'Stop'; try {
    $a = Get-Acl -LiteralPath $env:AVG_ACL_CHECK_FILE;
    $sid = [System.Security.Principal.SecurityIdentifier];
    $owner = ([System.Security.Principal.NTAccount]$a.Owner).Translate($sid).Value;
    $access = @($a.Access | ForEach-Object { @{ sid = $_.IdentityReference.Translate($sid).Value; allow = ($_.AccessControlType -eq 'Allow') } });
    @{ owner = $owner; current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; access = $access } | ConvertTo-Json -Depth 5 -Compress
  } catch { exit 1 }`;
  let acl;
  try { acl = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf-8", timeout: 10_000, windowsHide: true, env: { ...process.env, AVG_ACL_CHECK_FILE: file } })); }
  catch { throw new Error("Operator key permissions: Windows ACL verification failed; refusing to read the key"); }
  assertPrivateWindowsAcl(acl);
}
