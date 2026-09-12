/**
 * Server-side normalization for the URL a learner submits to a URL /
 * link-file question.
 *
 * Mirrors `apps/web/lib/url-response.ts` so the browser never blocks a
 * submission the grader would have accepted, and never accepts one the grader
 * cannot parse. The client copy is a convenience; this copy is the one that
 * decides, because the request body is not trusted.
 *
 * The rules, in order: trim surrounding whitespace, add `https://` when the
 * learner left the scheme off and what they typed could plausibly be a host,
 * parse with `new URL()`, and require an http(s) scheme. A value that survives
 * all of that is handed to the fetch pipeline; anything else is a learner input
 * error that gets graded zero with an explanation rather than failing the job.
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

/**
 * Trims surrounding whitespace and adds `https://` when the learner left the
 * scheme off. Returns an empty string when the value cannot be made into a
 * fetchable http(s) URL.
 */
export function normalizeLearnerUrl(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
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
  const trimmed = (raw ?? "").trim();
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
