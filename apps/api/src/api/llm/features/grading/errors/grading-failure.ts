/**
 * Structured description of why an attempt could not be graded, shared by the
 * API, the job worker and the web client.
 *
 * Two kinds:
 *  - `unable_to_grade`: the submission can't be graded as submitted (dead or
 *    private link, wrong file, empty file...). The learner can fix it and
 *    resubmit; nothing is saved and nothing is reported to support.
 *  - `grading_failed`: our fault or an unexpected case. `issues` is empty.
 *
 * `message` on each issue is a complete English fallback. The web client
 * renders localized copy from `code` + `source` and only falls back to it.
 */

export type GradingFailureKind = "unable_to_grade" | "grading_failed";

export type GradingIssueCode =
  | "url_unreachable"
  | "url_placeholder"
  | "url_template_repo"
  | "url_invalid"
  | "url_blocked"
  | "url_empty"
  | "url_unsupported"
  | "url_temporarily_unavailable"
  | "file_wrong_format"
  | "file_corrupt"
  | "file_encrypted"
  | "file_empty"
  | "file_no_text"
  | "file_unsupported_type"
  | "file_too_large"
  | "source_unreadable";

export const GRADING_ISSUE_CODES: readonly GradingIssueCode[] = [
  "url_unreachable",
  "url_placeholder",
  "url_template_repo",
  "url_invalid",
  "url_blocked",
  "url_empty",
  "url_unsupported",
  "url_temporarily_unavailable",
  "file_wrong_format",
  "file_corrupt",
  "file_encrypted",
  "file_empty",
  "file_no_text",
  "file_unsupported_type",
  "file_too_large",
  "source_unreadable",
];

export interface GradingIssueSource {
  kind: "url" | "file";
  url?: string;
  fileName?: string;
  httpStatus?: number;
  detectedType?: string;
  expectedType?: string;
}

export interface GradingIssue {
  questionId: number;
  code: GradingIssueCode;
  source?: GradingIssueSource;
  retryable: boolean;
  message: string;
}

export interface GradingFailure {
  kind: GradingFailureKind;
  issues: GradingIssue[];
}

/** Details a grading layer knows about a blocked source, before the question is attached. */
export interface GradingIssueDetails {
  code: GradingIssueCode;
  source?: GradingIssueSource;
  /** Overrides the default copy for the code, e.g. a more specific catch-all. */
  message?: string;
}

export const MAX_ISSUE_URL_LENGTH = 300;
export const MAX_ISSUE_FILE_NAME_LENGTH = 200;

/** Learner URL as it may appear in a payload: no credentials, bounded length. */
export function sanitizeIssueUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let cleaned = url.trim();
  // userinfo (https://user:token@host) is never echoed back.
  cleaned = cleaned.replace(/^([a-z][\d+.a-z-]*:\/\/)[^\s/@]*@/i, "$1");
  return cleaned.slice(0, MAX_ISSUE_URL_LENGTH) || undefined;
}

export function sanitizeIssueFileName(
  fileName: string | undefined,
): string | undefined {
  if (!fileName) return undefined;
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  return base.trim().slice(0, MAX_ISSUE_FILE_NAME_LENGTH) || undefined;
}

function sanitizeSource(
  source: GradingIssueSource | undefined,
): GradingIssueSource | undefined {
  if (!source) return undefined;
  const out: GradingIssueSource = { kind: source.kind };
  const url = sanitizeIssueUrl(source.url);
  if (url) out.url = url;
  const fileName = sanitizeIssueFileName(source.fileName);
  if (fileName) out.fileName = fileName;
  if (
    typeof source.httpStatus === "number" &&
    Number.isInteger(source.httpStatus)
  ) {
    out.httpStatus = source.httpStatus;
  }
  if (source.detectedType) out.detectedType = source.detectedType.slice(0, 40);
  if (source.expectedType) out.expectedType = source.expectedType.slice(0, 40);
  return out;
}

const TYPE_LABELS: Record<string, string> = {
  html: "a web page (HTML)",
  pdf: "a PDF",
  zip: "a ZIP archive",
  png: "a PNG image",
  jpeg: "a JPEG image",
  gif: "a GIF image",
  webp: "a WebP image",
  ole: "an older Microsoft Office file",
  json: "a JSON file",
  text: "plain text",
  rar: "a RAR archive",
  "7z": "a 7-Zip archive",
  gzip: "a GZIP archive",
};

function describeType(type: string | undefined): string {
  if (!type) return "a different kind of file";
  return TYPE_LABELS[type] ?? `a .${type} file`;
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    // Not a parseable URL: the caller falls back to quoting the raw text.
    return undefined;
  }
}

/** Catch-all copy, rotated deterministically so tests (and retries) are stable. */
const SOURCE_UNREADABLE_VARIANTS: ReadonlyArray<(subject: string) => string> = [
  (subject) =>
    `We couldn't read ${subject}. Check that it opens correctly for you, then upload or link it again.`,
  (subject) =>
    `Something about ${subject} stopped us from reading it. Try saving it in a common format, or linking directly to the file, and submit again.`,
  (subject) =>
    `We weren't able to process ${subject}. Make sure it's the right file or link and that it contains your work, then try again.`,
];

function subjectOf(source: GradingIssueSource | undefined): string {
  if (source?.fileName) return `"${source.fileName}"`;
  if (source?.url) return source.url;
  return "your submission";
}

/** English, actionable copy for a code. */
export function defaultIssueMessage(
  code: GradingIssueCode,
  source: GradingIssueSource | undefined,
  questionId: number,
): string {
  const url = source?.url ?? "your link";
  const file = source?.fileName ? `"${source.fileName}"` : "Your file";
  const fileLower = source?.fileName ? `"${source.fileName}"` : "your file";
  switch (code) {
    case "url_unreachable": {
      return `We couldn't open ${url}. If it's private, make it public so it can be graded, and double-check the address, then submit again.`;
    }
    case "url_placeholder": {
      return `The link ${url} still contains placeholder text (like "your-username"). Replace it with your own GitHub username and repository name, then submit again.`;
    }
    case "url_template_repo": {
      return `${url} looks like the course's starter repository. Submit the link to your own copy (your fork or repository) instead.`;
    }
    case "url_invalid": {
      return source?.url
        ? `We couldn't read "${source.url}" as a web address. Paste the full link, starting with https://, and submit again.`
        : "We couldn't read your answer as a web address. Paste the full link, starting with https://, and submit again.";
    }
    case "url_blocked": {
      const host = hostOf(source?.url) ?? "This site";
      return `${host} doesn't allow automated access, so we couldn't read ${url}. Put your work on GitHub or another public host and submit that link instead.`;
    }
    case "url_empty": {
      return `We opened ${url} but found nothing we could read. It may be empty, or the page may only show its content in a browser. Link directly to the file or repository that contains your work.`;
    }
    case "url_unsupported": {
      return `${url} is a kind of page we can't grade (such as a project board, an issue list or an editing page). Link directly to the file or repository that contains your work.`;
    }
    case "url_temporarily_unavailable": {
      return `We couldn't reach ${url} just now. This is usually temporary, so please try again in a few minutes.`;
    }
    case "file_wrong_format": {
      const expected = source?.expectedType ? `.${source.expectedType}` : "";
      return expected
        ? `${file} isn't really a ${expected} file: its contents look like ${describeType(source?.detectedType)}. Open the original in the program that made it, save or export it as ${expected} again, and re-upload it.`
        : `${file} doesn't match its file extension: its contents look like ${describeType(source?.detectedType)}. Save it again in the right format and re-upload it.`;
    }
    case "file_corrupt": {
      return `We couldn't open ${fileLower}: it appears to be damaged or incomplete. Save or export it again from the original program and upload the new copy.`;
    }
    case "file_encrypted": {
      return `${file} is password-protected, so we can't read it. Remove the password, save the file, and upload it again.`;
    }
    case "file_empty": {
      return `${file} is empty. Check that you saved your work before uploading, then upload the file again.`;
    }
    case "file_no_text": {
      return `We couldn't find any text in ${fileLower}. It looks like a scanned or image-only document. Upload a version with selectable text, for example by exporting it to PDF from the original document.`;
    }
    case "file_unsupported_type": {
      return `${file} is in a format we can't grade here. Upload it as a supported type instead (for images: PNG, JPEG, GIF or WebP).`;
    }
    case "file_too_large": {
      return `${file} is too large to grade automatically. Make it smaller (fewer pages, rows or sheets) and upload it again.`;
    }
    case "source_unreadable": {
      const variant =
        SOURCE_UNREADABLE_VARIANTS[
          Math.abs(Math.trunc(questionId)) % SOURCE_UNREADABLE_VARIANTS.length
        ];
      return variant(subjectOf(source));
    }
  }
}

/** Builds a payload-safe issue: sanitized source, default copy, retryability. */
export function buildGradingIssue(
  questionId: number,
  details: GradingIssueDetails,
): GradingIssue {
  const source = sanitizeSource(details.source);
  const issue: GradingIssue = {
    questionId,
    code: details.code,
    retryable: details.code === "url_temporarily_unavailable",
    message:
      details.message ?? defaultIssueMessage(details.code, source, questionId),
  };
  if (source) issue.source = source;
  return issue;
}

/**
 * One-line English summary for clients that only read `progress` (255 chars).
 */
export function summarizeGradingFailure(failure: GradingFailure): string {
  if (failure.kind === "grading_failed" || failure.issues.length === 0) {
    return "Grading failed on our side. Please try again later. No new grade was saved.";
  }
  const [first] = failure.issues;
  if (failure.issues.length === 1) {
    return `${first.message} No new grade was saved.`;
  }
  return `We couldn't grade ${failure.issues.length} of your answers as submitted. ${first.message} No new grade was saved.`;
}

/** Shape check for a failure that crossed a JSON boundary (HTTP body, Redis). */
export function isGradingFailure(value: unknown): value is GradingFailure {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { kind?: unknown; issues?: unknown };
  if (
    candidate.kind !== "unable_to_grade" &&
    candidate.kind !== "grading_failed"
  ) {
    return false;
  }
  if (!Array.isArray(candidate.issues)) return false;
  return candidate.issues.every((issue: unknown) => {
    if (!issue || typeof issue !== "object") return false;
    const entry = issue as {
      questionId?: unknown;
      code?: unknown;
      message?: unknown;
      retryable?: unknown;
    };
    return (
      typeof entry.questionId === "number" &&
      typeof entry.message === "string" &&
      typeof entry.retryable === "boolean" &&
      GRADING_ISSUE_CODES.includes(entry.code as GradingIssueCode)
    );
  });
}

export function gradingFailedFailure(): GradingFailure {
  return { kind: "grading_failed", issues: [] };
}
