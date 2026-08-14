// ---------------------------------------------------------------------------
// In-memory pipeline loader for testing
// ---------------------------------------------------------------------------

import type { PipelineDefinition, PipelineLoader } from "./types.js";

/**
 * Map-based pipeline loader.
 * Thread-safe for tests; no filesystem needed.
 */
export class InMemoryPipelineLoader implements PipelineLoader {
  private definitions = new Map<string, PipelineDefinition>();

  /** Register a pipeline definition. */
  register(def: PipelineDefinition): void {
    this.definitions.set(def.name, def);
  }

  /** Remove a pipeline by name. */
  remove(name: string): void {
    this.definitions.delete(name);
  }

  async load(
    name: string,
    _version?: string,
  ): Promise<PipelineDefinition | null> {
    return this.definitions.get(name) ?? null;
  }

  async list(): Promise<string[]> {
    return [...this.definitions.keys()];
  }
}
