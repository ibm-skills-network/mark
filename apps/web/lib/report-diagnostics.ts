import { recentRequests, type RecordedRequest } from "@/lib/request-log";
import { useLearnerStore } from "@/stores/learner";

/**
 * What this browser held when a bug report was filed. It rides along with the
 * report without the reporter seeing it, so it is deliberately narrow: what
 * was on screen and how recent requests ended — never typed answers, answer
 * keys, cookies, request bodies or query strings. The server rebuilds it from
 * known keys, so anything added here must be added there too.
 */
export interface ReportDiagnosticsPayload {
  v: 1;
  capturedAt: string;
  session: {
    attemptId?: number;
    assignmentId?: number;
    role?: string;
    uiLanguage?: string;
    attemptLanguage?: string;
    buildVersion?: string;
  };
  page: {
    url?: string;
    userAgent?: string;
    viewport?: string;
    inIframe?: boolean;
    clockSkewMs?: number;
  };
  draft: {
    activeAttemptId: number | null;
    questions: {
      id: number;
      status?: string;
      selected: string[];
      textLength: number;
    }[];
  };
  rendered: {
    questionId: number;
    type?: string;
    choices: { text: string; selected: boolean }[];
  }[];
  requests: RecordedRequest[];
}

const CHOICE_TYPES = new Set(["SINGLE_CORRECT", "MULTIPLE_CORRECT"]);

/** Query strings can carry OAuth codes; only the language is worth keeping. */
function pageUrlWithoutSecrets(): string {
  const url = new URL(window.location.href);
  const lang = url.searchParams.get("lang");
  const authorMode = url.searchParams.get("authorMode");
  url.search = "";
  url.hash = "";
  if (lang) url.searchParams.set("lang", lang);
  if (authorMode) url.searchParams.set("authorMode", authorMode);
  return url.toString();
}

function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Reading window.top across origins throws, which itself means framed.
    return true;
  }
}

function readUiLanguage(): string | undefined {
  try {
    return localStorage.getItem("ui-language") ?? undefined;
  } catch {
    // Storage can be blocked (private mode, embedded third-party context).
    return undefined;
  }
}

/**
 * @param context - Identity the caller already has; advisory only, the server
 *   takes the reporter from the signed session
 * @returns The capture, or undefined when it could not be built. Collection
 *   must never stop a report from being filed.
 */
export function collectReportDiagnostics(context: {
  role?: string;
  assignmentId?: number;
}): ReportDiagnosticsPayload | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const state = useLearnerStore.getState();
    const language = state.userPreferedLanguage ?? undefined;
    const questions = state.questions ?? [];

    return {
      v: 1,
      capturedAt: new Date().toISOString(),
      session: {
        attemptId: state.activeAttemptId ?? undefined,
        assignmentId: context.assignmentId,
        role: context.role,
        uiLanguage: readUiLanguage(),
        attemptLanguage: language,
        buildVersion: process.env.NEXT_PUBLIC_APP_VERSION,
      },
      page: {
        url: pageUrlWithoutSecrets(),
        userAgent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        inIframe: inIframe(),
        clockSkewMs:
          typeof state.serverTimeOffsetMs === "number"
            ? Math.round(state.serverTimeOffsetMs)
            : undefined,
      },
      draft: {
        activeAttemptId: state.activeAttemptId ?? null,
        questions: questions.map((question) => ({
          id: question.id,
          status: question.status,
          selected: (question.learnerChoices ?? []).map(String),
          textLength: (question.learnerTextResponse ?? "").length,
        })),
      },
      // The same rule the quiz uses to pick the text it shows: the learner's
      // language when the question has it, the authored choice otherwise.
      rendered: questions
        .filter((question) => CHOICE_TYPES.has(question.type))
        .map((question) => {
          const translated =
            language === undefined
              ? undefined
              : question.translations?.[language]?.translatedChoices;
          const selected = new Set((question.learnerChoices ?? []).map(String));
          return {
            questionId: question.id,
            type: question.type,
            choices: (question.choices ?? []).map((choice, index) => ({
              text: String((translated?.[index] ?? choice)?.choice ?? ""),
              selected: selected.has(String(index)),
            })),
          };
        }),
      requests: recentRequests(),
    };
  } catch (error) {
    console.warn("collectReportDiagnostics: capture failed", error);
    return undefined;
  }
}
