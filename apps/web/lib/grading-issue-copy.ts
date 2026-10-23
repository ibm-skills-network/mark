import type {
  GradingIssue,
  GradingIssueCode,
  GradingIssueSource,
} from "@/lib/grading-failure";

/**
 * Learner-facing copy for "unable to grade" issues. Every string here is an
 * English catalog key (see static-ui-translations); runtime values go in as
 * `{placeholders}` so each language keeps one stable sentence.
 */

type Translate = (
  source: string,
  params?: Record<string, string | number>,
) => string;

export const UNABLE_TO_GRADE_UI_STRINGS = {
  title: "Unable to grade",
  subtitle:
    "Nothing was graded yet. Fix the items below, then submit again — your answers are still here.",
  questionLabel: "Question {number}",
  unknownQuestionLabel: "One of your answers",
  goToQuestion: "Fix question {number}",
  goToAnswers: "Back to my answers",
  tryAgain: "Try again",
  retryHint:
    "This is a temporary problem on the other site. You don't need to change anything.",
  yourLink: "Your link:",
  yourFile: "Your file:",
} as const;

const MESSAGES = {
  urlUnreachable:
    "We couldn't open your link ({url}). If the repository is private, make it public so it can be graded, then check the address is right.",
  urlUnreachableStatus:
    "We couldn't open your link ({url}) — the site answered with error {httpStatus}. If the repository is private, make it public so it can be graded, then check the address is right.",
  urlUnreachableBare:
    "We couldn't open your link. If the repository is private, make it public so it can be graded, then check the address is right.",
  urlPlaceholder:
    "Your link still has a placeholder in it ({url}). Replace the placeholder, such as <your-username>, with your own GitHub username, then submit again.",
  urlPlaceholderBare:
    "Your link still has a placeholder in it. Replace the placeholder, such as <your-username>, with your own GitHub username, then submit again.",
  urlTemplateRepo:
    "Your link ({url}) points to the course's starter template, not your own copy. Fork or copy the template to your own account, add your work there, and submit the link to your repository.",
  urlTemplateRepoBare:
    "Your link points to the course's starter template, not your own copy. Fork or copy the template to your own account, add your work there, and submit the link to your repository.",
  urlInvalid:
    "“{url}” doesn't look like a web address. Copy the full link from your browser's address bar, starting with https://, and paste it again.",
  urlInvalidBare:
    "Your answer doesn't look like a web address. Copy the full link from your browser's address bar, starting with https://, and paste it again.",
  urlBlocked:
    "The site at {url} doesn't allow automated access, so we can't read it. Put your work on GitHub or another public host and submit that link instead.",
  urlBlockedBare:
    "The site your link points to doesn't allow automated access, so we can't read it. Put your work on GitHub or another public host and submit that link instead.",
  urlEmpty:
    "We opened your link ({url}) but found nothing to grade. Check that your work is saved or committed there, then submit again.",
  urlEmptyBare:
    "We opened your link but found nothing to grade. Check that your work is saved or committed there, then submit again.",
  urlUnsupported:
    "We can't grade this kind of page ({url}). Link directly to the file or repository that holds your work instead.",
  urlUnsupportedBare:
    "We can't grade this kind of page. Link directly to the file or repository that holds your work instead.",
  urlTemporarilyUnavailable:
    "The site hosting your link ({url}) isn't responding right now. Nothing is wrong with your answer — wait a minute and try again.",
  urlTemporarilyUnavailableBare:
    "The site hosting your link isn't responding right now. Nothing is wrong with your answer — wait a minute and try again.",
  fileWrongFormatSheetPage:
    "We couldn't read {fileName}: it's a web page saved with a .xlsx name. Open it in Excel or Google Sheets and download it as a real .xlsx file.",
  fileWrongFormatPage:
    "We couldn't read {fileName}: it's a web page saved with a .{expectedType} name. Open the original file and download or export it as a real .{expectedType} file, then upload that.",
  fileWrongFormatTypes:
    "We couldn't read {fileName}: it's really a {detectedType} file, not a .{expectedType} file. Save or export it as a real .{expectedType} file and upload it again.",
  fileWrongFormat:
    "We couldn't read {fileName}: what's inside doesn't match its file type. Save or export it again in the right format and upload it.",
  fileWrongFormatBare:
    "We couldn't read your file: what's inside doesn't match its file type. Save or export it again in the right format and upload it.",
  fileCorrupt:
    "We couldn't open {fileName} — it seems damaged or incomplete. Check that it opens on your computer, save a fresh copy, and upload it again.",
  fileCorruptBare:
    "We couldn't open your file — it seems damaged or incomplete. Check that it opens on your computer, save a fresh copy, and upload it again.",
  fileEncrypted:
    "{fileName} is password-protected, so we can't read it. Remove the password and upload it again.",
  fileEncryptedBare:
    "Your file is password-protected, so we can't read it. Remove the password and upload it again.",
  fileEmpty:
    "{fileName} is empty. Make sure your work is saved in the file, then upload it again.",
  fileEmptyBare:
    "Your file is empty. Make sure your work is saved in the file, then upload it again.",
  fileNoText:
    "{fileName} looks like a scanned image with no text we can read. Export it from the original document instead of scanning, then upload it again.",
  fileNoTextBare:
    "Your file looks like a scanned image with no text we can read. Export it from the original document instead of scanning, then upload it again.",
  fileUnsupportedType:
    "We can't grade {fileName} because its file type isn't supported here. Convert it to one of the file types this question accepts and upload it again.",
  fileUnsupportedTypeBare:
    "We can't grade your file because its file type isn't supported here. Convert it to one of the file types this question accepts and upload it again.",
  fileTooLarge:
    "{fileName} is too large for us to grade. Make it smaller — for example, remove large images or split it up — and upload it again.",
  fileTooLargeBare:
    "Your file is too large for us to grade. Make it smaller — for example, remove large images or split it up — and upload it again.",
} as const;

/** Last resort. Picked by question id so one answer always reads the same. */
export const CATCH_ALL_MESSAGES = [
  "We couldn't read your answer to this question. Check that your link or file opens for someone who isn't signed in as you, then submit again.",
  "Something in this answer stopped us from grading it. Open your link or file yourself to make sure it works, fix anything that looks off, and submit again.",
  "We weren't able to read this answer. Try saving your file again or copying your link again, then submit.",
  "This answer couldn't be graded as it is. Make sure it's the final version of your work, in a format this question accepts, and submit again.",
] as const;

export const GRADING_ISSUE_SOURCE_STRINGS: readonly string[] = [
  ...Object.values(UNABLE_TO_GRADE_UI_STRINGS),
  ...Object.values(MESSAGES),
  ...CATCH_ALL_MESSAGES,
];

/** Shortens long learner values for display, keeping both ends readable. */
export function truncateMiddle(value: string, max = 60): string {
  if (value.length <= max) return value;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

type Template = { source: string; params?: Record<string, string | number> };

function urlTemplate(
  source: GradingIssueSource | undefined,
  withUrl: string,
  bare: string,
): Template {
  return source?.url
    ? { source: withUrl, params: { url: truncateMiddle(source.url) } }
    : { source: bare };
}

function fileTemplate(
  source: GradingIssueSource | undefined,
  withFile: string,
  bare: string,
): Template {
  return source?.fileName
    ? {
        source: withFile,
        params: { fileName: truncateMiddle(source.fileName) },
      }
    : { source: bare };
}

function wrongFormatTemplate(source: GradingIssueSource | undefined): Template {
  const fileName = source?.fileName;
  const expectedType = source?.expectedType;
  const detectedType = source?.detectedType;
  if (!fileName) return { source: MESSAGES.fileWrongFormatBare };
  const name = truncateMiddle(fileName);

  if (expectedType && detectedType === "html") {
    return expectedType === "xlsx"
      ? {
          source: MESSAGES.fileWrongFormatSheetPage,
          params: { fileName: name },
        }
      : {
          source: MESSAGES.fileWrongFormatPage,
          params: { fileName: name, expectedType },
        };
  }
  if (expectedType && detectedType && expectedType !== detectedType) {
    return {
      source: MESSAGES.fileWrongFormatTypes,
      params: { fileName: name, detectedType, expectedType },
    };
  }
  return { source: MESSAGES.fileWrongFormat, params: { fileName: name } };
}

const TEMPLATES: Record<
  Exclude<GradingIssueCode, "source_unreadable">,
  (source: GradingIssueSource | undefined) => Template
> = {
  url_unreachable: (source) =>
    source?.url && source.httpStatus
      ? {
          source: MESSAGES.urlUnreachableStatus,
          params: {
            url: truncateMiddle(source.url),
            httpStatus: source.httpStatus,
          },
        }
      : urlTemplate(
          source,
          MESSAGES.urlUnreachable,
          MESSAGES.urlUnreachableBare,
        ),
  url_placeholder: (source) =>
    urlTemplate(source, MESSAGES.urlPlaceholder, MESSAGES.urlPlaceholderBare),
  url_template_repo: (source) =>
    urlTemplate(source, MESSAGES.urlTemplateRepo, MESSAGES.urlTemplateRepoBare),
  url_invalid: (source) =>
    urlTemplate(source, MESSAGES.urlInvalid, MESSAGES.urlInvalidBare),
  url_blocked: (source) =>
    urlTemplate(source, MESSAGES.urlBlocked, MESSAGES.urlBlockedBare),
  url_empty: (source) =>
    urlTemplate(source, MESSAGES.urlEmpty, MESSAGES.urlEmptyBare),
  url_unsupported: (source) =>
    urlTemplate(source, MESSAGES.urlUnsupported, MESSAGES.urlUnsupportedBare),
  url_temporarily_unavailable: (source) =>
    urlTemplate(
      source,
      MESSAGES.urlTemporarilyUnavailable,
      MESSAGES.urlTemporarilyUnavailableBare,
    ),
  file_wrong_format: wrongFormatTemplate,
  file_corrupt: (source) =>
    fileTemplate(source, MESSAGES.fileCorrupt, MESSAGES.fileCorruptBare),
  file_encrypted: (source) =>
    fileTemplate(source, MESSAGES.fileEncrypted, MESSAGES.fileEncryptedBare),
  file_empty: (source) =>
    fileTemplate(source, MESSAGES.fileEmpty, MESSAGES.fileEmptyBare),
  file_no_text: (source) =>
    fileTemplate(source, MESSAGES.fileNoText, MESSAGES.fileNoTextBare),
  file_unsupported_type: (source) =>
    fileTemplate(
      source,
      MESSAGES.fileUnsupportedType,
      MESSAGES.fileUnsupportedTypeBare,
    ),
  file_too_large: (source) =>
    fileTemplate(source, MESSAGES.fileTooLarge, MESSAGES.fileTooLargeBare),
};

export function catchAllMessage(questionId: number, t: Translate): string {
  const index = Math.abs(Math.trunc(questionId)) % CATCH_ALL_MESSAGES.length;
  return t(CATCH_ALL_MESSAGES[index]);
}

/**
 * The learner-facing fix for one issue: localized copy for a known code, the
 * server's English message for a code this client doesn't know yet, and a
 * catch-all when there is nothing better. `source_unreadable` is itself the
 * server's catch-all: its message is the most specific advice there is, so an
 * English reader gets it, and everyone else a localized catch-all.
 */
export function describeGradingIssue(
  issue: GradingIssue,
  t: Translate,
  options: { isEnglish: boolean },
): string {
  if (issue.code === "source_unreadable") {
    return options.isEnglish && issue.message
      ? issue.message
      : catchAllMessage(issue.questionId, t);
  }
  if (Object.hasOwn(TEMPLATES, issue.code)) {
    const template = TEMPLATES[issue.code as keyof typeof TEMPLATES](
      issue.source,
    );
    return t(template.source, template.params);
  }
  return issue.message || catchAllMessage(issue.questionId, t);
}

/** Only plain web links are made clickable; anything else stays text. */
export function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : undefined;
  } catch {
    // Not parseable as a URL: it is shown as plain text instead.
    return undefined;
  }
}
