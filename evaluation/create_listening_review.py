#!/usr/bin/env python3
"""Create an offline blinded A/B scoring page without exposing withheld keys."""

from __future__ import annotations

import argparse
import html
import json
import os
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SEGMENT_DIMENSIONS = (
    "text_fidelity", "pronunciation", "naturalness", "pacing",
    "emotional_fit", "voice_identity", "overall",
)
CONTINUITY_DIMENSIONS = (
    "identity_continuity", "prosody_continuity", "level_continuity",
    "boundary_quality", "pause_intent", "transition_fit",
)
DIMENSIONS = SEGMENT_DIMENSIONS + CONTINUITY_DIMENSIONS


def create(run: Path, output: Path) -> None:
    results = run / "results"
    segment_package = json.loads((results / "listening-items.json").read_text(encoding="utf-8"))
    items = [(item, "segment", SEGMENT_DIMENSIONS) for item in segment_package["items"]]
    continuity_path = results / "continuity-items.json"
    if continuity_path.is_file():
        continuity = json.loads(continuity_path.read_text(encoding="utf-8"))
        items.extend((item, "continuity", CONTINUITY_DIMENSIONS) for item in continuity["items"])
    sections = []
    audio_dir = output.parent / "listening-audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    for index, (item, item_kind, dimensions) in enumerate(items, 1):
        item_id = html.escape(item["item_id"])
        opaque_a = audio_dir / f"item-{index:03d}-A.wav"
        opaque_b = audio_dir / f"item-{index:03d}-B.wav"
        shutil.copy2(ROOT / item["A"], opaque_a)
        shutil.copy2(ROOT / item["B"], opaque_b)
        audio_a = html.escape(os.path.relpath(opaque_a, output.parent))
        audio_b = html.escape(os.path.relpath(opaque_b, output.parent))
        scores = "".join(
            f'<label for="score-{index}-{dimension}-A">{dimension.replace("_", " ")} A</label>'
            f'<input id="score-{index}-{dimension}-A" aria-label="Item {index} {dimension.replace("_", " ")} A" required type="number" min="1" max="5" name="{dimension}_A">'
            f'<label for="score-{index}-{dimension}-B">{dimension.replace("_", " ")} B</label>'
            f'<input id="score-{index}-{dimension}-B" aria-label="Item {index} {dimension.replace("_", " ")} B" required type="number" min="1" max="5" name="{dimension}_B">'
            for dimension in dimensions
        )
        explanation = (
            "Score exact content, pronunciation, naturalness, pacing, emotional fit, identity, and overall quality."
            if item_kind == "segment" else
            "Listen across the complete assembly. Score identity/prosody/level continuity, boundaries, pauses, and transitions."
        )
        sections.append(f"""
<section data-item="{item_id}" data-kind="{item_kind}" data-dimensions='{html.escape(json.dumps(dimensions))}'>
<h2>{item_id} <small>({item_kind})</small></h2><p>{explanation}</p>
<div class="players"><label>A<audio controls preload="none" src="{audio_a}"></audio></label>
<label>B<audio controls preload="none" src="{audio_b}"></audio></label></div>
<div class="scores">{scores}</div>
<label>Preference <select aria-label="Item {index} preference" name="preference" required><option value="">choose</option><option>A</option><option>B</option><option>no preference</option></select></label>
<label>Flags A <input aria-label="Item {index} flags A" name="flags_A" placeholder="pronunciation|omission|repetition|clipping|breath|pause|identity|boundary"></label>
<label>Flags B <input aria-label="Item {index} flags B" name="flags_B" placeholder="pronunciation|omission|repetition|clipping|breath|pause|identity|boundary"></label>
<label>Notes <textarea aria-label="Item {index} notes" name="notes"></textarea></label></section>""")
    columns = [
        "listener_id", "item_id", "item_kind", "playback_setup", "timestamp",
        *(f"{dimension}_{side}" for dimension in DIMENSIONS for side in ("A", "B")),
        "preference", "flags_A", "flags_B", "notes",
    ]
    document = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="A 55-item blinded A/B evaluation of local speech synthesis."><link rel="icon" href="data:,"><title>Blinded TTS review</title>
<style>body{{font:16px system-ui;max-width:1100px;margin:auto;padding:2rem;color:#18201d;background:#f9fbfa}}section{{border-top:2px solid #6d7772;padding:1rem 0}}.players,.scores{{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}}label{{display:flex;justify-content:space-between;gap:1rem;margin:.35rem}}audio{{width:400px;max-width:100%}}textarea{{width:70%;height:4rem}}input:invalid,select:invalid{{outline:2px solid #b62f3c}}small{{font-weight:normal;color:#53605a}}@media(max-width:700px){{body{{padding:1rem}}.players,.scores{{grid-template-columns:1fr}}}}</style></head><body><main>
<h1>Blinded TTS listening review</h1><p>Use headphones in a quiet room. Score each item once before optional replay. System identity is withheld. Complete all isolated segments and the final continuity assembly.</p>
<form id="review"><label>Listener pseudonym <input required id="listener"></label><label>Playback setup <input required id="setup"></label>{''.join(sections)}
<button type="submit">Download completed CSV</button></form>
<script>
const columns={json.dumps(columns)};
document.querySelector('#review').addEventListener('submit', event=>{{event.preventDefault();const rows=[columns];const listener=document.querySelector('#listener').value;const setup=document.querySelector('#setup').value;const timestamp=new Date().toISOString();for(const section of document.querySelectorAll('section')){{const row={{listener_id:listener,item_id:section.dataset.item,item_kind:section.dataset.kind,playback_setup:setup,timestamp}};const dimensions=JSON.parse(section.dataset.dimensions);for(const name of [...dimensions.flatMap(d=>[d+'_A',d+'_B']),'preference','flags_A','flags_B','notes'])row[name]=section.querySelector(`[name="${{name}}"]`).value;rows.push(columns.map(c=>row[c]??''));}}const csv=rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\\n')+'\\n';const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{{type:'text/csv'}}));link.download='listening-'+listener+'.csv';link.click();}});
</script></main></body></html>"""
    output.write_text(document, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", type=Path, default=ROOT / "evaluation" / "runs" / "candidate-qtw-v1")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    output = args.output or args.run / "results" / "listening-review.html"
    create(args.run.resolve(), output.resolve())
    print(output)


if __name__ == "__main__":
    main()
