export type ArchiveErrorCode =
  | "provider-unknown" | "provider-disabled" | "not-found" | "http" | "bad-response"
  | "licence-refused" | "too-small" | "wrong-type" | "too-large" | "no-file";

export class ArchiveError extends Error {
  constructor(readonly code: ArchiveErrorCode, message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}
