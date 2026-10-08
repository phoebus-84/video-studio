# Dentro i versi · short — version 1.0.0

Rewritten from CreativeStudio's `poesie-museo-short` standard (version 1.4.0,
runtime `sala8`; approved references San Martino and Il lampo). Compiler and
validator: `dentro-i-versi-short@1.0.0`.

## Standard

The style, direction, script and edit are final: every episode reproduces
the references and only the poem's data changes. A requested change needs a
new template version and its reason written here.

- **Contract.** Italian; 1080×1920 at 30 fps; 25–90 s. No host, no call to
  action. The first and the last frame are the empty hall with the title, so
  the video loops. Structure: the title said, the whole poem recited in a
  science-fiction museum hall, applause.
- **Hall.** A white room without windows (`hall.room`), a vertical screen
  (620×910 at x 360, y 215) with the poem's pictures and their slow camera
  moves; lightning in the hall only at picture changes.
- **Titles.** The «DENTRO I VERSI» mark; a dark lower third (kicker, Anton
  title on one or two lines, cyan rule, author) at the opening and at the
  bow, never wider than the space left of the actor; a compact title chip
  during the poem. No information nobody asked for (dates, feasts,
  anecdotes).
- **Verses.** One plate per verse at the bottom left, Fraunces italic: the
  whole verse visible, words not yet said dimmed then lit, strong words in
  bold violet; the paraphrase (Inter) readable from the verse's start until
  the next verse. No movement or glow.
- **Actor.** The interprete in the costume the spec gives, x 770, scale
  0.95, inside the camera and above the plates (hands may pass in front of a
  plate, never off screen). Teleport in under the title and out after the
  bow, each with a magic sound.
- **Cover.** The first picture is also the thumbnail: strong and readable
  small.
- **Effects.** Chosen from the text, rich but sober in movement: `wind`
  (wind, storm), `shake` (a start, a scream), `shatter` (ruin), `blackout`
  and `bolt` (dark, night); in the room, two apparitions of at least 5 s
  (cut-out silhouettes, free area on the left, away from the body) and
  scene effects born from the poem's images (`nebbia-sala`, `vapore`,
  `note`, `foglie`, `uccelli`, `incanto`). One sound per effect.
- **Voice.** A female voice says the title; a male voice recites the poem
  in one take with the exact text on screen; about 1 s between title and
  poem; measured pauses between verses, longer at the end of a stanza.

## Procedure

Instantiate the pinned draft and fill every `__FILL__`: the poem's verses
with strong words and paraphrase, the pictures (`assets/images`) with their
times and effects, the actor's costume, poses, expressions and gazes, the
lights, the hall's effects, the room effects, the sounds
(`assets/sounds`), applause and music. Times are seconds or `verse:N`,
`verseEnd:N`, `word:parola`, `end`, `picture:N`, each with an optional
`±seconds`. Record the title and recital takes in the unit `recital` (title
first), align them, compile, review the layout sheet (teleports,
apparitions, every verse), render, and seek the user's approval before
publishing. Never invent approval or silently change the voice or profile.
