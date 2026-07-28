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

/**
 * Hook to automatically save question responses to the backend.
 * This ensures that if the timer expires, the learner's work is preserved
 * and can be graded based on their last saved responses.
 *
 * A save is only ever considered successful — and only ever marks the
 * in-memory data as saved / shows a success toast — when the server actually
 * confirms it. A failed save keeps the data dirty, retries transient
 * failures with backoff, and eventually shows an honest failure toast
 * instead of silently giving up.
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

  const question = useLearnerStore((state) =>
    state.questions.find((q) => q.id === questionId),
  );
  const userPreferedLanguage = useLearnerStore(
    (state) => state.userPreferedLanguage,
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

      const performSave = async (attempt = 0) => {
        // A fresh save attempt (a new edit's debounce firing, or an
        // immediate saveNow()) always supersedes a stale retry that was
        // scheduled for an older payload — cancel it rather than let both
        // fire.
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = undefined;
        }

        if (isSavingRef.current) return;

        isSavingRef.current = true;
        let result: SubmitQuestionResult;
        try {
          result = await submitQuestion(
            assignmentId,
            attemptId,
            questionId,
            responsePayload,
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

        // Compared against the literal `true` (not a truthy check) because
        // this project builds with strictNullChecks disabled, under which
        // TypeScript does not reliably narrow a discriminated union from a
        // plain `if (result.ok)` — the explicit literal comparison is what
        // actually narrows `result` to the `ok: false` branch below.
        if (result.ok === true) {
          lastSavedDataRef.current = currentData;
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
          assignmentId,
          attemptId,
          questionId,
          status: result.status,
          attempt,
        });

        const isTerminal =
          result.status !== undefined &&
          AUTOSAVE_TERMINAL_STATUSES.has(result.status);

        if (!isTerminal && attempt < RETRY_DELAYS_MS.length) {
          retryTimeoutRef.current = setTimeout(
            () => void performSave(attempt + 1),
            RETRY_DELAYS_MS[attempt],
          );
          return;
        }

        // Either a terminal failure (retrying the same payload would just
        // fail the same way) or every retry is exhausted: this is the point
        // where silence would look exactly like a false "Response saved" to
        // the learner, so a real, specific failure toast always fires here.
        toast.error(result.message ?? AUTOSAVE_GIVE_UP_MESSAGE, {
          duration: 8000,
        });
      };

      if (immediate) {
        await performSave();
      } else {
        saveTimeoutRef.current = setTimeout(() => void performSave(), debounceMs);
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
      showToast,
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
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  return {
    saveNow: () => saveResponse(true),
    isSaving: isSavingRef.current,
  };
}
