// With AVG_RENDER_TIMINGS=1 a render says on stderr how long each step took,
// to find where a machine spends it.
export async function timed<T>(step: string, work: () => Promise<T>): Promise<T> {
  if (process.env.AVG_RENDER_TIMINGS?.trim() !== '1') return work();
  const start = performance.now();
  try {
    return await work();
  } finally {
    process.stderr.write(`[timing] ${step}: ${Math.round(performance.now() - start)} ms\n`);
  }
}
