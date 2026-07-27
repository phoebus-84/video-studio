// ---------------------------------------------------------------------------
// Structured result and error conventions
//
// Every recoverable operation returns a Result<T, E> so callers cannot
// silently ignore failure.  Unrecoverable invariants (programmer errors) use
// standard throws.
// ---------------------------------------------------------------------------

/** Discriminated success variant. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** Discriminated error variant. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** Monadic result type inspired by Rust's `Result`. */
export type Result<T, E = Error> = Ok<T> | Err<E>;

// ---- Constructors ----------------------------------------------------------

/** Create a success result. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Create an error result. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

// ---- Guards -----------------------------------------------------------------

/** Type-narrowing guard for success results. */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** Type-narrowing guard for error results. */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

// ---- Combinators -----------------------------------------------------------

/**
 * Map the success value through `fn`.  Errors pass through unchanged.
 */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  if (result.ok) {
    return ok(fn(result.value));
  }
  return result;
}

/**
 * Map the error value through `fn`.  Success values pass through unchanged.
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  if (!result.ok) {
    return err(fn(result.error));
  }
  return result;
}

/**
 * Chain a fallible operation.  Short-circuits on error.
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
}

/**
 * Unwrap the success value or return `defaultValue` on error.
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.ok) {
    return result.value;
  }
  return defaultValue;
}

/**
 * Unwrap the success value.  Throws if `result` is an error.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw new AggregateError(
    [result.error],
    "unwrap called on an Err result",
  );
}
