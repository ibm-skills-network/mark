/**
 * Single source of truth for checking and normalizing the URL a learner types
 * into a URL / link-file question.
 *
 * Two copies of a hand-rolled regex used to live in `lib/utils.ts` and in the
 * URL question component. That regex disagreed with the server in both
 * directions: it rejected a pasted link with a trailing space (which the
 * server trims and grades fine) and it accepted a schemeless
 * `github.com/owner/repo/blob/...` (which the server could not parse, so the
 * answer was scored zero). Both sides now run the same rules, and this file is
 * mirrored by `apps/api/src/api/attempt/common/utils/learner-url.util.ts` —
 * the two carry the same fixture list, so a change here needs the same change
 * there.
 *
 * The client check exists to save a learner from submitting something that
 * cannot be fetched at all. It is never a trust boundary: the server re-runs
 * the same normalization on whatever actually arrives.
 */

/** Upper bound mirrored by the request DTO's `@MaxLength` on the API side. */
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
   * Advisory only — a question that asks for a GitHub link still accepts a
   * link somewhere else, because authors do not always mean the allow list
   * literally. Never gates submission or scoring.
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
 * Without that guard `new URL()` happily turns a stray word into
 * `https://word/`, and a typo would be "fetched" instead of reported.
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
 * scheme off. Returns an empty string when the value cannot be made into one.
 */
export function normalizeLearnerUrl(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed.length > MAX_LEARNER_URL_LENGTH) return "";

  const candidate = SCHEME_RE.test(trimmed)
    ? trimmed
    : looksLikeHost(trimmed)
      ? `https://${trimmed}`
      : "";
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

/** Convenience predicate for call sites that only care whether it parses. */
export function isLearnerUrlSubmittable(
  raw: string | null | undefined,
): boolean {
  return validateLearnerUrl(raw).isValid;
}

/** Response types whose prompt asks the learner for a repository link. */
export function expectedHostsForResponseType(
  responseType: string | null | undefined,
): readonly string[] | undefined {
  return responseType === "REPO" ? GITHUB_EXPECTED_HOSTS : undefined;
}

/** Learner-facing copy for a rejection, shown inline next to the input. */
export function describeLearnerUrlProblem(
  validation: LearnerUrlValidation,
): string | undefined {
  if (validation.isValid) {
    return validation.isUnexpectedHost
      ? "This question asks for a GitHub link. Double-check the address if that's what you meant to send."
      : undefined;
  }
  switch (validation.rejection) {
    case "too_long": {
      return "That link is too long to submit. Please shorten it and try again.";
    }
    case "unsupported_scheme": {
      return "Only web links starting with http:// or https:// can be submitted.";
    }
    default: {
      return "That doesn't look like a web address yet. A link such as https://github.com/owner/repo works.";
    }
  }
}
