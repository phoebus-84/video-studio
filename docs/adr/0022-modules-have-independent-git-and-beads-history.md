# Modules have independent Git and Beads history

Each system module is an independent Git repository and Beads workspace with its own release and dependency-aware plan. Integration happens through versioned contracts rather than a shared monorepo build, accepting additional release coordination in exchange for replaceable adapters, independently testable boundaries, and the user's requirement that the studio remain a collection of tools and Pi packages rather than one application.
