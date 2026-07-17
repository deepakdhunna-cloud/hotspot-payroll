/**
 * Fuzzy person-name matching for schedule imports.
 *
 * Schedules are printed from Homebase and names rarely match the roster
 * exactly: "TAMMY V.", "Mike Ruiz" vs "Michael Ruiz", swapped order,
 * missing middle names, OCR typos. The importer auto-links only confident
 * matches; everything else gets ranked suggestions so a manager can link
 * a person with one click instead of creating a duplicate employee.
 */

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Damerau–Levenshtein distance (adjacent transpositions count as 1). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** Common American nickname pairs that prefix logic can't catch. */
const NICKNAMES: Record<string, string[]> = {
  mike: ["michael"],
  bill: ["william"],
  will: ["william"],
  bob: ["robert"],
  rob: ["robert"],
  dick: ["richard"],
  rick: ["richard"],
  liz: ["elizabeth"],
  beth: ["elizabeth"],
  betty: ["elizabeth"],
  kate: ["katherine", "kathryn", "katelyn"],
  kathy: ["katherine", "kathryn"],
  cathy: ["catherine"],
  tom: ["thomas"],
  tony: ["anthony"],
  jim: ["james"],
  jimmy: ["james"],
  joe: ["joseph"],
  jack: ["john", "jackson"],
  ted: ["edward", "theodore"],
  ned: ["edward"],
  peggy: ["margaret"],
  meg: ["margaret"],
  dave: ["david"],
  steve: ["steven", "stephen"],
  chuck: ["charles"],
  hank: ["henry"],
  tammy: ["tamara"],
  becky: ["rebecca"],
  cindy: ["cynthia"],
  debbie: ["deborah", "debra"],
  mandy: ["amanda"],
  drew: ["andrew"],
  sandy: ["sandra"],
  vicky: ["victoria"],
  larry: ["lawrence"],
  gerry: ["gerald"],
  jerry: ["gerald", "jerome"],
};

function isNicknamePair(a: string, b: string): boolean {
  return (
    (NICKNAMES[a]?.includes(b) ?? false) || (NICKNAMES[b]?.includes(a) ?? false)
  );
}

/** 0..1 similarity between two single tokens. */
function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  // Initial vs full name ("t" ~ "tammy") — strong but not exact.
  if (a.length === 1 || b.length === 1) {
    return a[0] === b[0] ? 0.8 : 0;
  }
  if (isNicknamePair(a, b)) return 0.9;
  // Prefix nicknames ("mike" ~ "michael", "sam" ~ "samantha").
  if (a.startsWith(b) || b.startsWith(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return 0.82 + 0.18 * ratio;
  }
  const dist = editDistance(a, b);
  const sim = 1 - dist / Math.max(a.length, b.length);
  return sim;
}

/**
 * 0..1 similarity between two full names, order-insensitive.
 * Greedy best-pair token assignment, weighted by token length so a matching
 * surname counts more than a matching initial.
 */
export function nameSimilarity(rawA: string, rawB: string): number {
  const a = normalizeName(rawA).split(" ").filter(Boolean);
  const b = normalizeName(rawB).split(" ").filter(Boolean);
  if (a.length === 0 || b.length === 0) return 0;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];

  const used = new Set<number>();
  let weighted = 0;
  let weightTotal = 0;
  for (const tok of shorter) {
    let best = 0;
    let bestIdx = -1;
    for (let i = 0; i < longer.length; i++) {
      if (used.has(i)) continue;
      const sim = tokenSimilarity(tok, longer[i]);
      if (sim > best) {
        best = sim;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) used.add(bestIdx);
    const weight = Math.max(2, tok.length);
    weighted += best * weight;
    weightTotal += weight;
  }
  // Unmatched extra tokens on the longer name (middle names etc.) cost a
  // little, but far less than a mismatched token would.
  const extraTokens = longer.length - shorter.length;
  const extraPenalty = extraTokens > 0 ? 0.05 * extraTokens : 0;
  return Math.max(0, weightTotal === 0 ? 0 : weighted / weightTotal - extraPenalty);
}

export type NameCandidate<T> = { record: T; score: number };

/**
 * Rank `candidates` by similarity to `target`. Returns the top `limit`
 * with score ≥ `minScore`, best first.
 */
export function rankNameMatches<T>(
  target: string,
  candidates: T[],
  getName: (c: T) => string,
  { limit = 3, minScore = 0.55 }: { limit?: number; minScore?: number } = {}
): NameCandidate<T>[] {
  return candidates
    .map(record => ({ record, score: nameSimilarity(target, getName(record)) }))
    .filter(c => c.score >= minScore)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}
