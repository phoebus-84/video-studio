export { remoteRenderer, type RemoteRendererOptions, type RemoteRenderResult } from "./remote.js";
export {
  DEFAULT_REPO, engineCommand, engineTarget, findEngine, findPeer, mayBeEngine, parseTailscaleStatus, probeEngine, readHostsConfig, tailscalePeers, tailscalePrograms,
  type EngineTarget, type FoundEngine, type HostSettings, type HostsConfig, type Probe, type TailscalePeer,
} from "./hosts.js";
export { gitRemote, INCOMING_REF, localGit, RENDER_CODE, renderCommit, syncCode, type Git } from "./code-sync.js";
export { prepareJob, sha256File, type JobFile, type PreparedJob } from "./files.js";
export { defaultCacheRoot, pinMismatches, readPins, runEngine, type EngineContext, type EngineIO } from "./engine.js";
export {
  checkJobPath, checkKey, decodeBundle, encodeBundle, lastJsonLine, mirrorPath, PROTOCOL_VERSION, RenderWorkerError,
  type BundleSink, type EngineVersion, type ManifestEntry, type RenderJob, type RenderWorkerErrorCode,
} from "./protocol.js";
export { shellPath, shellQuote, SSH_FAILED, sshArgs, sshExec, type Exec, type ExecInput, type ExecResult } from "./ssh.js";
