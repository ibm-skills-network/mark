#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const { JSDOM } = require(path.join(repoRoot, "node_modules/jsdom"));
const { normalizeQuillHtml } = require(
  path.join(__dirname, "../dist/index.js"),
);

const MARKERS =
  /data-list|ql-ui|ql-indent|ql-align|ql-direction|ql-code-block|ql-syntax|ql-cursor|ql-video/;

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
