// The program the harness runs: node main.ts (Node 22).
// It reads every case from the input directory's cases.json, answers each one
// alone with run() from solve.js, and writes the answers, in the cases' order,
// to the output directory's answers.json. Outside a container, MAKEFUN_INPUT_DIR
// and MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported, so the whole
// entry runs under it (the rules let an entry tune V8's flags this way).
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL, typed by the contract run(input) returns. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** One case's answer, answered alone: nothing carries from one case to the next. */
function answerOne(c: { id: string; input: unknown }): unknown {
  return run(c.input);
}

const parsed: unknown = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8'));
if (!Array.isArray(parsed)) throw new Error('cases.json is not a JSON array');
const cases = parsed as { id: string; input: unknown }[];

const answers: unknown[] = cases.map(answerOne);

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
