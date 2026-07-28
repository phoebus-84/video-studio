/**
 * Simple reactive refresh trigger shared between components.
 * Increment to signal that components should re-fetch data.
 */
let _tick = $state(0);

export const reviews = {
  get tick() { return _tick; },
  refresh() { _tick++; },
};

let _libraryTick = $state(0);

export const library = {
  get tick() { return _libraryTick; },
  refresh() { _libraryTick++; },
};
