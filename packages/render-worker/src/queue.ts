// Who draws which segments of a shared render, decided while it runs. A fixed
// split misjudges the work: segments cost very different times (a poem's
// last seconds took five times its first), so a machine finished early and
// waited. Here every machine takes a chunk, draws it and comes back for more;
// chunks shrink as the queue empties (half a machine's fair part of what is
// left), so the machines end together. One machine takes from the front, the
// others from the back, so each draws runs of neighbouring seconds.
//
// A machine's rate is what it really did in this render (segments over wall
// time, its calls' start included); until it has done a chunk, its prior
// weight, scaled like the machines already measured. A machine takes no more
// than it can finish before the others would finish everything without it,
// and a machine that cannot help with even one segment stops for good. The
// others' chunks count only for what their rate has not drawn yet since they
// took them: counted whole, a slow machine near the end took the last heavy
// seconds while the fast ones had all but finished, and they waited for it.
// A remote's chunk then travels here: the journey its last chunk took counts
// too, so a machine whose segments would arrive after the others' finish
// leaves them the last seconds.
//
// A machine that fails gives its chunk back: the others draw it first, before
// the rest, so a lost machine costs time and never a hole in the video. A
// machine draws its next chunk while the last one travels here; a chunk that
// never arrives whole goes back the same way, and one already travelling when
// its machine fails still arrives: the others wait for it, not redraw it.
//
// The queue may hold only some of the segments: those no cache already has.
// A correction redraws what changed, and the cached seconds, which cost no
// drawing, never count as a machine's speed.

export interface QueueDrawer {
  host: string;
  /** Its speed before this render: measured or configured, any unit shared by all. */
  prior: number;
  /** Takes the lowest segments left; the others take the highest. */
  fromFront?: boolean;
}

interface State extends QueueDrawer { segments: number; seconds: number; inFlight: number[]; unconfirmed: number[]; since: number; stopped: boolean; failed: boolean; sent: number; travel: number }

export class SegmentQueue {
  private front: number;
  private back: number;
  /** Segments a failed machine gave back, drawn before the rest. */
  private returned: number[] = [];
  private readonly drawers = new Map<string, State>();
  /** The segments to draw, in order; front and back are positions in it. */
  private readonly segments: readonly number[];

  /** `segments` is how many to draw, from 0, or which; `now` is the clock in seconds, for tests. */
  constructor(segments: number | readonly number[], drawers: readonly QueueDrawer[], private readonly now: () => number = () => Date.now() / 1000) {
    this.segments = typeof segments === "number" ? Array.from({ length: segments }, (_, i) => i) : [...segments].sort((a, b) => a - b);
    this.front = 0;
    this.back = this.segments.length - 1;
    for (const d of drawers) this.drawers.set(d.host, { ...d, segments: 0, seconds: 0, inFlight: [], unconfirmed: [], since: 0, stopped: false, failed: false, sent: 0, travel: 0 });
  }

  get left(): number {
    return Math.max(0, this.back - this.front + 1) + this.returned.length;
  }

  /**
   * The next chunk for `host`; empty when it has nothing to draw now. A
   * machine that has stopped still takes back a failed machine's chunk, if
   * it would draw it sooner than the others; see `mayGetMore`.
   */
  take(host: string): number[] {
    const me = this.state(host);
    if (me.failed) return [];
    if (this.returned.length > 0) {
      // Every machine still alive is waiting or drawing: weigh it against all of them.
      const count = this.count(me, [...this.drawers.values()].filter((d) => d !== me && !d.failed), this.returned.length);
      return count < 1 ? [] : this.hand(me, this.returned.splice(0, count));
    }
    if (me.stopped || this.left === 0) return this.stop(me);
    const count = this.count(me, [...this.drawers.values()].filter((d) => d !== me && !d.stopped), this.left);
    if (count < 1) return this.stop(me);
    const chunk = me.fromFront
      ? Array.from({ length: count }, (_, i) => this.segments[this.front + i]!)
      : Array.from({ length: count }, (_, i) => this.segments[this.back - count + 1 + i]!);
    if (me.fromFront) this.front += count;
    else this.back -= count;
    return this.hand(me, chunk);
  }

  /** Whether `host` draws in this render. */
  has(host: string): boolean {
    return this.drawers.has(host);
  }

  /** Whether `host`, with nothing to draw now, may still be given a chunk another machine fails to draw. */
  mayGetMore(host: string): boolean {
    const me = this.state(host);
    return !me.failed && [...this.drawers.values()].some((d) => d !== me && ((!d.failed && d.inFlight.length > 0) || d.unconfirmed.length > 0));
  }

  /** `host` draws nothing more: the others draw the chunk it held; those travelling may still arrive. */
  leave(host: string): void {
    const me = this.state(host);
    this.giveBack(me.inFlight);
    me.inFlight = [];
    me.failed = true;
    this.stop(me);
  }

  /** `host` drew its chunk in `seconds`; `travelling`, its chunk is on its way here, until `confirm`. */
  done(host: string, seconds: number, travelling = false): void {
    const me = this.state(host);
    me.segments += me.inFlight.length;
    me.seconds += seconds;
    if (travelling) {
      me.unconfirmed = [...me.unconfirmed, ...me.inFlight];
      me.sent = this.now();
    }
    me.inFlight = [];
  }

  /** `segments` of `host`'s arrived whole. */
  confirm(host: string, segments: readonly number[]): void {
    const me = this.state(host);
    me.unconfirmed = me.unconfirmed.filter((i) => !segments.includes(i));
    if (me.sent > 0) me.travel = Math.max(0, this.now() - me.sent);
  }

  /** `segments` of `host`'s never arrived: the others draw them, first. */
  lost(host: string, segments: readonly number[]): void {
    const me = this.state(host);
    this.giveBack(me.unconfirmed.filter((i) => segments.includes(i)));
    me.unconfirmed = me.unconfirmed.filter((i) => !segments.includes(i));
  }

  /** Whether `host` left the render, failing. */
  failed(host: string): boolean {
    return this.state(host).failed;
  }

  /** Segments per second of wall time in this render, or the prior scaled like the measured machines. */
  rate(d: Pick<State, "prior" | "segments" | "seconds">): number {
    if (d.segments > 0 && d.seconds > 0) return d.segments / d.seconds;
    const measured = [...this.drawers.values()].filter((m) => m.segments > 0 && m.seconds > 0 && m.prior > 0);
    if (measured.length === 0) return d.prior;
    const scale = measured.reduce((n, m) => n + m.segments / m.seconds / m.prior, 0) / measured.length;
    return d.prior * scale;
  }

  /** How many of `left` segments `me` takes, beside `others`: half its fair part, no more than it helps with. */
  private count(me: State, others: State[], left: number): number {
    const othersRate = others.reduce((n, d) => n + this.rate(d), 0);
    if (othersRate <= 0) return left;
    const rate = this.rate(me);
    const now = this.now();
    // What the others still hold: their chunks less what their rate drew since they took them.
    const held = others.reduce((n, d) => n + Math.max(0, d.inFlight.length - this.rate(d) * (now - d.since)), 0);
    const work = left + held;
    const fair = Math.ceil((work * rate) / (rate + othersRate) / 2);
    // No more than it draws, and sends here, before the others would have drawn it all.
    const helps = Math.floor(rate * (work / othersRate - me.travel) + 1e-9);
    return Math.min(left, fair, helps);
  }

  private giveBack(segments: readonly number[]): void {
    this.returned = [...this.returned, ...segments].sort((a, b) => a - b);
  }

  private hand(me: State, chunk: number[]): number[] {
    me.inFlight = chunk;
    me.since = this.now();
    return chunk;
  }

  private state(host: string): State {
    const me = this.drawers.get(host);
    if (!me) throw new Error(`${host} does not draw in this render`);
    return me;
  }

  private stop(me: State): number[] {
    me.stopped = true;
    return [];
  }
}
