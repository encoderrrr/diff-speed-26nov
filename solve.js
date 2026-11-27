// A faster drop-in for makefun-diff 1.0.0: run(input) returns make.fun's own patch of
// input { old, new } as one JSON string, byte-identical to makefun-diff 1.0.0 on every
// input, and faster. Written from scratch against the rule the reference states in its
// header: lines cut after every "\n" only; common prefix kept, then common suffix;
// between them Myers's greedy search, deletion preferred on a tie, never past either
// text's end, no edge-diagonal pruning, every run of equal lines followed as far as it
// goes; the first path to reach both ends is the script; hunks of up to 3 kept lines of
// context, runs at most 6 kept lines apart sharing a hunk, deletions before insertions
// in each run, no-newline lines written with one and followed by a "%" line.
//
// Speed comes from three choices, none of which changes the answer:
//  1. lines are interned to small integers once, so every comparison in the search is
//     an integer comparison on typed arrays instead of a string comparison;
//  2. the search keeps its state in flat typed arrays (one Int32Array holding, for
//     every depth d and diagonal k, the furthest old position reached, plus one
//     Uint8Array holding which move each (d, k) took), instead of one heap object per
//     path and one linked-list node per run; the edit script is recovered by walking
//     those arrays backwards from the winning (d, k);
//  3. the patch is rendered from the same runs the reference builds, with the same
//     hunk arithmetic, so the output is identical by construction.
//
// Nothing is cached from one call to the next: every run() call interns and searches
// its own input alone.

const KEEP = 0;
const DEL = 1;
const INS = 2;

/** How many kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/**
 * makefun-diff 1.0.0's answer for one case's input: make.fun's own patch of the two
 * texts, as one string.
 */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const oldText = input.old;
  const newText = input.new;

  // --- lines, interned -------------------------------------------------------
  // A line is its text plus whether it ends in "\n": the last line of a text that
  // does not end in "\n" is a different line from the same words with one. Interning
  // maps each distinct line text to a small id; the line id is (id << 1) | noNewline.
  const ids = new Map();
  let nextId = 0;
  const oldParts = oldText.split('\n');
  const newParts = newText.split('\n');
  const oldLast = oldParts.length - 1;
  const newLast = newParts.length - 1;
  const n = oldLast + (oldParts[oldLast] !== '' ? 1 : 0);
  const m = newLast + (newParts[newLast] !== '' ? 1 : 0);
  const A = new Int32Array(n);
  const B = new Int32Array(m);
  for (let i = 0; i < n; i++) {
    const s = oldParts[i];
    let id = ids.get(s);
    if (id === undefined) { id = nextId++; ids.set(s, id); }
    A[i] = (id << 1) | (i === oldLast ? 1 : 0);
  }
  for (let j = 0; j < m; j++) {
    const s = newParts[j];
    let id = ids.get(s);
    if (id === undefined) { id = nextId++; ids.set(s, id); }
    B[j] = (id << 1) | (j === newLast ? 1 : 0);
  }

  // --- common prefix, then common suffix of what is left ----------------------
  let prefix = 0;
  const minNM = n < m ? n : m;
  while (prefix < minNM && A[prefix] === B[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && A[n - 1 - suffix] === B[m - 1 - suffix]) suffix++;
  const n2 = n - prefix - suffix;
  const m2 = m - prefix - suffix;
  const A2 = A.subarray(prefix, n - suffix);
  const B2 = B.subarray(prefix, m - suffix);

  // --- an upper bound on the edit distance, for banding the search --------------
  // The search below ends on diagonal K = n2 - m2, and its winning path passes
  // depth d on a diagonal k with |K - k| <= D - d, D the (unknown) edit distance.
  // Any valid edit script's length Dub >= D therefore confines the search to the
  // band |K - k| <= Dub - d, about half the diagonals when Dub is tight. A tight
  // Dub comes cheaply from patience anchors: lines occurring exactly once in each
  // text, matched in order by their longest increasing subsequence, split both
  // texts into tiny gaps, and each gap's own edit distance (delete + insert only,
  // a replacement counting 2) is added up. Anchors matched plus gap scripts is a
  // real edit script, so the sum is a valid upper bound; on the drawn cases it
  // equals D. Full line ids (with the no-newline flag) are the keys throughout,
  // so a last line never matches a mid line.
  const upperBound = () => {
    if (n2 === 0) return m2;
    if (m2 === 0) return n2;
    const nb = nextId * 2;
    const cA = new Int32Array(nb);
    const cB = new Int32Array(nb);
    const firstB = new Int32Array(nb);
    for (let i = 0; i < n2; i++) cA[A2[i]]++;
    for (let j = 0; j < m2; j++) {
      const b = B2[j];
      cB[b]++;
      if (firstB[b] === 0) firstB[b] = j + 1;
    }
    const seqI = [];
    const seqJ = [];
    for (let i = 0; i < n2; i++) {
      const b = A2[i];
      if (cA[b] === 1 && cB[b] === 1) {
        seqI.push(i);
        seqJ.push(firstB[b] - 1);
      }
    }
    // The longest increasing subsequence of seqJ, with its anchors recovered.
    const tails = [];
    const tailsIdx = [];
    const prevLink = new Int32Array(seqJ.length).fill(-1);
    for (let s = 0; s < seqJ.length; s++) {
      const v = seqJ[s];
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tails[mid] < v) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0) prevLink[s] = tailsIdx[lo - 1];
      if (lo === tails.length) {
        tails.push(v);
        tailsIdx.push(s);
      } else {
        tails[lo] = v;
        tailsIdx[lo] = s;
      }
    }
    const anchors = [];
    const chain = [];
    let s = tailsIdx.length > 0 ? tailsIdx[tailsIdx.length - 1] : -1;
    while (s !== -1) {
      chain.push(s);
      s = prevLink[s];
    }
    for (let t = chain.length - 1; t >= 0; t--) {
      anchors.push(seqI[chain[t]], seqJ[chain[t]]);
    }
    // Each gap's edit distance (delete + insert only), with two rows reused.
    let rowA = new Int32Array(64);
    let rowB = new Int32Array(64);
    const gapDist = (a0, a1, b0, b1) => {
      const an = a1 - a0;
      const bn = b1 - b0;
      if (an === 0) return bn;
      if (bn === 0) return an;
      if (an === 1) {
        const v = A2[a0];
        for (let j = b0; j < b1; j++) if (B2[j] === v) return bn - 1;
        return bn + 1;
      }
      if (bn === 1) {
        const v = B2[b0];
        for (let i = a0; i < a1; i++) if (A2[i] === v) return an - 1;
        return an + 1;
      }
      if (bn + 1 > rowA.length) {
        rowA = new Int32Array(bn + 1);
        rowB = new Int32Array(bn + 1);
      }
      let prev = rowA;
      let cur = rowB;
      for (let j = 0; j <= bn; j++) prev[j] = j;
      for (let i = 1; i <= an; i++) {
        cur[0] = i;
        const av = A2[a0 + i - 1];
        for (let j = 1; j <= bn; j++) {
          cur[j] = av === B2[b0 + j - 1] ? prev[j - 1] : Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + 2);
        }
        const tmp = prev;
        prev = cur;
        cur = tmp;
      }
      return prev[bn];
    };
    let dub = 0;
    let pi = -1;
    let pj = -1;
    for (let a = 0; a < anchors.length; a += 2) {
      dub += gapDist(pi + 1, anchors[a], pj + 1, anchors[a + 1]);
      pi = anchors[a];
      pj = anchors[a + 1];
    }
    dub += gapDist(pi + 1, n2, pj + 1, m2);
    return dub;
  };
  const Dub = n2 + m2 > 400 ? upperBound() : n2 + m2;

  // --- Myers's greedy search on the middle -----------------------------------
  // State is one Int32Array per depth d, Vs[d], holding for every diagonal k the
  // furthest old position reached, encoded as ((x + 2) << 1) | move, where move is
  // 0 for the deletion that reached it and 1 for the insertion, and 0 means no
  // path reached that diagonal. Diagonal k of depth d sits at index k + d + 2;
  // the two slots at each end are padding that stays 0, so the deletion candidate
  // (from diagonal k - 1) and the insertion candidate (from k + 1) are always
  // readable in bounds, with no guards: a candidate counts only when its path
  // exists and its single step stays inside its text, never past either text's
  // end. The edit script is recovered by walking these slices backwards from the
  // winning (d, k). Slices are allocated one depth at a time, so nothing is ever
  // copied. The search runs banded around the final diagonal K = n2 - m2 (see
  // above); a band that runs out before the end means the bound was wrong, and
  // the search is then redone unbanded, which is always correct.
  const K0 = n2 - m2;
  const myersSearch = (bandDub) => {
    const Vs = [];
    let x = -1;
    let y = -1;
    while (x + 1 < n2 && y + 1 < m2 && A2[x + 1] === B2[y + 1]) { x++; y++; }
    const V0 = new Int32Array(5);
    V0[2] = (x + 2) << 1;
    Vs.push(V0);
    if (x + 1 >= n2 && y + 1 >= m2) return { D: 0, K: 0, Vs };
    const maxEdit = n2 + m2;
    for (let d = 1; d <= maxEdit; d++) {
      let klo = -d;
      let khi = d;
      if (bandDub < Infinity) {
        const span = bandDub - d;
        if (span < 0) return null;
        const lo = K0 - span;
        const hi = K0 + span;
        if (lo > klo) klo = lo;
        if (hi < khi) khi = hi;
        if (klo > khi) return null;
      }
      if (((klo - d) & 1) !== 0) klo++;
      if (klo > khi) return null;
      const Vp = Vs[d - 1];
      const Vc = new Int32Array(2 * d + 5);
      Vs.push(Vc);
      // Running indices: Vp's diagonal k - 1 is at k + d, its diagonal k + 1 at
      // k + d + 2, Vc's diagonal k at k + d + 2; each step of k adds 2 to all.
      let iDel = klo + d;
      let iIns = klo + d + 2;
      let iCur = klo + d + 2;
      for (let k = klo; k <= khi; k += 2) {
        const vDel = Vp[iDel];
        const vIns = Vp[iIns];
        const xDel = (vDel >> 1) - 2;
        const xIns = (vIns >> 1) - 2;
        const canDel = vDel !== 0 && xDel + 1 < n2;
        const canIns = vIns !== 0 && xIns - k < m2;
        iDel += 2;
        iIns += 2;
        iCur += 2;
        if (!canDel && !canIns) continue; // Vc's slot stays 0: no path here.
        // The candidate further into the old text wins; the deletion wins a tie.
        let x0;
        let isDel;
        if (canDel && (!canIns || xDel + 1 >= xIns)) {
          isDel = true;
          x0 = xDel + 1;
        } else {
          isDel = false;
          x0 = xIns;
        }
        let y0 = x0 - k;
        while (x0 + 1 < n2 && y0 + 1 < m2 && A2[x0 + 1] === B2[y0 + 1]) { x0++; y0++; }
        Vc[iCur - 2] = ((x0 + 2) << 1) | (isDel ? 0 : 1);
        if (x0 + 1 >= n2 && y0 + 1 >= m2) return { D: d, K: k, Vs };
      }
    }
    return null;
  };
  let found = myersSearch(Dub);
  if (found === null) found = myersSearch(Infinity);
  if (found === null) throw new Error('makefun-diff: the search ended without reaching both ends');
  const { D, K, Vs } = found;

  // --- the edit script, by walking the winning path backwards -----------------
  // Forward, the runs are: the depth-0 snake, then for each depth d one edit
  // (a deletion or an insertion) followed by that depth's snake. Walking back
  // from (D, K) recovers each depth's edit and snake length; adjacent runs of
  // one kind merge, exactly as the reference's path components do.
  const rk = [];
  const rc = [];
  const pushRun = (kind, count) => {
    if (count <= 0) return;
    if (rk.length > 0 && rk[rk.length - 1] === kind) rc[rc.length - 1] += count;
    else { rk.push(kind); rc.push(count); }
  };
  const steps = []; // per depth d = 1..D, from the end back: [edit kind, snake length]
  {
    let d = D;
    let k = K;
    while (d >= 1) {
      const Vc = Vs[d];
      const Vp = Vs[d - 1];
      const v = Vc[k + d + 2];
      const xe = (v >> 1) - 2;
      if ((v & 1) === 0) {
        const xPrev = (Vp[k + d] >> 1) - 2;
        steps.push([DEL, xe - (xPrev + 1)]);
        k -= 1;
      } else {
        const xPrev = (Vp[k + d + 2] >> 1) - 2;
        steps.push([INS, xe - xPrev]);
        k += 1;
      }
      d--;
    }
  }
  pushRun(KEEP, prefix);
  pushRun(KEEP, ((Vs[0][2] >> 1) - 2) + 1);
  for (let i = steps.length - 1; i >= 0; i--) {
    pushRun(steps[i][0], 1);
    pushRun(KEEP, steps[i][1]);
  }
  pushRun(KEEP, suffix);

  // --- the change runs ---------------------------------------------------------
  // Each a stretch of deletions and insertions between two kept lines, at old
  // line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let r = 0; r < rk.length; r++) {
    const kind = rk[r];
    const count = rc[r];
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes.length > 0 ? changes[changes.length - 1] : undefined;
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DEL) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }

  // --- the hunks: change runs at most 2 * CONTEXT kept lines apart share one ---
  const hunks = [];
  for (const c of changes) {
    const h = hunks.length > 0 ? hunks[hunks.length - 1] : undefined;
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  // --- rendering ----------------------------------------------------------------
  // A line as the patch writes it: its op, the line, a newline, and "%" on a line
  // of its own when the line ended its text without one.
  const written = (op, parts, last, i) => {
    if (i < last) return op + parts[i] + '\n';
    return op + parts[i] + '\n%\n';
  };
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = first.o - CONTEXT < 0 ? 0 : first.o - CONTEXT;
    const newStart = first.p - (first.o - oldStart);
    const after = n - (last.o + last.dels) < CONTEXT ? n - (last.o + last.dels) : CONTEXT;
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', oldParts, oldLast, at));
      for (let i = 0; i < c.dels; i++) out.push(written('-', oldParts, oldLast, c.o + i));
      for (let i = 0; i < c.ins; i++) out.push(written('+', newParts, newLast, c.p + i));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', oldParts, oldLast, at));
  }
  return out.join('');
}
