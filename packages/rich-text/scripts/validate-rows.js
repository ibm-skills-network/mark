#!/usr/bin/env node
/**
 * Runs the normalization rules over real stored content and reports what they
 * did to it.
 *
 * Fixtures prove a rule does what its author intended. This proves it against
 * content nobody designed, which is a different question — it is what caught a
 * mixed bullet/number list silently dropping every item after the type switch,
 * and an entire markup shape (`<p class="ql-indent-N">`) that no fixture
 * covered. Run it before trusting any change to the rules.
 *
 * Get the input by dumping marker-bearing rows read-only, from inside a pod so
 * no credentials reach your machine (`-i` is required or stdin is dropped):
 *
 *   POD=$(kubectl --context <ctx> -n mark get pods \
 *     | awk '/^mark-api-[0-9a-f]/{print $1; exit}')
 *   kubectl --context <ctx> -n mark exec -i "$POD" -c mark-api -- \
 *     sh -c 'psql "$DATABASE_URL_DIRECT" -f -' < dump.sql > rows.json
 *
 * where dump.sql selects `json_agg(json_build_object('src',…,'id',…,'html',…))`
 * over the content columns, filtered on the markers below. psql prints a banner
 * before the JSON, so strip everything before the first "[".
 *
 *   node packages/rich-text/scripts/validate-rows.js rows.json
 *
 * Exits non-zero if any row loses text, keeps a marker, or is not idempotent.
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const { JSDOM } = require(path.join(repoRoot, "node_modules/jsdom"));
const { normalizeQuillHtml } = require(
  path.join(__dirname, "../dist/index.js"),
);

const MARKERS =
  /data-list|ql-ui|ql-indent|ql-code-block|ql-syntax|ql-cursor|ql-video/;

// One document reused for every row. Building a JSDOM per row exhausts the heap
// well before 2k rows.
const doc = new JSDOM("<!doctype html><html><body></body></html>").window
  .document;

const parse = (html) => {
  const element = doc.createElement("div");
  element.innerHTML = html;
  return element;
};

const textOf = (html) => {
  const element = doc.createElement("div");
  element.innerHTML = html;
  return (element.textContent ?? "")
    .replace(/[​﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Whitespace-insensitive comparison. Code blocks legitimately change spacing
 * when per-line divs become newline-separated text, so real loss has to be
 * judged on the characters rather than the layout.
 */
const dense = (html) => textOf(html).replace(/\s+/g, "");

const input = process.argv[2];
if (!input) {
  console.error("usage: validate-rows.js <rows.json>");
  process.exit(2);
}

const rows = JSON.parse(fs.readFileSync(input, "utf8"));
const textLoss = [];
const residual = [];
const notIdempotent = [];
const warnings = [];
let rewritten = 0;
let whitespaceOnly = 0;

for (const row of rows) {
  const first = normalizeQuillHtml(row.html, { parse });
  if (first.changes > 0) rewritten += 1;

  if (dense(first.html) !== dense(row.html)) {
    textLoss.push({
      ...row,
      before: textOf(row.html).slice(0, 100),
      after: textOf(first.html).slice(0, 100),
    });
  } else if (textOf(first.html) !== textOf(row.html)) {
    whitespaceOnly += 1;
  }

  if (MARKERS.test(first.html)) {
    residual.push({ ...row, marker: first.html.match(MARKERS)[0] });
  }

  const second = normalizeQuillHtml(first.html, { parse });
  if (second.html !== first.html || second.changes !== 0) {
    notIdempotent.push({ ...row, secondChanges: second.changes });
  }

  for (const warning of first.warnings) {
    warnings.push({ src: row.src, id: row.id, warning });
  }
}

const report = (label, value) => console.log(`${label.padEnd(20)}: ${value}`);

report("rows", rows.length);
report("rewritten", rewritten);
report("TEXT LOSS", textLoss.length);
report("whitespace-only", whitespaceOnly);
report("RESIDUAL MARKERS", residual.length);
report("NOT IDEMPOTENT", notIdempotent.length);
report("warnings", warnings.length);

for (const row of textLoss.slice(0, 10)) {
  console.log(`\nTEXT LOSS ${row.src} ${row.id}`);
  console.log(`  before: ${row.before}`);
  console.log(`  after : ${row.after}`);
}
for (const row of residual.slice(0, 10)) {
  console.log(`\nRESIDUAL ${row.src} ${row.id} -> ${row.marker}`);
}
for (const row of notIdempotent.slice(0, 10)) {
  console.log(
    `\nNOT IDEMPOTENT ${row.src} ${row.id} (second pass changed ${row.secondChanges})`,
  );
}

// Warnings are expected, not failures: they record content the rules
// deliberately could not carry across, such as paragraph indentation.
const counted = new Map();
for (const { warning } of warnings) {
  const key = warning.replace(/\d+/g, "N");
  counted.set(key, (counted.get(key) ?? 0) + 1);
}
for (const [warning, count] of counted) {
  console.log(`\nWARN x${count}: ${warning}`);
}

const failed =
  textLoss.length > 0 || residual.length > 0 || notIdempotent.length > 0;
console.log(`\n${failed ? "FAILED" : "OK"}`);
process.exit(failed ? 1 : 0);
