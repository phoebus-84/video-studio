# MVP captions use narration-segment timing

The MVP derives captions from revision-linked Narration Segments and their measured placement in the edit timeline rather than adding a speech-alignment dependency. This gives deterministic sentence- or phrase-level captions for generated narration; word-level highlighting is deferred until an aligner can be introduced as a separate capability without coupling TTS generation to subtitle mechanics.
