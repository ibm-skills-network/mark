import type { FeedbackData, VerbosityLevels } from "../config/types";
import { withUpdatedAt } from "./middlewares";
import { extractAssignmentId } from "@/lib/strings";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { createWithEqualityFn } from "zustand/traditional";

type FeedbackDataActions = {
  setVerbosityLevel: (verbosityLevel: VerbosityLevels) => void;

  toggleShowSubmissionFeedback: () => void;
  toggleShowQuestionScore: () => void;
  toggleShowAssignmentScore: () => void;
  toggleShowQuestions: () => void;
  toggleShowCorrectAnswer: () => void;

  setShowSubmissionFeedback: (showSubmissionFeedback: boolean) => void;
  setShowQuestionScore: (showQuestionScore: boolean) => void;
  setShowQuestion: (showQuestions: boolean) => void;
  setShowAssignmentScore: (showAssignmentScore: boolean) => void;
  setShowCorrectAnswer: (showCorrectAnswer: boolean) => void;

  setUpdatedAt: (updatedAt: number) => void;
  setAssignmentFeedbackConfigStore: (state: Partial<FeedbackData>) => void;
  deleteStore: () => void;
};

export const useAssignmentFeedbackConfig = createWithEqualityFn<
  FeedbackData & FeedbackDataActions
>()(
  persist(
    devtools(
      withUpdatedAt((set, get) => ({
        verbosityLevel: "Full",
        showSubmissionFeedback: true,
        showQuestionScore: true,
        showAssignmentScore: true,
        showQuestions: true,
        showCorrectAnswer: true,
        setShowQuestion: (showQuestions: boolean) => set({ showQuestions }),
        toggleShowQuestions: () =>
          set((state) => ({ showQuestions: !state.showQuestions })),
        toggleShowCorrectAnswer: () =>
          set((state) => {
            const newValue = !state.showCorrectAnswer;
            // Clear localStorage when showCorrectAnswer changes
            if (typeof window !== "undefined") {
              localStorage.removeItem("questions");
              localStorage.removeItem("assignmentConfig");
            }
            return { showCorrectAnswer: newValue };
          }),
        setShowCorrectAnswer: (showCorrectAnswer: boolean) => {
          // Clear localStorage when showCorrectAnswer changes
          if (typeof window !== "undefined") {
            localStorage.removeItem("questions");
            localStorage.removeItem("assignmentConfig");
          }
          set({ showCorrectAnswer });
        },
        updatedAt: Date.now(),
        setVerbosityLevel: (verbosityLevel) => set({ verbosityLevel }),
        toggleShowSubmissionFeedback: () =>
          set((state) => ({
            showSubmissionFeedback: !state.showSubmissionFeedback,
          })),
        setShowSubmissionFeedback: (showSubmissionFeedback: boolean) =>
          set({ showSubmissionFeedback }),
        toggleShowQuestionScore: () =>
          set((state) => ({ showQuestionScore: !state.showQuestionScore })),
        setShowQuestionScore: (showQuestionScore: boolean) =>
          set({ showQuestionScore }),
        toggleShowAssignmentScore: () =>
          set((state) => ({ showAssignmentScore: !state.showAssignmentScore })),
        setShowAssignmentScore: (showAssignmentScore: boolean) =>
          set({ showAssignmentScore }),
        setUpdatedAt: (updatedAt) => set({ updatedAt }),
        setAssignmentFeedbackConfigStore: (state) =>
          set((prevState) => ({ ...prevState, ...state })),
        deleteStore: () =>
          set(() => ({
            verbosityLevel: "Full",
            showSubmissionFeedback: true,
            showQuestionScore: true,
            showAssignmentScore: true,
            showCorrectAnswer: true,
            updatedAt: Date.now(),
          })),
      })),
    ),
    {
      name: getAuthorStoreName(),
      storage: createJSONStorage(() => localStorage),
      partialize(state) {
        return Object.fromEntries(
          Object.entries(state).filter(
            ([_, value]) => typeof value !== "function",
          ),
        );
      },
    },
  ),
);
function getAuthorStoreName() {
  if (typeof window !== "undefined") {
    return `assignmentFeedbackConfig-${extractAssignmentId(window.location.pathname)}`;
  }
  return "assignmentFeedbackConfig-1";
}
