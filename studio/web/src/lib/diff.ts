/**
 * A minimal line-based diff algorithm producing hunks suitable
 * for a side-by-side or unified conflict view.  Returns an array
 * of hunks where each line is tagged as "same", "removed", "added",
 * or "conflict" (for three-way merges).
 */

export type DiffLineTag = "same" | "removed" | "added";

export interface DiffHunk {
  lines: DiffLine[];
}

export interface DiffLine {
  tag: DiffLineTag;
  /** 1-indexed line number in the original (null for additions). */
  lineA: number | null;
  /** 1-indexed line number in the modified (null for deletions). */
  lineB: number | null;
  text: string;
}

/**
 * Produce a unified diff between two texts.
 * Uses a simple LCS (longest common subsequence) approach.
 */
export function computeDiff(original: string, modified: string): DiffHunk[] {
  const a = original.split("\n");
  const b = modified.split("\n");

  const hunks: DiffHunk[] = [];
  let current: DiffLine[] = [];

  const lcs = buildLcs(a, b);

  let ai = 0;
  let bi = 0;

  for (const [la, lb] of lcs) {
    /* Lines in a not in LCS are deletions. */
    while (ai < la) {
      if (current.length > 0 && current[current.length - 1]!.tag !== "removed") {
        hunks.push({ lines: current });
        current = [];
      }
      current.push({ tag: "removed", lineA: ai + 1, lineB: null, text: a[ai]! });
      ai++;
    }
    /* Lines in b not in LCS are additions. */
    while (bi < lb) {
      if (current.length > 0 && current[current.length - 1]!.tag !== "added") {
        hunks.push({ lines: current });
        current = [];
      }
      current.push({ tag: "added", lineA: null, lineB: bi + 1, text: b[bi]! });
      bi++;
    }
    /* The match itself. */
    if (
      current.length > 0 &&
      current[current.length - 1]!.tag !== "same"
    ) {
      hunks.push({ lines: current });
      current = [];
    }
    current.push({ tag: "same", lineA: la + 1, lineB: lb + 1, text: a[la]! });
    ai = la + 1;
    bi = lb + 1;
  }

  /* Remaining deletions. */
  while (ai < a.length) {
    if (current.length > 0 && current[current.length - 1]!.tag !== "removed") {
      hunks.push({ lines: current });
      current = [];
    }
    current.push({ tag: "removed", lineA: ai + 1, lineB: null, text: a[ai]! });
    ai++;
  }

  /* Remaining additions. */
  while (bi < b.length) {
    if (current.length > 0 && current[current.length - 1]!.tag !== "added") {
      hunks.push({ lines: current });
      current = [];
    }
    current.push({ tag: "added", lineA: null, lineB: bi + 1, text: b[bi]! });
    bi++;
  }

  if (current.length > 0) {
    hunks.push({ lines: current });
  }

  return hunks;
}

/**
 * Build the longest common subsequence index pairs.
 * Returns pairs of [index in a, index in b] for matching lines.
 */
function buildLcs(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length;
  const n = b.length;

  /* Simple DP for reasonable-size documents. */
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  /* Backtrack. */
  const result: Array<[number, number]> = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}
