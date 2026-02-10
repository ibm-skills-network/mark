import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { submitQuestion } from "@/lib/talkToBackend";
import type { QuestionAttemptRequest } from "@/config/types";
import { useLearnerStore } from "@/stores/learner";

interface AutoSaveConfig {
  enabled?: boolean;
  debounceMs?: number;
  showToast?: boolean;
}

/**
 * Hook to automatically save question responses to the backend.
 * This ensures that if the timer expires, the learner's work is preserved
 * and can be graded based on their last saved responses.
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

      const performSave = async () => {
        if (isSavingRef.current) return;

        isSavingRef.current = true;
        try {
          await submitQuestion(
            assignmentId,
            attemptId,
            questionId,
            responsePayload,
          );

          lastSavedDataRef.current = currentData;

          if (showToast) {
            toast.success("Response saved", {
              duration: 2000,
            });
          }
        } catch (error) {
          console.error("Auto-save failed:", error);
        } finally {
          isSavingRef.current = false;
        }
      };

      if (immediate) {
        await performSave();
      } else {
        saveTimeoutRef.current = setTimeout(performSave, debounceMs);
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
    };
  }, []);

  return {
    saveNow: () => saveResponse(true),
    isSaving: isSavingRef.current,
  };
}
