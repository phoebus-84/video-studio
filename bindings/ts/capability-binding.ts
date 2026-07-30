/**
 * TypeScript bindings generated from capability-binding.schema.json
 * Schema: https://video.studio/schemas/v1alpha1/capability-binding.schema.json
 * Auto-generated — do not edit directly.
 */

export type AdapterTransport = "in-proc" | "http";

export type BindingDecision = "pi" | "user" | "default";

export interface CapabilityBinding {
  apiVersion: "studio.video/v1alpha1";
  kind: "CapabilityBinding";
  capability: "image.generate" | "image.edit" | "speech.synthesize" | "graphics.render" | "terminal.record" | "video.compose" | "media.probe";
  /** Provider identifier (e.g. 'fal-ai', 'qwen-tts', 'studio-graphics-renderer'). */
  provider: string;
  adapter: unknown;
  /** Model/profile identifier (e.g. 'fal-ai/nano-banana-pro@v1', 'qwen3-tts/v1'). */
  profile: string;
  decidedBy: BindingDecision;
  decidedAt: string;
  /** Optional reference to the approval event or review thread that authorized this binding. */
  approvalRef?: string;
}
