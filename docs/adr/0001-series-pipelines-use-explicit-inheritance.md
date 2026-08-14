# Series pipelines use explicit inheritance

Series-specific pipelines inherit project-provided pipeline definitions and patch stages by stable identity instead of relying on copied manifests or implicit deep merges. This keeps customization concise while making inserted, replaced, disabled, and reconfigured stages auditable; every episode stores a resolved immutable pipeline snapshot so later definition changes cannot silently alter an existing production.
