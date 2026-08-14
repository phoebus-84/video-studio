/**
 * TypeScript bindings generated from error-envelope.schema.json
 * Schema: https://video.studio/schemas/v1alpha1/error-envelope.schema.json
 * Auto-generated — do not edit directly.
 */

export interface ErrorBody {
  /** Machine-readable error code. SCREAMING_SNAKE_CASE or dotted.namespace style (e.g. 'WORKSPACE_CHANNEL_MISMATCH' or 'workspace.channel-mismatch'). */
  code: string;
  /** Human-readable error description. */
  message: string;
  /** Whether the caller should retry this operation. */
  retryable: boolean;
  /** Optional structured details (field paths, values, context). */
  details?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  apiVersion: "studio.video/v1alpha1";
  kind: "ErrorEnvelope";
  error: ErrorBody;
  /** Correlation ID linking the error to the originating request or event. */
  correlationId: string;
  /** When the error was generated. */
  at: string;
}
