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
// and a machine that cannot help with even one segment stops for good.

export interface QueueDrawer {
  host: string;
  /** Its speed before this render: measured or configured, any unit shared by all. */
  prior: number;
  /** Takes the lowest segments left; the others take the highest. */
  fromFront?: boolean;
}

interface State extends QueueDrawer { segments: number; seconds: number; inFlight: number; stopped: boolean }

export class SegmentQueue {
  private front: number;
  private back: number;
  private readonly drawers = new Map<string, State>();

  constructor(total: number, drawers: readonly QueueDrawer[]) {
    this.front = 0;
    this.back = total - 1;
    for (const d of drawers) this.drawers.set(d.host, { ...d, segments: 0, seconds: 0, inFlight: 0, stopped: false });
  }

  get left(): number {
    return Math.max(0, this.back - this.front + 1);
  }

  /** The next chunk for `host`; empty when it has nothing more to draw. */
  take(host: string): number[] {
    const me = this.state(host);
    if (me.stopped || this.left === 0) return this.stop(me);
    const others = [...this.drawers.values()].filter((d) => d !== me && !d.stopped);
    const othersRate = others.reduce((n, d) => n + this.rate(d), 0);
    let count = this.left;
    if (othersRate > 0) {
      const rate = this.rate(me);
      const work = this.left + others.reduce((n, d) => n + d.inFlight, 0);
      const fair = Math.ceil((work * rate) / (rate + othersRate) / 2);
      // No more than it draws before the others would have drawn it all.
      const helps = Math.floor((rate * work) / othersRate + 1e-9);
      count = Math.min(this.left, fair, helps);
    }
    if (count < 1) return this.stop(me);
    const chunk = me.fromFront
      ? Array.from({ length: count }, (_, i) => this.front + i)
      : Array.from({ length: count }, (_, i) => this.back - count + 1 + i);
    if (me.fromFront) this.front += count;
    else this.back -= count;
    me.inFlight = count;
    return chunk;
  }

  /** `host` draws nothing more: the others no longer wait for it. */
  leave(host: string): void {
    this.stop(this.state(host));
  }

  /** `host` drew its chunk in `seconds`. */
  done(host: string, seconds: number): void {
    const me = this.state(host);
    me.segments += me.inFlight;
    me.seconds += seconds;
    me.inFlight = 0;
  }

  /** Segments per second of wall time in this render, or the prior scaled like the measured machines. */
  rate(d: Pick<State, "prior" | "segments" | "seconds">): number {
    if (d.segments > 0 && d.seconds > 0) return d.segments / d.seconds;
    const measured = [...this.drawers.values()].filter((m) => m.segments > 0 && m.seconds > 0 && m.prior > 0);
    if (measured.length === 0) return d.prior;
    const scale = measured.reduce((n, m) => n + m.segments / m.seconds / m.prior, 0) / measured.length;
    return d.prior * scale;
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
