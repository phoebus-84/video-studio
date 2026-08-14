# Wire and workspace conventions

## Names

- JSON/YAML properties: `camelCase`.
- Schema `$defs` and `kind` values: `PascalCase`.
- Stable IDs: opaque lowercase type prefix plus sortable/random payload, for example `ep_01J...`; consumers compare but do not parse payloads.
- Human slugs and file/directory names: lowercase kebab-case. Slugs are labels, never identity.
- Event types and capabilities: lowercase dot-separated names, for example `stage.attempt.completed` and `speech.synthesize`.
- Namespaced extension keys: reverse-DNS/package style.

## Time and duration

- Instants: RFC 3339 UTC strings with `Z`, preserving sub-second precision when supplied.
- Durations and timeline positions: integer microseconds in machine contracts (`durationUs`, `startUs`). Human YAML helpers may accept documented seconds but must normalize before snapshotting.
- Frame locations require both time and the output profile/frame-rate context; floating-point frame math is not canonical.

## Money

Money is `{ currency: "USD", micros: integer }`. Floating-point dollar values are prohibited in durable ledgers. Estimates, reservations, and actuals remain separate amounts with separate IDs.

## Paths and URIs

- Workspace paths are POSIX-style relative paths using `/`, even on platforms with another native separator.
- Absolute paths, `..`, empty segments, NUL, and traversal through symlinks are rejected at trust boundaries.
- External sources use normalized URIs plus provenance. Credentials and signed query strings are never persisted as canonical provenance.
- A media reference pairs relative path with a content hash; path alone is not integrity.

## Hashes and media

Content hashes use lowercase multibase-compatible algorithm labels and hex/base encoding selected by the identity schema; the initial required algorithm is SHA-256. MIME types are lowercase IANA media types. Width, height, sample rate, channels, duration, and codec are measured report data, not guessed from file extensions.

## Null, omission, and defaults

Omission means not supplied. `null` is allowed only where it has a specified domain meaning. Defaults are applied by the resolving producer and materialized in immutable snapshots; consumers do not independently invent defaults.

## Ordering

Arrays are ordered only when order is semantically meaningful. Maps are not ordered. Deterministic serializers sort map keys for hashes and fixtures but must not turn that serialization order into domain behavior.
