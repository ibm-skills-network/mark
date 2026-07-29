import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { submitQuestion, type SubmitQuestionResult } from "@/lib/talkToBackend";
import type { QuestionAttemptRequest } from "@/config/types";
import { useLearnerStore } from "@/stores/learner";

interface AutoSaveConfig {
  enabled?: boolean;
  debounceMs?: number;
  showToast?: boolean;
}

// Backoff schedule for a failed save: 2s, then 5s, then 10s (3 retries, 4
// attempts total) before giving up and telling the learner to act.
const RETRY_DELAYS_MS = [2000, 5000, 10_000];

// Statuses where resubmitting the exact same payload will fail identically —
// retrying just delays telling the learner something needs to change on
// their end (shorten the answer, log back in). Everything else (no status at
// all, i.e. a network failure; 408/429/5xx) is treated as transient and
// retried on the schedule above.
const AUTOSAVE_TERMINAL_STATUSES = new Set([400, 401, 403, 404, 413, 422]);

const AUTOSAVE_GIVE_UP_MESSAGE =
  "We couldn't save your last response after several tries. Copy it somewhere safe, then reload the page and try again.";

// A save request that arrived while a previous attempt (or its retry chain)
// was still running, captured with everything a standalone save needs so it
// can be replayed with no dependency on the call that originally queued it.
interface QueuedSave {
  assignmentId: number;
  attemptId: number;
  questionId: number;
  payload: QuestionAttemptRequest;
  serializedData: string;
}

/**
 * Hook to automatically save question responses to the backend.
 * This ensures that if the timer expires, the learner's work is preserved
 * and can be graded based on their last saved responses.
 *
 * A save is only ever considered successful — and only ever marks the
 * in-memory data as saved / shows a success toast — when the server actually
 * confirms it. A failed save keeps the data dirty, retries transient
 * failures with backoff, and eventually shows an honest failure toast
 * instead of silently giving up. A save that arrives while a previous
 * attempt is still in flight is queued and replayed the instant that
 * attempt settles, so the latest edit is never silently dropped in favor of
 * a stale one.
 *
 * @param assignmentId - The ID of the assignment
 * @param attemptId - The ID of the current attempt
 * @param questionId - The ID of the question to auto-save
 * @param config - Configuration options for auto-save behavior
 * @returns Object with saveNow function for manual saves
 */
export function useAutoSaveResponse(
  assignmentId: number | null,
  attemptId: number | null,
  questionId: number,
  config: AutoSaveConfig = {},
) {
  const { enabled = true, debounceMs = 3000, showToast = false } = config;

  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const retryTimeoutRef = useRef<NodeJS.Timeout>();
  const isSavingRef = useRef(false);
  const lastSavedDataRef = useRef<string>("");
  // Set the moment a fresh save arrives while a previous attempt is still
  // in flight (awaiting the network, not merely a scheduled retry timer).
  // The in-flight attempt's completion handler checks this and — if set —
  // runs the queued save immediately instead of trusting its own (by then
  // stale) result, so a fresher edit is never silently dropped.
  const queuedSaveRef = useRef<QueuedSave | null>(null);
  // Flipped once in the unmount cleanup effect. An in-flight submitQuestion
  // call has no way to be cancelled, so its resolution is checked against
  // this ref before it's allowed to touch any ref, schedule a retry, run a
  // queued save, or show a toast — a resolution arriving after unmount must
  // be completely inert.
  const isUnmountedRef = useRef(false);

  const question = useLearnerStore((state) =>
    state.questions.find((q) => q.id === questionId),
  );
  const userPreferedLanguage = useLearnerStore(
    (state) => state.userPreferedLanguage,
  );

  const performSave = useCallback(
    async (
      currentAssignmentId: number,
      currentAttemptId: number,
      currentQuestionId: number,
      payload: QuestionAttemptRequest,
      serializedData: string,
      attempt = 0,
    ) => {
      // A fresh save attempt (a new edit's debounce firing, or an immediate
      // saveNow()) always supersedes a stale retry that was scheduled for an
      // older payload — cancel it rather than let both fire.
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = undefined;
      }

      if (isSavingRef.current) {
        // A different (now-stale) attempt is currently awaiting the network
        // — queue this newer request rather than dropping it. Whichever
        // outcome the in-flight attempt reaches, its completion handler
        // below will see this queued save and run it immediately instead.
        queuedSaveRef.current = {
          assignmentId: currentAssignmentId,
          attemptId: currentAttemptId,
          questionId: currentQuestionId,
          payload,
          serializedData,
        };
        return;
      }

      isSavingRef.current = true;
      let result: SubmitQuestionResult;
      try {
        result = await submitQuestion(
          currentAssignmentId,
          currentAttemptId,
          currentQuestionId,
          payload,
        );
      } catch (error) {
        // submitQuestion is contracted to resolve, never reject. This is a
        // defensive net against a genuinely unexpected throw so it still
        // drives the same honest failure/retry path below instead of an
        // unhandled rejection.
        console.error("Auto-save threw unexpectedly:", error);
        result = { ok: false };
      } finally {
        isSavingRef.current = false;
      }

      if (isUnmountedRef.current) {
        // The component is gone. Do not touch lastSavedDataRef, do not
        // schedule a retry, do not run a queued save, do not show a toast —
        // this resolution has nothing left to affect.
        return;
      }

      // A fresher edit arrived while this attempt was in flight. It always
      // wins: run it now, with its own fresh attempt count, and let it
      // decide this data's fate instead of trusting this now-stale result.
      const queued = queuedSaveRef.current;
      if (queued) {
        queuedSaveRef.current = null;
        await performSave(
          queued.assignmentId,
          queued.attemptId,
          queued.questionId,
          queued.payload,
          queued.serializedData,
          0,
        );
        return;
      }

      // Compared against the literal `true` (not a truthy check) because
      // this project builds with strictNullChecks disabled, under which
      // TypeScript does not reliably narrow a discriminated union from a
      // plain `if (result.ok)` — the explicit literal comparison is what
      // actually narrows `result` to the `ok: false` branch below.
      if (result.ok === true) {
        lastSavedDataRef.current = serializedData;
        if (showToast) {
          toast.success("Response saved", {
            duration: 2000,
          });
        }
        return;
      }

      // Failure path: lastSavedDataRef is deliberately left untouched so
      // this payload stays "dirty" — a later identical edit still gets a
      // fresh save attempt instead of being silently treated as saved.
      console.error("Auto-save failed:", {
        assignmentId: currentAssignmentId,
        attemptId: currentAttemptId,
        questionId: currentQuestionId,
        status: result.status,
        attempt,
      });

      const isTerminal =
        result.status !== undefined &&
        AUTOSAVE_TERMINAL_STATUSES.has(result.status);

      if (!isTerminal && attempt < RETRY_DELAYS_MS.length) {
        retryTimeoutRef.current = setTimeout(() => {
          if (isUnmountedRef.current) return;
          void performSave(
            currentAssignmentId,
            currentAttemptId,
            currentQuestionId,
            payload,
            serializedData,
            attempt + 1,
          );
        }, RETRY_DELAYS_MS[attempt]);
        return;
      }

      // Either a terminal failure (retrying the same payload would just
      // fail the same way) or every retry is exhausted: this is the point
      // where silence would look exactly like a false "Response saved" to
      // the learner, so a real, specific failure toast always fires here.
      // A stable per-question id keeps a terminal failure from stacking a
      // fresh toast on every debounce cycle while the learner keeps typing
      // an answer that still won't save — sonner updates the existing
      // toast in place instead of piling up a new one.
      toast.error(result.message ?? AUTOSAVE_GIVE_UP_MESSAGE, {
        duration: 8000,
        id: `autosave-failure-${currentQuestionId}`,
      });
    },
    [showToast],
  );

  const saveResponse = useCallback(
    async (immediate = false) => {
      if (!enabled || !assignmentId || !attemptId || !question) {
        return;
      }

      const responsePayload: QuestionAttemptRequest = {
        learnerTextResponse: question.learnerTextResponse || "",
        learnerUrlResponse: question.learnerUrlResponse || "",
        learnerChoices: question.translations?.[userPreferedLanguage]
          ?.translatedChoices
          ? question.translations[userPreferedLanguage].translatedChoices
              ?.map((choice, index) =>
                question.learnerChoices?.find(
                  (c) => String(c) === String(index),
                )
                  ? choice.choice
                  : undefined,
              )
              .filter((choice) => choice !== undefined) || []
          : question.choices
              ?.map((choice, index) =>
                question.learnerChoices?.find(
                  (c) => String(c) === String(index),
                )
                  ? choice.choice
                  : undefined,
              )
              .filter((choice) => choice !== undefined) || [],
        learnerAnswerChoice: question.learnerAnswerChoice ?? null,
        learnerFileResponse: question.learnerFileResponse || [],
        learnerPresentationResponse: question.presentationResponse ?? null,
      };

      const currentData = JSON.stringify(responsePayload);
      if (currentData === lastSavedDataRef.current && !immediate) {
        return;
      }

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      const runSave = () =>
        performSave(
          assignmentId,
          attemptId,
          questionId,
          responsePayload,
          currentData,
        );

      if (immediate) {
        await runSave();
      } else {
        saveTimeoutRef.current = setTimeout(() => {
          if (isUnmountedRef.current) return;
          void runSave();
        }, debounceMs);
      }
    },
    [
      enabled,
      assignmentId,
      attemptId,
      questionId,
      question,
      userPreferedLanguage,
      debounceMs,
      performSave,
    ],
  );

  useEffect(() => {
    if (!enabled || !question) return;

    void saveResponse();
  }, [
    question?.learnerTextResponse,
    question?.learnerUrlResponse,
    question?.learnerChoices,
    question?.learnerAnswerChoice,
    question?.learnerFileResponse,
    question?.presentationResponse,
    question?.selectedLanguage,
    saveResponse,
  ]);

  useEffect(() => {
    // React StrictMode (dev only) double-invokes this effect on mount —
    // setup, cleanup, setup again — reusing the same refs across both
    // invocations. Without resetting this here, the first (churned)
    // cleanup below would leave isUnmountedRef stuck true forever, making
    // every future save resolution silently no-op.
    isUnmountedRef.current = false;

    return () => {
      isUnmountedRef.current = true;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      queuedSaveRef.current = null;
    };
  }, []);

  return {
    /**
     * Triggers an immediate save, bypassing the debounce.
     *
     * The returned promise resolving does NOT mean the data was saved — it
     * always resolves to `undefined`, and can resolve well before the
     * server has confirmed anything: e.g. immediately, if this save gets
     * queued behind an already-in-flight attempt, or as soon as a
     * transient failure schedules a retry. Rely on the success/failure
     * toast (or `isSaving`) to know the actual outcome, not this promise.
     */
    saveNow: () => saveResponse(true),
    isSaving: isSavingRef.current,
  };
}
