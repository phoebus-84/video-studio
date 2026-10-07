export type ComposerErrorCode =
  | 'invalid-timeline'
  | 'unknown-kit'
  | 'bad-props'
  | 'missing-asset'
  | 'hash-mismatch'
  | 'render-failed'
  | 'loudness-failed'
  | 'bad-sheet'
  | 'sheet-failed';

export interface ComposerProblem {
  code: ComposerErrorCode;
  message: string;
  /** JSON path into the timeline, e.g. $.tracks[1].items[0].props.fit */
  path: string;
}

export class ComposerError extends Error {
  constructor(
    readonly code: ComposerErrorCode,
    message: string,
    readonly problems: ComposerProblem[] = [],
  ) {
    super(message);
    this.name = 'ComposerError';
  }
}
