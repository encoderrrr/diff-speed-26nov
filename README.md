[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/encoderrrr/diff-speed-26nov/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/encoderrrr/diff-speed-26nov/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

# Diff two texts faster

A faster drop-in for makefun-diff 1.0.0, written for the
[make.fun bounty "Diff two texts faster, 27 November 2026"](https://make.fun/bounty/diff-speed-01-run-20261126).
`solve.js` exports `run(input)`, which returns make.fun's own patch of the two
texts in `input` (`{ old, new }`) as one JSON string — byte-identical to
makefun-diff 1.0.0 on every case, and measurably faster. `main.ts` is the
program the harness runs: it reads every case from `/input/cases.json`, answers
each one alone with `run`, and writes `/output/answers.json`.

## How it is faster

The reference spends its time allocating one heap object per search path and
comparing lines as strings. This entry keeps the exact same semantics with
three changes, none of which changes an answer:

1. **Lines are interned to small integers once**, so every comparison in the
   search is an integer comparison on typed arrays instead of a string
   comparison.
2. **The search state lives in flat typed arrays** — one `Int32Array` per
   search depth holding, for every diagonal, the furthest old position reached
   (with the move that reached it packed into the value) — instead of one heap
   object per path and one linked-list node per run. The edit script is
   recovered by walking those arrays backwards from the winning depth and
   diagonal.
3. **The search is banded.** The winning path ends on diagonal `n2 - m2`, so
   with a valid upper bound `Dub` on the edit distance the search only visits
   diagonals with `|K - k| <= Dub - d` — about half the work. The bound comes
   from patience anchors (lines occurring exactly once in each text, matched in
   order by their longest increasing subsequence) plus each gap's own edit
   distance; anchors plus gap scripts form a real edit script, so the bound is
   valid, and on the drawn cases it equals the true edit distance. If a band
   ever ran out before the end, the search is redone unbanded, which is always
   correct.

The tie-breaks are the reference's own: the common prefix is kept, then the
common suffix; Myers's greedy search keeps, on each diagonal, the path reaching
furthest into the old text, prefers the deletion when deletion and insertion
reach the same point, never moves past either text's end, prunes no edge
diagonal, and follows every run of equal lines as far as it goes. The patch
rendering (header line, hunks with up to 3 kept lines of context, runs at most
6 kept lines apart sharing a hunk, deletions before insertions in each run,
no-newline lines written with one and followed by a `%` line) is the
reference's, reproduced exactly.

## Results

- Practice set: 4/4 answers identical to makefun-diff 1.0.0.
- 20 further cases drawn with the kit's generator from fresh seeds: 20/20
  identical.
- 3,099 hand-built edge cases and random fuzz cases (empty texts, one-line
  texts, identical texts, no trailing newline, `\r` inside lines, very long
  lines, thousands of lines, block moves): 3,099/3,099 identical.
- Speed on the practice set (this machine, median of repeated runs):
  about 3.2x the reference's CPU time — the reference takes ~2.4 s per set of
  4 cases, this entry ~0.7 s.

## License

MIT — see [LICENSE](LICENSE).
