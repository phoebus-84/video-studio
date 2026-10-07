// dentro-i-versi@1.0.0 — released: never edit this file; add dentro-i-versi/<next>.ts instead (ADR-0039).
// The colours of "Dentro i versi" (CreativeStudio's poesie-museo runtime):
// the hall's ink and accents, and the titles' light-on-dark palette.
// Channel specifics in code — accepted for now; avg-d1x moves them to the library.

/** The hall and the verses. */
export const HALL = {ink: '#0c1230', ink2: '#2b3766', accent: '#5a3fd6', cyan: '#3fc8f0', led: '#e9fbff'} as const;
/** The titles. */
export const TITLES = {text: '#f6f8ff', dim: 'rgba(244,247,255,.92)', cyan: '#5fdcff', amber: '#ffbf5e', ice: '#bfefff', plate: 'rgba(8,12,36,.92)', chip: 'rgba(8,12,36,.86)', pill: 'rgba(8,12,36,.72)'} as const;
/** The glass, the lightning and the teleport. */
export const LIGHT = {line: 'rgba(255,255,255,.62)', cyan: '#5fdcff', ice: '#bfefff', violet: '#c3b8ff'} as const;
/** The titles' text shadow. */
export const TEXT_SHADOW = '0 2px 3px rgba(6,10,32,.85), 0 0 14px rgba(6,10,32,.55)';
