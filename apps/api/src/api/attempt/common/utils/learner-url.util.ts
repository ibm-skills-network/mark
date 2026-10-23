/**
 * Server-side normalization for the URL a learner submits to a URL /
 * link-file question.
 *
 * Mirrors `apps/web/lib/url-response.ts` so the browser never blocks a
 * submission the grader would have accepted, and never accepts one the grader
 * cannot parse. The client copy is a convenience; this copy is the one that
 * decides, because the request body is not trusted.
 *
 * The rules, in order: pull the link out of whatever else was pasted around
 * it (see `cleanLearnerUrlText`), add `https://` when the learner left the
 * scheme off and what they typed could plausibly be a host, parse with
 * `new URL()`, and require an http(s) scheme. A value that survives all of that
 * is handed to the fetch pipeline; anything else is reported back to the
 * learner as an unreadable address.
 */

/** Upper bound mirrored by the request DTO's `@MaxLength`. */
export const MAX_LEARNER_URL_LENGTH = 2048;

/** Hosts that count as "a GitHub link" for questions that ask for one. */
export const GITHUB_EXPECTED_HOSTS: readonly string[] = [
  "github.com",
  "www.github.com",
  "gist.github.com",
  "raw.githubusercontent.com",
  "github.io",
];

export type LearnerUrlRejection =
  | "empty"
  | "too_long"
  | "unparseable"
  | "unsupported_scheme";

export interface LearnerUrlValidation {
  /** False only when the value cannot become a fetchable http(s) URL at all. */
  isValid: boolean;
  /** Trimmed, scheme-qualified URL. Empty string when `isValid` is false. */
  normalizedUrl: string;
  rejection?: LearnerUrlRejection;
  /**
   * True when `expectedHosts` was supplied and the parsed host is not on it.
   * Advisory only: it is logged for the author's benefit and never changes the
   * score, because an author asking for "your GitHub repo" still gets links to
   * other hosts that are legitimately gradeable.
   */
  isUnexpectedHost: boolean;
}

export interface LearnerUrlOptions {
  expectedHosts?: readonly string[];
}

const SCHEME_RE = /^[a-z][\d+.a-z-]*:/i;

/**
 * Last labels that mean "this is a filename, not a host". A learner who types
 * `general.js` on its own is naming the file they meant to link, not a site;
 * without this list `new URL()` would happily treat it as the host
 * `general.js` and the grader would report an unreachable page instead of an
 * unusable answer. Only applied when there is no path to speak of.
 */
const FILE_EXTENSION_LAST_LABELS = new Set([
  "c",
  "cpp",
  "cs",
  "css",
  "csv",
  "docx",
  "go",
  "html",
  "ipynb",
  "java",
  "jpeg",
  "jpg",
  "js",
  "json",
  "jsx",
  "kt",
  "md",
  "pdf",
  "php",
  "png",
  "pptx",
  "py",
  "rb",
  "rs",
  "sql",
  "swift",
  "ts",
  "tsx",
  "txt",
  "xlsx",
  "zip",
]);

/**
 * A schemeless value only gets `https://` when what precedes the first slash
 * could plausibly be a host: a dotted name, `localhost`, or an IP literal.
 * Without that guard `new URL()` turns a stray word into `https://word/`, and
 * junk like "dgtj" would be fetched instead of reported back to the learner.
 */
function looksLikeHost(candidate: string): boolean {
  if (!candidate || /\s/.test(candidate)) return false;
  const hostOnly = candidate.split(/[#/?]/)[0].split("@").pop() ?? "";
  const withoutPort = hostOnly.replace(/:\d+$/, "");
  if (withoutPort === "localhost") return true;
  if (!withoutPort.includes(".")) return false;
  const lastLabel = (withoutPort.split(".").pop() ?? "").toLowerCase();
  const hasPath = /[#/?]/.test(candidate);
  if (!hasPath && FILE_EXTENSION_LAST_LABELS.has(lastLabel)) return false;
  return /^[a-z]{2,}$/i.test(lastLabel) || /^\d+$/.test(lastLabel);
}

// Zero-width space/joiners, word joiner and BOM: invisible, copied along with
// links from chat tools and docs, and they turn a good path into a 404.
const INVISIBLE_CHARS_RE = /[\u200B-\u200D\u2060\uFEFF]/g;
const URL_START_RE = /https?:\/\//i;
// Characters that end a sentence or wrap a link rather than belong to it.
const TRAILING_PUNCTUATION_RE = /[\s!"'*,.:;>?\]`}]+$/;
const TRACKING_PARAM_RE = /^(?:utm_[\w-]*|fbclid|gclid|mc_[ce]id)$/i;

function stripTrackingParameters(url: string): string {
  const hashIndex = url.indexOf("#");
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const queryIndex = beforeHash.indexOf("?");
  if (queryIndex === -1) return url;
  const base = beforeHash.slice(0, queryIndex);
  const kept = beforeHash
    .slice(queryIndex + 1)
    .split("&")
    .filter((pair) => pair && !TRACKING_PARAM_RE.test(pair.split("=")[0]));
  return `${base}${kept.length > 0 ? `?${kept.join("&")}` : ""}${hash}`;
}

/** Cuts a ")" that closes a paren opened before the link, keeping balanced ones. */
function cutUnbalancedParen(url: string): string {
  let depth = 0;
  for (let index = 0; index < url.length; index += 1) {
    const char = url[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      if (depth === 0) return url.slice(0, index);
      depth -= 1;
    }
  }
  return url;
}

function hostOf(url: string): string {
  return (/^https?:\/\/([^#/?]*)/i.exec(url)?.[1] ?? "").toLowerCase();
}

/**
 * Cuts a second URL pasted straight onto the first ("…/Dockerfilehttps://…").
 * A URL carried inside the first one is kept: as a query value
 * ("?url=https://…"), after a fragment or encoded, or as a path segment
 * pointing at another host ("web.archive.org/web/2020/https://…"). A
 * path-segment URL on the same host is the same link pasted twice.
 */
function cutPastedSecondUrl(text: string): string {
  const schemeLength = /^https?:\/\//i.exec(text)?.[0].length ?? 0;
  let from = schemeLength;
  while (from < text.length) {
    const offset = text.slice(from).search(URL_START_RE);
    if (offset === -1) return text;
    const index = from + offset;
    const before = text[index - 1];
    const embedded =
      /[#%&:=?]/.test(before) ||
      (before === "/" && hostOf(text.slice(index)) !== hostOf(text));
    if (!embedded) return text.slice(0, index);
    from = index + 1;
  }
  return text;
}

/**
 * Pulls the link out of a pasted answer. Learners paste a URL followed by
 * notes ("…/App.jsx Grading Feedback"), a Markdown link ("…](https://…"), the
 * same URL twice with no separator, or a link copied from the GitHub editor.
 * The first URL wins; text before it, invisible characters, trailing
 * punctuation and tracking parameters are dropped, and a GitHub `/edit/` link
 * becomes the matching `/blob/` link. Text without a scheme is only trimmed,
 * so the schemeless rules below still apply to it.
 */
export function cleanLearnerUrlText(raw: string | null | undefined): string {
  let text = (raw ?? "").replaceAll(INVISIBLE_CHARS_RE, "").trim();
  const start = text.search(URL_START_RE);
  if (start === -1) return text;

  text = text.slice(start);
  const whitespace = text.search(/\s/);
  if (whitespace !== -1) text = text.slice(0, whitespace);
  const markdownJoin = text.indexOf("](");
  if (markdownJoin !== -1) text = text.slice(0, markdownJoin);
  text = cutPastedSecondUrl(text);
  text = cutUnbalancedParen(text);

  // A trailing ">" only closes an <https://…> wrapper. Inside a placeholder
  // such as <your-username> it is part of what the learner typed.
  const hasOpenAngle = text.includes("<");
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text.replace(TRAILING_PUNCTUATION_RE, (match) =>
      hasOpenAngle && match.includes(">") ? match.replace(/[^>]+$/, "") : "",
    );
  }

  text = stripTrackingParameters(text);
  text = text.replace(
    /^(https?:\/\/(?:www\.)?github\.com\/[^/]+\/[^/]+)\/edit\//i,
    "$1/blob/",
  );
  return text;
}

/**
 * Cleans the pasted answer (see `cleanLearnerUrlText`) and adds `https://`
 * when the learner left the scheme off. Returns an empty string when the
 * value cannot be made into a fetchable http(s) URL.
 */
export function normalizeLearnerUrl(raw: string | null | undefined): string {
  const trimmed = cleanLearnerUrlText(raw);
  if (!trimmed || trimmed.length > MAX_LEARNER_URL_LENGTH) return "";

  let candidate = "";
  if (SCHEME_RE.test(trimmed)) {
    candidate = trimmed;
  } else if (looksLikeHost(trimmed)) {
    candidate = `https://${trimmed}`;
  }
  if (!candidate) return "";

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (!parsed.hostname) return "";
    // Return the candidate rather than `parsed.toString()`: round-tripping
    // through URL appends a trailing slash to a bare host and percent-encodes
    // the path, which would rewrite the learner's answer in the stored
    // response and in the feedback quoted back to them.
    return candidate;
  } catch {
    // Not a parse failure worth logging: an unparseable learner answer is
    // ordinary input, reported back through the grading feedback by the
    // caller rather than treated as a system fault.
    return "";
  }
}

/** Full result: what the URL normalizes to, and why it was rejected if it was. */
export function validateLearnerUrl(
  raw: string | null | undefined,
  options: LearnerUrlOptions = {},
): LearnerUrlValidation {
  const trimmed = cleanLearnerUrlText(raw);
  if (!trimmed) {
    return {
      isValid: false,
      normalizedUrl: "",
      rejection: "empty",
      isUnexpectedHost: false,
    };
  }
  if (trimmed.length > MAX_LEARNER_URL_LENGTH) {
    return {
      isValid: false,
      normalizedUrl: "",
      rejection: "too_long",
      isUnexpectedHost: false,
    };
  }

  const hasScheme = SCHEME_RE.test(trimmed);
  const normalizedUrl = normalizeLearnerUrl(trimmed);
  if (!normalizedUrl) {
    return {
      isValid: false,
      normalizedUrl: "",
      rejection: hasScheme ? "unsupported_scheme" : "unparseable",
      isUnexpectedHost: false,
    };
  }

  const { expectedHosts } = options;
  let isUnexpectedHost = false;
  if (expectedHosts && expectedHosts.length > 0) {
    const host = new URL(normalizedUrl).hostname.toLowerCase();
    isUnexpectedHost = !expectedHosts.some(
      (expected) => host === expected || host.endsWith(`.${expected}`),
    );
  }

  return { isValid: true, normalizedUrl, isUnexpectedHost };
}

/** Response types whose prompt asks the learner for a repository link. */
export function expectedHostsForResponseType(
  responseType: string | null | undefined,
): readonly string[] | undefined {
  return responseType === "REPO" ? GITHUB_EXPECTED_HOSTS : undefined;
}
