#!/usr/bin/env python3
"""Create an offline blinded A/B scoring page without exposing the withheld key."""

from __future__ import annotations

import argparse
import html
import json
import os
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DIMENSIONS = (
    "text_fidelity", "pronunciation", "naturalness", "pacing",
    "emotional_fit", "voice_identity", "overall",
)


def create(run: Path, output: Path) -> None:
    items_path = run / "results" / "listening-items.json"
    package = json.loads(items_path.read_text(encoding="utf-8"))
    sections = []
    audio_dir = output.parent / "listening-audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    for index, item in enumerate(package["items"], 1):
        item_id = html.escape(item["item_id"])
        opaque_a = audio_dir / f"item-{index:03d}-A.wav"
        opaque_b = audio_dir / f"item-{index:03d}-B.wav"
        shutil.copy2(ROOT / item["A"], opaque_a)
        shutil.copy2(ROOT / item["B"], opaque_b)
        audio_a = html.escape(os.path.relpath(opaque_a, output.parent))
        audio_b = html.escape(os.path.relpath(opaque_b, output.parent))
        scores = "".join(
            f'<label>{dimension.replace("_", " ")} A <input required type="number" min="1" max="5" name="{dimension}_A"></label>'
            f'<label>{dimension.replace("_", " ")} B <input required type="number" min="1" max="5" name="{dimension}_B"></label>'
            for dimension in DIMENSIONS
        )
        sections.append(f"""
<section data-item="{item_id}"><h2>{item_id}</h2>
<div class="players"><label>A<audio controls preload="none" src="{audio_a}"></audio></label>
<label>B<audio controls preload="none" src="{audio_b}"></audio></label></div>
<div class="scores">{scores}</div>
<label>Preference <select name="preference" required><option value="">choose</option><option>A</option><option>B</option><option>no preference</option></select></label>
<label>Flags <input name="flags" placeholder="pronunciation|omission|repetition|clipping|breath|pause|identity"></label>
<label>Notes <textarea name="notes"></textarea></label></section>""")
    columns = [
        "listener_id", "item_id", "playback_setup", "timestamp",
        *(f"{dimension}_{side}" for dimension in DIMENSIONS for side in ("A", "B")),
        "preference", "flags", "notes",
    ]
    document = f"""<!doctype html><meta charset="utf-8"><title>Blinded TTS review</title>
<style>body{{font:16px system-ui;max-width:1100px;margin:auto;padding:2rem}}section{{border-top:2px solid #888;padding:1rem 0}}.players,.scores{{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}}label{{display:flex;justify-content:space-between;gap:1rem;margin:.35rem}}audio{{width:400px}}textarea{{width:70%;height:4rem}}input:invalid,select:invalid{{outline:2px solid #c33}}</style>
<h1>Blinded baseline/candidate listening review</h1><p>Use headphones in a quiet room. Score each item once before optional replay. System identity is withheld.</p>
<form id="review"><label>Listener pseudonym <input required id="listener"></label><label>Playback setup <input required id="setup"></label>{''.join(sections)}
<button type="submit">Download completed CSV</button></form>
<script>
const columns={json.dumps(columns)}; const dimensions={json.dumps(DIMENSIONS)};
document.querySelector('#review').addEventListener('submit', event=>{{event.preventDefault();const rows=[columns];const listener=document.querySelector('#listener').value;const setup=document.querySelector('#setup').value;const timestamp=new Date().toISOString();for(const section of document.querySelectorAll('section')){{const row={{listener_id:listener,item_id:section.dataset.item,playback_setup:setup,timestamp}};for(const name of [...dimensions.flatMap(d=>[d+'_A',d+'_B']),'preference','flags','notes'])row[name]=section.querySelector(`[name="${{name}}"]`).value;rows.push(columns.map(c=>row[c]??''));}}const csv=rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\n')+'\n';const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{{type:'text/csv'}}));link.download='listening-'+listener+'.csv';link.click();}});
</script>"""
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
