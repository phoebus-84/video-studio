# Remotion Infographic Renderer

A deterministic, local motion-graphics module for technical explainers. It turns a validated JSON production spec into an H.264 infographic video using React and Remotion. It does not call image-generation services or execute repository content.

## Scope

The module owns animated infographic visuals: title cards, comparisons, architecture orbits, command dispatchers, process pipelines, timelines, and end cards. Narration, music mixing, captions, and final delivery remain the video composer's responsibility.

## CLI

```bash
npm install
npm run check
npm run build
node dist/cli.js validate ./spec.json
node dist/cli.js render ./spec.json ./visuals.mp4
```

The render is deterministic for a given spec, package version, and font environment. Specs declare resolution, frame rate, palette, scene templates, scene content, and exact frame durations.

## Input shape

```json
{
  "version": 1,
  "name": "Example",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "palette": {
    "ink": "#0D0B16",
    "paper": "#FEFBF6",
    "primary": "#423E8E",
    "secondary": "#211F47",
    "accent": "#D77733",
    "muted": "#8A879B"
  },
  "scenes": [
    {
      "id": "s1",
      "template": "title",
      "durationInFrames": 150,
      "title": "A precise title",
      "subtitle": "A short explanatory line",
      "items": []
    }
  ]
}
```

See `src/schema.ts` for the canonical runtime validation and `library/dyne/software/jaromail/production/remotion-infographic/spec.json` for a complete production example.
