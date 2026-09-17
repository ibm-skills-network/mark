/**
 * Diagnostics a client attaches to a bug report: what the reporter's browser
 * held at that moment. It is written by the browser, so nothing in it is
 * trusted — it is rebuilt here from known keys with checked types and bounded
 * sizes, and whatever does not fit is dropped. It never identifies the
 * reporter; that always comes from the signed session.
 */

export const MAX_DIAGNOSTICS_BYTES = 64 * 1024;

const MAX_DRAFT_QUESTIONS = 100;
const MAX_RENDERED_QUESTIONS = 100;
const MAX_CHOICES = 12;
const MAX_REQUESTS = 20;

export interface ReportDiagnostics {
  v: 1;
  capturedAt?: string;
  session?: {
    attemptId?: number;
    assignmentId?: number;
    role?: string;
    uiLanguage?: string;
    attemptLanguage?: string;
    buildVersion?: string;
  };
  page?: {
    url?: string;
    userAgent?: string;
    viewport?: string;
    inIframe?: boolean;
    clockSkewMs?: number;
  };
  draft?: {
    activeAttemptId?: number | null;
    questions: {
      id: number;
      status?: string;
      selected?: string[];
      textLength?: number;
    }[];
  };
  rendered?: {
    questionId: number;
    type?: string;
    choices: { text: string; selected: boolean }[];
  }[];
  requests?: {
    method: string;
    path: string;
    status: number | null;
    ms?: number;
    requestId?: string;
    at?: string;
  }[];
}

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : undefined;

const int = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;

const bool = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const list = (value: unknown, max: number): unknown[] =>
  Array.isArray(value) ? value.slice(0, max) : [];

/** Drop keys whose value did not survive, so the stored shape stays tight. */
function compact<T extends Bag>(bag: T): T {
  return Object.fromEntries(
    Object.entries(bag).filter(([, value]) => value !== undefined),
  ) as T;
}

function sanitizeSession(value: unknown): ReportDiagnostics["session"] {
  if (!isBag(value)) return undefined;
  return compact({
    attemptId: int(value.attemptId),
    assignmentId: int(value.assignmentId),
    role: text(value.role, 20),
    uiLanguage: text(value.uiLanguage, 20),
    attemptLanguage: text(value.attemptLanguage, 20),
    buildVersion: text(value.buildVersion, 40),
  });
}

function sanitizePage(value: unknown): ReportDiagnostics["page"] {
  if (!isBag(value)) return undefined;
  return compact({
    url: text(value.url, 500),
    userAgent: text(value.userAgent, 300),
    viewport: text(value.viewport, 20),
    inIframe: bool(value.inIframe),
    clockSkewMs: int(value.clockSkewMs),
  });
}

function sanitizeDraft(value: unknown): ReportDiagnostics["draft"] {
  if (!isBag(value)) return undefined;
  const questions = list(value.questions, MAX_DRAFT_QUESTIONS).flatMap(
    (question) => {
      if (!isBag(question)) return [];
      const id = int(question.id);
      if (id === undefined) return [];
      const selected = list(question.selected, MAX_CHOICES).flatMap((item) => {
        const kept = text(item, 20);
        return kept === undefined ? [] : [kept];
      });
      return [
        compact({
          id,
          status: text(question.status, 20),
          selected: Array.isArray(question.selected) ? selected : undefined,
          textLength: int(question.textLength),
        }),
      ];
    },
  );
  const activeAttemptId =
    value.activeAttemptId === null ? null : int(value.activeAttemptId);
  return compact({ activeAttemptId, questions });
}

function sanitizeRendered(value: unknown): ReportDiagnostics["rendered"] {
  if (!Array.isArray(value)) return undefined;
  return list(value, MAX_RENDERED_QUESTIONS).flatMap((question) => {
    if (!isBag(question)) return [];
    const questionId = int(question.questionId);
    if (questionId === undefined) return [];
    const choices = list(question.choices, MAX_CHOICES).flatMap((choice) => {
      if (!isBag(choice)) return [];
      const shown = text(choice.text, 300);
      return shown === undefined
        ? []
        : [{ text: shown, selected: choice.selected === true }];
    });
    return [compact({ questionId, type: text(question.type, 30), choices })];
  });
}

function sanitizeRequests(value: unknown): ReportDiagnostics["requests"] {
  if (!Array.isArray(value)) return undefined;
  return list(value, MAX_REQUESTS).flatMap((request) => {
    if (!isBag(request)) return [];
    const method = text(request.method, 10);
    // A query string can carry an OAuth code or a token; the path is enough
    // to find the request in the logs.
    const path = text(request.path, 300)?.split("?")[0];
    if (!method || !path) return [];
    return [
      compact({
        method,
        path,
        status: int(request.status) ?? null,
        ms: int(request.ms),
        requestId: text(request.requestId, 80),
        at: text(request.at, 40),
      }),
    ];
  });
}

/**
 * @param raw - The `diagnostics` form field exactly as received
 * @returns The rebuilt diagnostics, or undefined when there is nothing usable
 */
export function sanitizeReportDiagnostics(
  raw: unknown,
): ReportDiagnostics | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  if (Buffer.byteLength(raw, "utf8") > MAX_DIAGNOSTICS_BYTES) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON: there is nothing to keep, and the report does not depend on it.
    return undefined;
  }
  if (!isBag(parsed)) return undefined;

  return compact({
    v: 1 as const,
    capturedAt: text(parsed.capturedAt, 40),
    session: sanitizeSession(parsed.session),
    page: sanitizePage(parsed.page),
    draft: sanitizeDraft(parsed.draft),
    rendered: sanitizeRendered(parsed.rendered),
    requests: sanitizeRequests(parsed.requests),
  });
}

/**
 * One line for the support ticket. The capture itself stays in Mark: it holds
 * what the learner had on screen, which does not belong in a support system.
 */
export function summarizeReportDiagnostics(
  diagnostics: ReportDiagnostics,
): string {
  const requests = diagnostics.requests ?? [];
  const failed = requests.filter(
    (request) => request.status === null || request.status >= 400,
  ).length;
  const attempt = diagnostics.session?.attemptId ?? "unknown";
  const language =
    diagnostics.session?.attemptLanguage ??
    diagnostics.session?.uiLanguage ??
    "unknown";
  return `Diagnostics captured: attempt ${attempt}, language ${language}, ${failed} of ${requests.length} recent requests failed. Full capture: Mark admin > Reports.`;
}
