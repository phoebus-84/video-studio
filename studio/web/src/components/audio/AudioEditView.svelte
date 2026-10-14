<script lang="ts">
  /**
   * One audio edit, drawn (avg-8hs.5): the output's waveform under a ruler,
   * the words it carries, one lane per track with its clips (room tone
   * hatched, fades as ramps, gains, a duck shaded where it acts), and marks
   * for joins, clicks, level jumps, reshaped pauses and concerns. The output
   * plays with a playhead; a clip plays its stretch of its source; a take
   * plays as it was before the edit, for an A/B.
   */
  import { onDestroy } from "svelte";
  import { mediaUrl } from "$lib/episode-media";
  import { envelope, lanesOf, marksOf, placeOf, takesOf, wordIndexAt, type AudioEditEntry, type LaneClip } from "$lib/audio-edits";

  let { entry }: { entry: AudioEditEntry } = $props();

  const record = $derived(entry.record);
  const duration = $derived(Math.max(0.01, record.output.durationSeconds));
  const lanes = $derived(lanesOf(record));
  const marks = $derived(marksOf(record));
  const takes = $derived(takesOf(record));

  let width = $state(800);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let overlay = $state<HTMLCanvasElement | null>(null);
  /** Where the edit's output is, while it plays; -1 when it does not. */
  let now = $state(-1);
  let playing = $state<string | null>(null);
  let error = $state<string | null>(null);
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  let stopAt = Infinity;
  let frame = 0;
  /** Each play takes a generation; a fetch answered after another click, or after the view closed, is dropped. */
  let generation = 0;

  const LANE = 34;
  const WAVE = 90;
  const RULER = 18;
  const WORDS = 18;
  const height = $derived(RULER + WAVE + WORDS + lanes.length * LANE + 8);
  const x = (t: number) => (t / duration) * width;

  function color(name: string, fallback: string): string {
    if (typeof document === "undefined") return fallback;
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function context(c: HTMLCanvasElement): CanvasRenderingContext2D {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    g.font = "10px system-ui, sans-serif";
    return g;
  }

  /** What does not move: ruler, waveform, lanes, marks. Drawn when the edit or the width changes. */
  function draw() {
    const c = canvas;
    if (!c) return;
    const g = context(c);
    const text = color("--vs-text-secondary", "#888");
    const faint = color("--vs-border-subtle", "#ddd");
    const accent = color("--vs-accent", "#3b82f6");
    const danger = color("--vs-danger", "#dc2626");
    // ruler
    const step = duration > 60 ? 10 : duration > 20 ? 5 : 1;
    g.fillStyle = text;
    g.strokeStyle = faint;
    for (let t = 0; t <= duration; t += step) {
      g.beginPath(); g.moveTo(x(t), RULER - 4); g.lineTo(x(t), height); g.stroke();
      g.fillText(`${t}s`, x(t) + 2, 10);
    }
    // waveform of the output
    const env = envelope(entry.peaks, 0, duration, Math.max(1, Math.floor(width)));
    const mid = RULER + WAVE / 2;
    g.fillStyle = accent;
    env.forEach(([lo, hi], i) => g.fillRect(i, mid - hi * (WAVE / 2), 1, Math.max(1, (hi - lo) * (WAVE / 2))));
    // lanes
    lanes.forEach((lane, l) => {
      const top = RULER + WAVE + WORDS + l * LANE;
      g.fillStyle = text;
      g.fillText(`${lane.track}${lane.gain ? ` ${lane.gain} dB` : ""}${lane.duck ? ` · duck under ${lane.duck.under}` : ""}`, 2, top + 9);
      if (lane.duck) {
        const under = lanes.find((o) => o.track === lane.duck!.under);
        g.fillStyle = "rgba(0,0,0,0.06)";
        for (const c of under?.clips ?? []) g.fillRect(x(c.start), top + 11, Math.max(1, x(c.end) - x(c.start)), LANE - 14);
      }
      for (const clip of lane.clips) {
        const a = x(clip.start);
        const w = Math.max(2, x(clip.end) - a);
        g.fillStyle = clip.room ? "rgba(120,120,120,0.25)" : "rgba(59,130,246,0.22)";
        g.fillRect(a, top + 11, w, LANE - 14);
        if (clip.room) {
          g.strokeStyle = "rgba(120,120,120,0.6)";
          for (let k = a; k < a + w; k += 5) { g.beginPath(); g.moveTo(k, top + LANE - 3); g.lineTo(k + 5, top + 11); g.stroke(); }
        }
        g.strokeStyle = accent;
        g.beginPath();
        g.moveTo(a, top + LANE - 3);
        g.lineTo(a + x(clip.fadeIn), top + 11);
        g.lineTo(a + w - x(clip.fadeOut), top + 11);
        g.lineTo(a + w, top + LANE - 3);
        g.stroke();
        if (w > 40 && !clip.room) {
          g.fillStyle = text;
          g.fillText(`${clip.label}${clip.gain ? ` ${clip.gain} dB` : ""}`, a + 3, top + LANE - 6);
        }
      }
    });
    // marks
    for (const m of marks) {
      g.strokeStyle = m.kind === "click" || m.kind === "jump" ? danger : m.kind === "pause" ? accent : m.kind === "concern" ? "#d97706" : faint;
      g.lineWidth = m.kind === "join" ? 1 : 2;
      g.beginPath(); g.moveTo(x(m.at), RULER); g.lineTo(x(m.at), height); g.stroke();
      g.lineWidth = 1;
    }
  }

  /** What moves: the words, the current one lit, and the playhead. Cheap, drawn every frame. */
  function drawOverlay() {
    const c = overlay;
    if (!c) return;
    const g = context(c);
    const text = color("--vs-text-secondary", "#888");
    const accent = color("--vs-accent", "#3b82f6");
    const current = now >= 0 ? wordIndexAt(record.words, now) : -1;
    (record.words ?? []).forEach((w, i) => {
      g.fillStyle = i === current ? accent : text;
      g.fillText(w.text, x(w.start), RULER + WAVE + 12);
    });
    if (now >= 0) {
      g.strokeStyle = color("--vs-danger", "#dc2626");
      g.beginPath(); g.moveTo(x(now), 0); g.lineTo(x(now), height); g.stroke();
    }
  }

  $effect(() => {
    void width; void height; void entry;
    draw();
  });
  $effect(() => {
    void width; void height; void entry; void now;
    drawOverlay();
  });

  function release() {
    cancelAnimationFrame(frame);
    if (audio) { audio.pause(); audio.onended = null; }
    audio = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
  }

  function stop() {
    generation += 1;
    release();
    playing = null;
    now = -1;
  }

  /** Plays `path` from `from` to `to`; `output` says it is the edit itself, whose time the playhead shows. */
  async function play(key: string, path: string, from = 0, to = Infinity, output = false) {
    if (playing === key) return stop();
    stop();
    const mine = generation;
    error = null;
    playing = key;
    const made = await mediaUrl(placeOf(entry.where), path);
    if (mine !== generation) { if (made) URL.revokeObjectURL(made); return; }
    if (!made) { error = `${path} could not be read`; playing = null; return; }
    url = made;
    const a = new Audio(made);
    audio = a;
    stopAt = to;
    a.currentTime = from;
    a.onended = stop;
    await a.play().catch(() => { if (mine === generation) { error = "the browser refused to play"; stop(); } });
    if (mine !== generation) return;
    const tick = () => {
      if (mine !== generation || !audio) return;
      if (output) now = audio.currentTime;
      if (audio.currentTime >= stopAt) return stop();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  const clipKey = (track: string, clip: LaneClip) => `clip:${track}/${clip.id}`;

  function seek(event: MouseEvent) {
    if (playing !== "output" || !audio || !overlay) return;
    const box = overlay.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(duration, ((event.clientX - box.left) / box.width) * duration));
  }

  onDestroy(stop);
  const db = (n: number | null) => (n === null ? "–" : n.toFixed(1));
</script>

<section class="ae">
  <header class="ae-head">
    <div>
      <strong>{record.output.path}</strong>
      <span>{record.output.durationSeconds.toFixed(2)} s · {db(record.report.loudness.integrated)} LUFS · true peak {db(record.report.loudness.truePeak)} dBTP
        {#if record.report.normalization !== "none"}· {record.report.normalization}{/if}
        {#if record.report.clipped > 0}· <em class="ae-bad">{record.report.clipped} clipped samples</em>{/if}
      </span>
    </div>
    <div class="ae-buttons">
      <button onclick={() => play("output", record.output.path, 0, Infinity, true)}>{playing === "output" ? "Stop" : "Play the edit"}</button>
      {#each takes as t (t.key)}
        <button onclick={() => play(`take:${t.key}`, t.source)} title={`The take as it was before the edit: ${t.source}`}>{playing === `take:${t.key}` ? "Stop" : `Before: ${t.take}`}</button>
      {/each}
    </div>
  </header>

  <div class="ae-canvas" bind:clientWidth={width}>
    <canvas bind:this={canvas} style:width="{width}px" style:height="{height}px" aria-hidden="true"></canvas>
    <canvas class="ae-overlay" bind:this={overlay} style:width="{width}px" style:height="{height}px" onclick={seek} aria-label="Waveform, words, tracks and marks of the edit; click to move the playhead while the edit plays"></canvas>
  </div>

  {#if error}<p class="ae-bad" role="alert">{error}</p>{/if}

  <div class="ae-columns">
    <div>
      <h5>Clips</h5>
      <ul class="ae-clips">
        {#each lanes as lane (lane.track)}
          {#each lane.clips.filter((c) => !c.room) as clip (`${lane.track}/${clip.id}`)}
            <li>
              <button onclick={() => play(clipKey(lane.track, clip), clip.source, clip.in, clip.out)} aria-label={`Play ${lane.track}/${clip.id} from its source`}>{playing === clipKey(lane.track, clip) ? "■" : "▶"}</button>
              <span class="ae-mono">{lane.track}/{clip.id}</span> {clip.label} {clip.in.toFixed(2)}–{clip.out.toFixed(2)} s → {clip.start.toFixed(2)} s
            </li>
          {/each}
        {/each}
      </ul>
    </div>
    <div>
      <h5>Marks</h5>
      <ul class="ae-marks">
        {#each marks.filter((m) => m.kind !== "join") as m, i (`${m.at}-${i}`)}
          <li class={`ae-${m.kind}`}><span class="ae-mono">{m.at.toFixed(2)} s</span> {m.label}</li>
        {:else}
          <li>No clicks, jumps or concerns.</li>
        {/each}
      </ul>
    </div>
  </div>
</section>

<style>
  .ae { display: flex; flex-direction: column; gap: var(--vs-space-3); }
  .ae-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--vs-space-3); flex-wrap: wrap; }
  .ae-head strong { display: block; font-family: var(--vs-font-mono); font-size: var(--vs-text-sm); color: var(--vs-text-primary); }
  .ae-head span { font-size: var(--vs-text-xs); color: var(--vs-text-secondary); }
  .ae-buttons { display: flex; gap: var(--vs-space-2); flex-wrap: wrap; }
  .ae-buttons button, .ae-clips button { border: 1px solid var(--vs-border); border-radius: var(--vs-radius-sm); background: var(--vs-bg-raised); padding: 2px var(--vs-space-2); cursor: pointer; font-size: var(--vs-text-xs); }
  .ae-canvas { position: relative; width: 100%; border: 1px solid var(--vs-border-subtle); border-radius: var(--vs-radius-md); background: var(--vs-bg-inset); overflow: hidden; }
  canvas { display: block; }
  .ae-overlay { position: absolute; inset: 0; cursor: crosshair; }
  .ae-columns { display: grid; grid-template-columns: 1fr 1fr; gap: var(--vs-space-4); }
  h5 { margin: 0 0 var(--vs-space-1); font-size: var(--vs-text-sm); color: var(--vs-text-primary); }
  ul { list-style: none; margin: 0; padding: 0; font-size: var(--vs-text-xs); color: var(--vs-text-secondary); }
  li { padding: 2px 0; }
  .ae-mono { font-family: var(--vs-font-mono); }
  .ae-bad, .ae-click, .ae-jump { color: var(--vs-danger); }
  .ae-pause { color: var(--vs-accent-text); }
  .ae-concern { color: #b45309; }
</style>
