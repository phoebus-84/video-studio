// ---------------------------------------------------------------------------
// OpenAPI annotations on route schemas.
//
// Routes across this gateway annotate `schema` with `description` and `tags`.
// Fastify accepts them at runtime — it ignores schema keys it does not know —
// but its own `FastifySchema` only declares body, querystring, params, headers
// and response. The missing declarations normally arrive with
// `@fastify/swagger`, which this package does not depend on, so the
// annotations were untyped and four routes failed to compile.
//
// Declaring them here keeps the documentation on the routes where it belongs.
// If `@fastify/swagger` is ever added, its augmentation supersedes this file
// and `/docs` starts serving these descriptions for real.
// ---------------------------------------------------------------------------

import "fastify";

declare module "fastify" {
  interface FastifySchema {
    /** Human-readable description of what the route does. */
    description?: string;
    /** Short summary, shown in generated API listings. */
    summary?: string;
    /** Grouping tags, e.g. ["editor"]. */
    tags?: string[];
    /** Stable operation identifier for generated clients. */
    operationId?: string;
    /** Marks the route as deprecated in generated documentation. */
    deprecated?: boolean;
    /** Excludes the route from generated documentation. */
    hide?: boolean;
  }
}
