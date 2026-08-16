# @av/terminal-recorder

Records a terminal session to video from a [VHS](https://github.com/charmbracelet/vhs) tape.

Provides the `terminal.record` capability. Useful on its own: it knows about
tapes and output files, and nothing about episodes, scenes or pipelines.

```ts
import { probe, record } from "@av/terminal-recorder";

if (probe().available) {
  const { outputPath, bytes, tapePath } = record({
    tape: { content: `Type "make build"\nEnter\nSleep 3s\n` },
    outputPath: "./out/build.mp4",
  });
}
```

## Behaviour worth knowing

- The tape is written **beside the recording**. A recording whose script is
  gone cannot be reproduced or reviewed.
- The `Output` directive is set to the requested filename. A tape without one
  writes `out.gif` somewhere the caller never looks; one pointing elsewhere
  writes silently to the wrong place.
- A missing recorder, a timeout, and a run that exits zero without producing a
  file are distinct errors, each carrying what to do about it. A tape that
  waits on input never finishes, so the timeout is not optional.

## Requirements

`vhs` on PATH: `brew install vhs ttyd`.
