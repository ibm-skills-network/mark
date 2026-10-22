/**
 * Deterministic check for reports that carry nothing a person could act on
 * ("ok", ".", "asdf", a form with every field set to "no"). Such reports are
 * still recorded, but not forwarded to the support queue.
 *
 * Only what the reporter typed is judged: the form's own section headings,
 * placeholders and the generated metadata block are removed first, each only
 * in the exact shape the form or server emits. An error identifier (HTTP
 * status, error code) in what remains always keeps the report.
 * The rules are deliberately narrow, since a false positive hides a real
 * report from support; anything with a word that is not filler is kept.
 */

/** Report.closureReason for a report held back by this check. */
export const JUNK_CLOSURE_REASON = "junk";

export type JunkReason =
  | "no_letters"
  | "repeated_char"
  | "filler_only"
  | "too_short";

export type JunkClassification =
  | { junk: false }
  | { junk: true; reason: JunkReason };

// Every label the report form (ReportPreviewModal) can emit as a section
// heading, across its report, feedback, suggestion and inquiry variants.
const FORM_LABELS = [
  "Steps to reproduce",
  "Expected result",
  "Actual result",
  "Environment (browser/device)",
  "Environment",
  "Additional context",
  "What you liked",
  "What could be improved",
  "Why this matters",
  "Problem or opportunity",
  "Proposed change",
  "Why this helps",
  "Examples or references",
  "What you're trying to do",
  "What you've tried so far",
  "Where you're stuck",
  "Relevant links or IDs",
];

// Placeholder text the form shows in empty fields, in case a browser or
// translation extension submits it as the value.
const FORM_PLACEHOLDERS = [
  "What you expected to happen.",
  "What actually happened.",
  "Browser, OS, device, network, etc.",
  "Anything else that helps us investigate.",
];

// The metadata block appended to the support ticket body, matched only in
// the exact shape the server generates it (key plus generated value), so a
// reporter's sentence that happens to start with one of these keys is kept.
const METADATA_LINES = [
  /^Issue type: [A-Z_]+$/,
  /^Reporter role: [A-Z_a-z]+$/,
  /^Severity: (?:info|warning|error|critical)$/,
  /^Assignment ID: (?:\d+|N\/A)$/,
  /^Attempt ID: (?:\d+|N\/A)$/,
  /^Diagnostics captured: attempt [^\n,]+, language [^\n,]+, \d+ of \d+ recent requests failed\. Full capture: Mark admin > Reports\.$/,
];

const HTML_TAG = /<\/?[a-z][^>]*>/gi;
// The steps field's own placeholder ("1. ...").
const NUMBERED_PLACEHOLDER_LINE = /^\d+\.\s*\.{3}$/;

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

const FORM_LABEL_PATTERN = FORM_LABELS.map((label) => escapeRegExp(label)).join(
  "|",
);
// A form heading as the form emits it ("**Steps to reproduce:**"); any other
// bold text is the reporter's.
const MARKDOWN_SECTION_LABEL = new RegExp(
  String.raw`\*\*(?:${FORM_LABEL_PATTERN}):\*\*`,
  "gi",
);
const PLAIN_LABEL_LINE = new RegExp(
  String.raw`^(?:${FORM_LABEL_PATTERN})\s*:$`,
  "i",
);

// Identifiers a reporter copies from an error message: an HTTP error status
// ("500"), a Node/browser error code ("ERR_NETWORK", "ECONNRESET") or a
// Postgres SQLSTATE ("22P05"). Any of these is enough to investigate.
const ERROR_IDENTIFIER =
  /(?<![\p{L}\p{N}])(?:[45]\d{2}|ERR_[A-Z0-9_]+|E(?:CONN|NOT|TIMEDOUT|PIPE|ACCES|AI_|HOST|NET|ADDR|PROTO)[A-Z_]*|\d{2}[0-9A-Z]{2}[A-Z]|\d{2}[A-Z][0-9A-Z]{2})(?![\p{L}\p{N}])/u;

// Error dialogs pre-fill the form with a structured error block, and the
// server-side error route sends its own; both are technical signal even when
// the reporter typed nothing.
const ERROR_REPORT_MARKER =
  /An error dialog appeared:|\(Auto-filled — please describe|^## Debug details\s*$/m;
const ERROR_REPORT_CATEGORIES = new Set([
  "error dialog report",
  "error dialog report (client network)",
  "ui error",
]);

// Words that say nothing about a problem on their own. Includes the words of
// the form's own labels, which reporters echo back to get past required
// fields ("steps", "expected result").
const FILLER_TOKENS = new Set([
  "ok",
  "okay",
  "okey",
  "k",
  "kk",
  "bug",
  "bugs",
  "n",
  "no",
  "nope",
  "yes",
  "yep",
  "yup",
  "yeah",
  "y",
  "test",
  "tests",
  "testing",
  "hi",
  "hello",
  "hey",
  "nothing",
  "none",
  "na",
  "n/a",
  "nil",
  "null",
  "idk",
  "asd",
  "xxx",
  "thanks",
  "thank",
  "you",
  "bad",
  "good",
  "fine",
  "done",
  "sorry",
  "nada",
  "rien",
  "nichts",
  "steps",
  "step",
  "to",
  "reproduce",
  "my",
  "expected",
  "actual",
  "result",
  "results",
  "environment",
  "additional",
  "context",
]);

// Scripts where one character is already a word, so a single letter is not
// "too short" there.
const LOGOGRAPHIC =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

// Runs along a keyboard row ("asdfgh", "qwerty", "zxcvbn"), or a mash of five
// or more Latin letters with no vowel ("sdrghdfn"). Four-letter acronyms such
// as "HTML" stay below that length.
const KEYBOARD_RUN = /^(?:asdf|qwert|zxcv|[b-df-hj-np-tv-xz]{5,}$)/;

const TOKEN = /[\p{L}\p{N}]+(?:\/[\p{L}\p{N}]+)*/gu;

/** The reporter's own words, with everything the form or server added removed. */
export function extractReporterText(description: string): string {
  if (typeof description !== "string") return "";
  const placeholders = new Set(
    FORM_PLACEHOLDERS.map((placeholder) => placeholder.toLowerCase()),
  );
  return description
    .replaceAll("\r\n", "\n")
    .replaceAll(HTML_TAG, " ")
    .replaceAll(MARKDOWN_SECTION_LABEL, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !METADATA_LINES.some((pattern) => pattern.test(line)) &&
        !PLAIN_LABEL_LINE.test(line) &&
        !NUMBERED_PLACEHOLDER_LINE.test(line) &&
        !placeholders.has(line.toLowerCase()),
    )
    .join("\n");
}

export function classifyReportText(
  description: string,
  options: { category?: string } = {},
): JunkClassification {
  const category =
    typeof options.category === "string"
      ? options.category.trim().toLowerCase()
      : "";
  if (ERROR_REPORT_CATEGORIES.has(category)) return { junk: false };
  if (typeof description === "string" && ERROR_REPORT_MARKER.test(description))
    return { junk: false };

  const text = extractReporterText(description);
  if (ERROR_IDENTIFIER.test(text)) return { junk: false };
  const letters = text.toLowerCase().match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return { junk: true, reason: "no_letters" };

  const tokens = (text.toLowerCase().match(TOKEN) ?? [])
    .filter((token) => !/^\p{N}+$/u.test(token))
    // "nooo", "okkk": elongation does not add meaning.
    .map((token) => token.replaceAll(/(\p{L})\1{2,}/gu, "$1"));
  if (
    tokens.every(
      (token) => FILLER_TOKENS.has(token) || KEYBOARD_RUN.test(token),
    )
  )
    return { junk: true, reason: "filler_only" };

  if (letters.length >= 3 && new Set(letters).size === 1)
    return { junk: true, reason: "repeated_char" };

  // Nothing longer than two letters ("x", "fd", "no os x"). A digit keeps a
  // report ("Q7" points at a question), and so does a logographic script,
  // where one or two characters already make a word.
  if (
    tokens.every((token) => [...token].length <= 2) &&
    !/\p{N}/u.test(text) &&
    !LOGOGRAPHIC.test(text)
  )
    return { junk: true, reason: "too_short" };

  return { junk: false };
}
