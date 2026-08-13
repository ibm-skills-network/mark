/*eslint-disable*/
/**
 * API functions specific to learners
 */
import { getApiRoutes } from "@/config/constants";
import type {
  AssignmentAttempt,
  AssignmentAttemptWithQuestions,
  AssignmentFeedback,
  BaseBackendResponse,
  LiveRecordingData,
  QuestionAttemptRequest,
  QuestionAttemptRequestWithId,
  QuestionAttemptResponse,
  QuestionStore,
  RegradingRequest,
  ReplaceAssignmentRequest,
  REPORT_TYPE,
  SubmitAssignmentResponse,
} from "@config/types";
import { toast } from "sonner";
import { submitReportAuthor } from "@/lib/talkToBackend";
import { apiClient, APIError } from "./api-client";
import { isAuthApiError, withTransientRetry } from "./api-retry";
import { normalizeAttemptTimestamps } from "@/app/learner/utils/attempts";
import {
  GradingWatchdog,
  SSE_MAX_CONNECTION_ATTEMPTS,
  SSE_RECONNECT_BACKOFF_STEP_MS,
} from "./grading-stream-watchdog";

/**
 * Machine-readable codes the API puts in 422 bodies from
 * validateNewAttempt. Keep in sync with
 * apps/api/src/api/assignment/attempt/api-exceptions/exceptions.ts.
 */
const ATTEMPT_IN_PROGRESS_CODE = "ATTEMPT_IN_PROGRESS";
const ATTEMPT_TIME_RANGE_EXCEEDED_CODE = "ATTEMPT_TIME_RANGE_EXCEEDED";

/**
 * Creates a attempt for a given assignment.
 * @param assignmentId The id of the assignment to create the attempt for.
 * @returns The id of the created attempt.
 * @throws An error if the request fails.
 */
export async function createAttempt(
  assignmentId: number,
  cookies?: string,
): Promise<
  | number
  | undefined
  | "no more attempts"
  | "in cooldown period"
  | "ai temporarily unavailable"
  | "attempt in progress"
  | "time range exceeded"
> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts`;
  try {
    const res = await apiClient.post<BaseBackendResponse>(
      endpointURL,
      undefined,
      {
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );
    const { success, error, id } = res;
    if (!success) {
      throw new Error(error);
    }

    return id;
  } catch (err) {
    // Duck-type the error rather than `instanceof APIError`: across Next's
    // server/SSR module boundary the APIError class identity can differ, so
    // `instanceof` silently returns false and every branch falls through to
    // `undefined`. Reading `.status` / `.body.code` works regardless.
    if (isAiTemporarilyDisabled(err)) {
      // AI grading kill-switch is engaged for this AI-graded assignment.
      return "ai temporarily unavailable";
    }
    const status = getErrorStatus(err);
    if (status === 422) {
      // The API throws 422 for three distinct reasons; only a real max-attempts
      // lockout may surface as "no more attempts". Match on the body code, not
      // the status. An uncoded 422 (older API) keeps the legacy fallback.
      const code = getErrorCode(err);
      if (code === ATTEMPT_IN_PROGRESS_CODE) {
        return "attempt in progress";
      }
      if (code === ATTEMPT_TIME_RANGE_EXCEEDED_CODE) {
        return "time range exceeded";
      }
      return "no more attempts";
    } else if (status === 429) {
      return "in cooldown period";
    }
    return undefined;
  }
}

/** HTTP status off an unknown thrown error (APIError or any `{status}` shape). */
function getErrorStatus(err: unknown): number | undefined {
  return (err as { status?: number } | undefined)?.status;
}

/** Body `code` off an unknown thrown error (APIError or any `{body}` shape). */
function getErrorCode(err: unknown): string | undefined {
  return (err as { body?: { code?: string } } | undefined)?.body?.code;
}

/**
 * Recognises the AI kill-switch response. Matches on the body `code` first (the
 * stable signal) and falls back to HTTP 409 — the status the backend now uses
 * because gateways/meshes mangle 503s into generic 500s. Accepts `unknown` and
 * duck-types so it survives the Next server-module-identity `instanceof` gotcha.
 */
export function isAiTemporarilyDisabled(err: unknown): boolean {
  return (
    getErrorCode(err) === "AI_TEMPORARILY_DISABLED" ||
    getErrorStatus(err) === 409
  );
}

/**
 * States the grading spinner can be in. `stalled` means the stream is alive
 * but grading has stopped advancing — the learner is told, nothing is torn
 * down. `disconnected` is terminal: either the stream is gone or the stall
 * outlasted its hard window.
 */
export type GradingProgressStatus =
  | "processing"
  | "completed"
  | "failed"
  | "stalled"
  | "disconnected";

/**
 * Thrown when the grading stream stops being a usable source of truth. It is
 * NOT a statement that grading failed — the job may well still be running
 * server-side — so callers should keep the learner's context and offer a way
 * to re-check, not report a failed submission.
 */
export class GradingStreamLostError extends Error {
  constructor(
    message: string,
    readonly assignmentId: number,
    readonly attemptId: number,
    readonly reason: "disconnected" | "stalled",
  ) {
    super(message);
    this.name = "GradingStreamLostError";
  }
}

/**
 * Duck-typed on purpose. `instanceof` is unreliable across Next's module
 * boundary (the same reason the kill-switch check above does not use it), and
 * a missed match here would close the modal on the learner instead of showing
 * them the recovery actions.
 */
export function isGradingStreamLostError(
  error: unknown,
): error is GradingStreamLostError {
  return error instanceof Error && error.name === "GradingStreamLostError";
}

/**
 * Discards a pristine attempt (no responses) that is pinned to a stale
 * assignment version. The next createAttempt call will produce a fresh attempt
 * against the current version.
 *
 * Returns true on success; false if the backend rejected the abandon (already
 * has responses, version isn't actually stale, etc.) so the caller can leave
 * the existing attempt alone.
 */
export async function abandonAttempt(
  assignmentId: number,
  attemptId: number,
): Promise<boolean> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/abandon`;
  try {
    await apiClient.post<{ id: number; success: true }>(endpointURL, {});
    return true;
  } catch (err) {
    console.error("abandonAttempt failed", err);
    return false;
  }
}

/**
 * gets the questions for a given uncompleted attempt and assignment
 * @param assignmentId The id of the assignment to get the questions for.
 * @param attemptId The id of the attempt to get the questions for.
 * @returns An array of questions.
 * @throws An error if the request fails.
 */
export async function getAttempt(
  assignmentId: number,
  attemptId: number,
  cookies?: string,
  language = "en",
  options?: { throwOnAuthError?: boolean },
): Promise<AssignmentAttemptWithQuestions | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}?lang=${language}`;

  try {
    // quiet: a momentary failure must not flash an error toast — it either
    // recovers on the retry below or the caller renders a real error screen.
    const attempt = await withTransientRetry(() =>
      apiClient.get<AssignmentAttemptWithQuestions>(endpointURL, {
        quiet: true,
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      }),
    );
    if (!attempt) {
      return undefined;
    }

    const fallbackAllotedMinutes =
      attempt.assignmentVersion?.allotedTimeMinutes ??
      attempt.assignmentDetails?.allotedTimeMinutes ??
      attempt.assignment?.allotedTimeMinutes ??
      null;

    return normalizeAttemptTimestamps(attempt, fallbackAllotedMinutes);
  } catch (err) {
    if (options?.throwOnAuthError && isAuthApiError(err)) {
      throw err;
    }
    console.error(
      `getAttempt failed for assignment ${assignmentId}, attempt ${attemptId}:`,
      err,
    );
    return undefined;
  }
}

/**
 * gets the questions for a given completed attempt and assignment
 * @param assignmentId The id of the assignment to get the questions for.
 * @param attemptId The id of the attempt to get the questions for.
 * @returns An array of questions.
 * @throws An error if the request fails.
 */
export async function getCompletedAttempt(
  assignmentId: number,
  attemptId: number,
  cookies?: string,
): Promise<AssignmentAttemptWithQuestions | undefined> {
  // Author-preview attempts use the sentinel id -1 and are never persisted
  // server-side, so requesting one is a guaranteed 403 — which the api-client
  // surfaces as a "no permission / log into AWB" toast on every preview
  // completion. Skip straight to the caller's store fallback instead.
  if (attemptId < 0) {
    return undefined;
  }

  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/completed`;

  try {
    const attempt = await apiClient.get<AssignmentAttemptWithQuestions>(
      endpointURL,
      {
        headers: {
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );
    if (!attempt) {
      return undefined;
    }

    const fallbackAllotedMinutes =
      attempt.assignmentVersion?.allotedTimeMinutes ??
      attempt.assignmentDetails?.allotedTimeMinutes ??
      attempt.assignment?.allotedTimeMinutes ??
      null;

    return normalizeAttemptTimestamps(attempt, fallbackAllotedMinutes);
  } catch (err) {
    return undefined;
  }
}

/**
 * Gets unified success page data for an attempt (works for both authors and learners).
 * @param assignmentId The id of the assignment.
 * @param attemptId The id of the attempt.
 * @param authorData Optional author data from Zustand stores (for authors only).
 * @param cookies Optional cookies for authentication.
 * @returns Success page data or undefined if error.
 */
export async function getSuccessPageData(
  assignmentId: number,
  attemptId: number,
  authorData?: {
    questions: any[];
    grade: number;
    totalPointsEarned: number;
    totalPointsPossible: number;
    responses: any[];
  },
  cookies?: string,
): Promise<any | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/success-page-data`;

  try {
    const data = await apiClient.post(endpointURL, authorData || {}, {
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    return data;
  } catch (err) {
    return undefined;
  }
}

export type SubmitQuestionResult =
  | { ok: true; data: QuestionAttemptResponse }
  | { ok: false; status?: number; message?: string };

/**
 * A message straight from a 4xx response body, safe to show a learner
 * verbatim — e.g. `OversizedSubmissionError.learnerMessage`, which the API
 * wraps in a `BadRequestException` specifically so this route can surface it.
 * Never read for 5xx: those bodies are not written with a learner audience in
 * mind and may contain internal detail.
 */
function getSafeErrorMessage(err: unknown): string | undefined {
  const status = getErrorStatus(err);
  if (status === undefined || status >= 500) {
    return undefined;
  }
  const message = (err as { body?: { message?: string } } | undefined)?.body
    ?.message;
  return typeof message === "string" && message.length > 0
    ? message
    : undefined;
}

/**
 * Submits an answer for a given assignment, attempt, and question.
 *
 * Returns a discriminated result instead of throwing or returning `undefined`
 * on failure: `ok: false` always carries whatever the server told us — the
 * HTTP status, and (for 4xx responses only) a learner-safe `message` — so the
 * caller can tell a real failure from a real success instead of treating
 * every outcome as saved.
 */
export async function submitQuestion(
  assignmentId: number,
  attemptId: number,
  questionId: number,
  requestBody: QuestionAttemptRequest,
  cookies?: string,
): Promise<SubmitQuestionResult> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/questions/${questionId}/responses`;

  try {
    const processedBody = JSON.parse(
      JSON.stringify(requestBody, (key, value) => {
        if (value === "" || value === null || value === undefined) {
          return undefined;
        }
        return value;
      }),
    );

    const data = await apiClient.post<QuestionAttemptResponse>(
      endpointURL,
      processedBody,
      {
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
        // The caller (the auto-save hook) is the sole owner of user-facing
        // messaging for this endpoint — it needs to tell a real failure from
        // a real success and show its own honest toast. Suppress apiClient's
        // generic status-code toast so the learner doesn't see a vague
        // "Client Error: 400 Bad Request" moments before that honest toast.
        quiet: true,
      },
    );
    return { ok: true, data };
  } catch (err) {
    console.error("submitQuestion failed", {
      assignmentId,
      attemptId,
      questionId,
      status: getErrorStatus(err),
      // The underlying failure reason, not the request/response payload:
      // a generic Error.message (e.g. "Failed to fetch", "Internal Server
      // Error") is safe to log and is exactly what this catch block would
      // otherwise discard on translation to a SubmitQuestionResult.
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      status: getErrorStatus(err),
      message: getSafeErrorMessage(err),
    };
  }
}

/**
 * Get live recording feedback
 */
export async function getLiveRecordingFeedback(
  assignmentId: number,
  liveRecordingData: LiveRecordingData,
  cookies?: string,
): Promise<{ feedback: string }> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/questions/live-recording-feedback`;

  try {
    const data = await apiClient.post<{ feedback: string }>(
      endpointURL,
      { liveRecordingData },
      {
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );
    return data;
  } catch (err) {
    return { feedback: "" };
  }
}

export type QuestionGradingStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

export interface QuestionGradingState {
  id: number;
  displayOrder: number;
  status: QuestionGradingStatus;
  slowType?: string;
}

export interface GradingProgressDetails {
  questions: QuestionGradingState[];
  total: number;
  completed: number;
  inFlight: number;
  failed: number;
  hasSlowInFlight: boolean;
}

// On Processing/update SSE events the API nests the per-question grading
// snapshot under `result.gradingState` (and double-stringifies `result`).
// Returns the snapshot if present, else undefined.
function parseGradingState(
  result: unknown,
): GradingProgressDetails | undefined {
  let parsed: unknown = result;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    "gradingState" in parsed &&
    (parsed as { gradingState?: unknown }).gradingState
  ) {
    return (parsed as { gradingState: GradingProgressDetails }).gradingState;
  }
  return undefined;
}

/**
 * Submits an assignment with progress tracking
 */
export async function submitAssignment(
  assignmentId: number,
  attemptId: number,
  responsesForQuestions: QuestionAttemptRequestWithId[],
  language?: string,
  authorQuestions?: QuestionStore[],
  authorAssignmentDetails?: ReplaceAssignmentRequest,
  cookies?: string,
  onProgress?: (
    status: GradingProgressStatus,
    progress: number,
    message: string,
    metadata?: {
      currentQuestion?: number;
      totalQuestions?: number;
      gradingState?: GradingProgressDetails;
    },
  ) => void,
  onGradingJobCreated?: (gradingJobId: string) => void,
): Promise<SubmitAssignmentResponse | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}`;

  try {
    const requestData = {
      submitted: true,
      responsesForQuestions,
      language,
      authorQuestions: authorQuestions || undefined,
      authorAssignmentDetails: authorAssignmentDetails || undefined,
    };

    let responseData: SubmitAssignmentResponse;
    try {
      responseData = await apiClient.patch<SubmitAssignmentResponse>(
        endpointURL,
        requestData,
        {
          headers: {
            "Content-Type": "application/json",
            ...(cookies ? { Cookie: cookies } : {}),
          },
        },
      );
    } catch (apiError) {
      let errorMessage = "Submission failed";

      // Check the kill-switch first and duck-typed (not gated on
      // `instanceof APIError`, which is unreliable across Next's module
      // boundary) so the out-of-service message always wins for a 409.
      if (isAiTemporarilyDisabled(apiError)) {
        // AI grading kill-switch engaged: the attempt was not submitted and
        // no grading was performed, so the learner's progress is preserved.
        errorMessage =
          "Grading is temporarily out of service. Your answers have not been submitted — please try again later.";
      } else if (apiError instanceof APIError) {
        errorMessage = `Submission failed with status: ${apiError.status}`;

        if (
          apiError.message.includes("maximum context length") ||
          apiError.message.includes("tokens")
        ) {
          errorMessage =
            "Your submission is too long. Please reduce the length of your responses and try again.";
        } else if (apiError.message) {
          errorMessage = apiError.message;
        }
      }

      toast.error(errorMessage);
      throw new Error(errorMessage);
    }

    const { gradingJobId, message } = responseData;

    if (!gradingJobId) {
      // Deterministic-only attempts grade synchronously: the API returns the
      // graded attempt itself (it carries the attempt id) instead of a job to
      // stream. Resolve with it directly — callers already consume this exact
      // shape from the SSE finalize path. `grade` may be null when scores are
      // hidden, so the attempt id is the discriminator, not the grade.
      if (typeof responseData.id === "number") {
        onProgress?.("completed", 100, message ?? "Grading complete");
        return responseData;
      }
      throw new Error("No grading job ID returned");
    }

    onGradingJobCreated?.(gradingJobId);

    const sseUrl = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/grading/${gradingJobId}/status-stream`;

    return new Promise((resolve, reject) => {
      let retryCount = 0;
      let settled = false;
      let activeSource: EventSource | undefined;
      const allErrors: Array<{
        attempt: number;
        error: string;
        timestamp: string;
        readyState?: number;
        url?: string;
      }> = [];

      // The stall warning is non-destructive by design: the stream is still
      // alive, so the learner should keep seeing whatever real progress they
      // last had, not have it wiped back to zero just because the clock that
      // reports it fired. Remember the last substantive update so the
      // warning can carry it forward instead of 0/undefined.
      let lastKnownProgress = 0;
      let lastKnownMetadata:
        | {
            currentQuestion?: number;
            totalQuestions?: number;
            gradingState?: GradingProgressDetails;
          }
        | undefined;

      const watchdog = new GradingWatchdog({
        onIdleTimeout: () => handleIdleTimeout(),
        onStallWarning: () => {
          // Non-destructive: the stream is alive, so keep it open and keep
          // grading. The learner just stops being lied to by a spinner —
          // and keeps seeing the progress they already had, not a reset.
          onProgress?.(
            "stalled",
            lastKnownProgress,
            "This is taking longer than usual. Your answers are submitted and grading is still running.",
            lastKnownMetadata,
          );
        },
        onStallTimeout: () => {
          void handleStreamLost("stalled");
        },
      });

      const settle = (): boolean => {
        if (settled) return false;
        settled = true;
        watchdog.stop();
        activeSource?.close();
        return true;
      };

      const handleIdleTimeout = () => {
        if (settled) return;
        const currentAttempt = retryCount;
        allErrors.push({
          attempt: currentAttempt,
          error: "Grading stream went silent",
          timestamp: new Date().toISOString(),
          readyState: activeSource?.readyState,
          url: sseUrl,
        });

        watchdog.clearStreamActivity();
        activeSource?.close();

        if (currentAttempt < SSE_MAX_CONNECTION_ATTEMPTS) {
          onProgress?.(
            "processing",
            0,
            `Reconnecting to the grading service... (${currentAttempt}/${SSE_MAX_CONNECTION_ATTEMPTS})`,
          );
          setTimeout(
            () => attemptConnection(),
            SSE_RECONNECT_BACKOFF_STEP_MS * currentAttempt,
          );
        } else {
          void handleStreamLost("disconnected");
        }
      };

      const attemptConnection = () => {
        if (settled) return;
        retryCount++;
        const currentAttempt = retryCount;

        const eventSource = new EventSource(sseUrl, {
          withCredentials: true,
        });
        activeSource = eventSource;
        watchdog.noteStreamActivity();

        eventSource.onopen = () => {
          if (settled) return;
          watchdog.noteStreamActivity();
          onProgress?.(
            "processing",
            0,
            `Connected to grading service... (attempt ${currentAttempt})`,
          );
        };

        eventSource.onmessage = (event) => {
          if (settled) return;
          watchdog.noteStreamActivity();

          try {
            let data;
            try {
              data = JSON.parse(event.data);
            } catch (parseError) {
              data = event.data;
            }

            if (data.heartbeat) {
              return;
            }

            watchdog.noteGradingUpdate();

            if (data.message && data.connectionId) {
              onProgress?.("processing", 0, data.message);
              return;
            }

            if (data.status === "Processing" || data.status === "Pending") {
              const percentage = data.percentage || 0;
              const progress = data.progress || "Processing...";
              const metadata = {
                currentQuestion: data.currentQuestion,
                totalQuestions: data.totalQuestions,
                gradingState: parseGradingState(data.result),
              };
              lastKnownProgress = percentage;
              lastKnownMetadata = metadata;
              onProgress?.("processing", percentage, progress, metadata);
            } else if (data.status === "Completed") {
              if (!settle()) return;
              onProgress?.("completed", 100, "Grading completed successfully!");

              let result = data.result;
              if (typeof result === "string") {
                try {
                  result = JSON.parse(result);
                } catch (e) {
                  console.warn(
                    "SSE Completed: failed to JSON.parse result, returning raw string:",
                    e,
                  );
                }
              }
              resolve(result);
            } else if (data.status === "Failed") {
              if (!settle()) return;
              const failureMessage = data.progress || "Grading failed";
              onProgress?.("failed", 0, failureMessage);

              setTimeout(() => {
                toast.error(failureMessage);
                reject(new Error(failureMessage));
              }, 2000);
            }
          } catch (error) {
            console.error("SSE onmessage handler error:", error);
          }
        };

        eventSource.addEventListener("update", (event: any) => {
          if (settled) return;
          watchdog.noteStreamActivity();
          try {
            const data = JSON.parse(event.data);

            if (data.heartbeat) {
              return;
            }

            watchdog.noteGradingUpdate();

            if (data.progress && data.percentage !== undefined) {
              const metadata = {
                currentQuestion: data.currentQuestion,
                totalQuestions: data.totalQuestions,
                gradingState: parseGradingState(data.result),
              };
              lastKnownProgress = data.percentage;
              lastKnownMetadata = metadata;
              onProgress?.(
                "processing",
                data.percentage,
                data.progress,
                metadata,
              );
            }
          } catch (error) {
            console.warn("SSE update event parse failed:", error);
          }
        });

        eventSource.addEventListener("heartbeat", (event: any) => {
          if (settled) return;
          // Heartbeats prove the pipe is alive and nothing more, so they
          // deliberately touch only the connection clock.
          watchdog.noteStreamActivity();
          try {
            JSON.parse(event.data);
          } catch (error) {
            console.warn("SSE heartbeat parse failed:", error);
          }
        });

        eventSource.addEventListener("finalize", (event: any) => {
          if (settled) return;
          try {
            const data = JSON.parse(event.data);
            if (!settle()) return;
            onProgress?.("completed", 100, "Grading completed successfully!");

            let result = data.result;
            if (typeof result === "string") {
              try {
                result = JSON.parse(result);
              } catch (e) {
                console.warn(
                  "SSE finalize: failed to JSON.parse result, returning raw string:",
                  e,
                );
              }
            }
            resolve(result);
          } catch (error) {
            if (!settle()) return;
            reject(error);
          }
        });

        const handleConnectionError = () => {
          if (settled) return;
          allErrors.push({
            attempt: currentAttempt,
            error:
              eventSource.readyState === EventSource.CLOSED
                ? "Connection to grading service lost"
                : "Grading stream error",
            timestamp: new Date().toISOString(),
            readyState: eventSource.readyState,
            url: sseUrl,
          });

          watchdog.clearStreamActivity();
          eventSource.close();

          if (currentAttempt < SSE_MAX_CONNECTION_ATTEMPTS) {
            const retryDelay = SSE_RECONNECT_BACKOFF_STEP_MS * currentAttempt;
            onProgress?.(
              "processing",
              0,
              `Connection lost. Retrying in ${retryDelay / 1000} seconds...`,
            );
            setTimeout(() => attemptConnection(), retryDelay);
          } else {
            void handleStreamLost("disconnected");
          }
        };

        eventSource.addEventListener("error", (event: any) => {
          if (settled) {
            eventSource.close();
            return;
          }

          if (event?.data) {
            watchdog.noteStreamActivity();
            try {
              const data = JSON.parse(event.data);

              if (data?.status === "Failed") {
                if (!settle()) return;
                const errorMessage =
                  data.progress || data.error || "Grading failed";
                onProgress?.("failed", 0, errorMessage);

                setTimeout(() => {
                  toast.error(errorMessage);
                  reject(new Error(errorMessage));
                }, 2000);
              } else if (data?.error) {
                watchdog.noteGradingUpdate();
                const streamErrorMessage =
                  data.error || "Grading stream reported an error";
                onProgress?.("processing", 0, streamErrorMessage);
              }
            } catch (error) {
              console.warn("SSE error-event parse failed:", error);
            }
            return;
          }

          handleConnectionError();
        });
      };

      /**
       * Terminal, but not a claim that grading failed: the job may still be
       * running. Tell the caller what happened and let the UI offer a
       * re-check rather than declaring a lost submission — and do it before
       * filing the diagnostic report, not after. The report is a network
       * call (with its own author-report fallback network call behind it),
       * and on a genuinely dead connection either can hang indefinitely; the
       * whole point of this watchdog is a bounded time-to-honest-state, so
       * the learner cannot be left waiting on a report that may never land.
       * The report is best-effort from here on — its failure already falls
       * back silently (see the catch below) and is not something the caller
       * awaits.
       */
      const handleStreamLost = async (
        reason: "disconnected" | "stalled",
      ): Promise<void> => {
        if (!settle()) return;

        const learnerMessage =
          reason === "stalled"
            ? "Grading stopped responding. Your answers were submitted — check your results in a moment."
            : "We lost contact with the grading service. Your answers were submitted — check your results in a moment.";

        onProgress?.("disconnected", 0, learnerMessage);
        reject(
          new GradingStreamLostError(
            learnerMessage,
            assignmentId,
            attemptId,
            reason,
          ),
        );

        const detailedErrorReport = {
          assignmentId,
          attemptId,
          gradingJobId,
          sseUrl,
          reason,
          totalAttempts: retryCount,
          allErrors,
          finalFailureTime: new Date().toISOString(),
          userAgent:
            typeof navigator === "undefined" ? undefined : navigator.userAgent,
          url: typeof window === "undefined" ? undefined : window.location.href,
        };

        const summary =
          reason === "stalled"
            ? "Grading stream stalled with no progress"
            : "Grading stream lost after all reconnect attempts";

        try {
          await submitReportLearner(
            assignmentId,
            attemptId,
            "TECHNICAL_ISSUE" as REPORT_TYPE,
            `${summary}\n\nDetailed Error Report:\n${JSON.stringify(detailedErrorReport, null, 2)}`,
            cookies,
          );
        } catch (reportError) {
          try {
            await submitReportAuthor(
              assignmentId,
              "TECHNICAL_ISSUE" as REPORT_TYPE,
              `${summary} — learner report fallback\n\nAttempt ID: ${attemptId}\nError Details:\n${JSON.stringify(detailedErrorReport, null, 2)}`,
              cookies,
            );
          } catch (fallbackError) {
            console.error("Author fallback report also failed:", fallbackError);
          }
        }
      };

      watchdog.startGradingClock();
      attemptConnection();
    });
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }

    throw new Error("An unexpected error occurred during submission");
  }
}
/**
 * Get feedback for an assignment attempt
 */
export async function getFeedback(
  assignmentId: number,
  attemptId: number,
  cookies?: string,
): Promise<AssignmentFeedback | undefined> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/feedback`;

  try {
    const data = await apiClient.get<AssignmentFeedback>(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });
    return data;
  } catch (err) {
    return undefined;
  }
}

/**
 * Submit feedback for an assignment attempt
 */
export async function submitFeedback(
  assignmentId: number,
  attemptId: number,
  feedback: AssignmentFeedback,
  cookies?: string,
): Promise<boolean> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/feedback`;

  try {
    await apiClient.post(
      endpointURL,
      { feedback },
      {
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );

    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Submit a regrading request
 */
export async function submitRegradingRequest(
  regradingRequest: RegradingRequest,
  cookies?: string,
): Promise<boolean> {
  const endpointURL = `${getApiRoutes().assignments}/${regradingRequest.assignmentId}/attempts/${regradingRequest.attemptId}/regrade`;
  try {
    await apiClient.post(
      endpointURL,
      { regradingRequest },
      {
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );

    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Submit a report from a learner
 */
export async function submitReportLearner(
  assignmentId: number,
  attemptId: number,
  issueType: REPORT_TYPE,
  description: string,
  cookies?: string,
): Promise<{ success: boolean } | undefined> {
  try {
    const response = await apiClient.post<{ success: boolean }>(
      `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/report`,
      {
        issueType,
        description,
      },
      {
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );

    return response;
  } catch (error: unknown) {
    if (error instanceof APIError) {
      if (error.status === 422) {
        toast.error(
          "You have reached the maximum number of reports allowed in a 24-hour period.",
        );
      } else {
        toast.error("Failed to submit report");
      }
    } else if (error instanceof Error) {
      toast.error(error.message);
    } else {
      toast.error("Failed to submit report");
    }
  }
}

export interface VersionSummary {
  id: number;
  versionNumber: string;
  versionDescription?: string;
  isDraft: boolean;
  isActive: boolean;
  published: boolean;
  createdBy: string;
  createdAt: string;
  questionCount: number;
}

/**
 * Gets the current active version of an assignment (for learners)
 * @param assignmentId The assignment ID
 * @param cookies Optional cookies for authentication
 * @returns Assignment version data or undefined on error
 */
export async function getCurrentAssignmentVersion(
  assignmentId: number,
  cookies?: string,
): Promise<any | undefined> {
  try {
    const endpointURL = `${getApiRoutes().assignments}/${assignmentId}`;

    const assignment = await apiClient.get(endpointURL, {
      headers: {
        ...(cookies ? { Cookie: cookies } : {}),
      },
    });

    return assignment;
  } catch (err) {
    return undefined;
  }
}

/**
 * Gets version information for an assignment (learner view)
 * This only returns published, non-draft versions that learners can see
 * @param assignmentId The assignment ID
 * @param cookies Optional cookies for authentication
 * @returns Limited version info or undefined on error
 */
export async function getAssignmentVersionInfo(
  assignmentId: number,
  cookies?: string,
): Promise<
  { currentVersion?: VersionSummary; totalVersions: number } | undefined
> {
  try {
    const assignment = await getCurrentAssignmentVersion(assignmentId, cookies);

    if (assignment) {
      return {
        currentVersion: assignment.currentVersion,
        totalVersions: assignment.totalVersions || 1,
      };
    }

    return undefined;
  } catch (err) {
    return undefined;
  }
}

/**
 * Get real-time grading progress for an assignment attempt
 */
export interface GradingProgress {
  id: number;
  attemptId: number;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  currentQuestion: number | null;
  totalQuestions: number;
  currentStage: string | null;
  progress: number;
  error: string | null;
  notifyOnComplete: boolean;
  notificationEmail: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getGradingProgress(
  assignmentId: number,
  attemptId: number,
): Promise<GradingProgress | null> {
  try {
    const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/progress`;
    const response = await apiClient.get<GradingProgress>(endpointURL);
    return response;
  } catch (err) {
    return null;
  }
}

/**
 * Subscribe to email notification when grading is complete
 */
export async function subscribeToGradingNotification(
  assignmentId: number,
  attemptId: number,
  email?: string,
): Promise<{ success: boolean; message: string } | null> {
  try {
    const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/notify`;
    const response = await apiClient.post<{
      success: boolean;
      message: string;
    }>(endpointURL, { email });
    return response;
  } catch (err) {
    throw err;
  }
}
