import { extractAssignmentId } from "@/lib/strings";
import type { FeedbackData, VerbosityLevels } from "../config/types";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { createWithEqualityFn } from "zustand/traditional";
import { withUpdatedAt } from "./middlewares";

type FeedbackDataActions = {
  setVerbosityLevel: (verbosityLevel: VerbosityLevels) => void;
  // toggleShowCorrectAnswer: () => void;
  toggleShowSubmissionFeedback: () => void;
  toggleShowQuestionScore: () => void;
  toggleShowAssignmentScore: () => void;
  // toggleShowStatus: () => void;
  // setShowCorrectAnswer: (showCorrectAnswer: boolean) => void;
  setShowSubmissionFeedback: (showSubmissionFeedback: boolean) => void;
  setShowQuestionScore: (showQuestionScore: boolean) => void;
  setShowAssignmentScore: (showAssignmentScore: boolean) => void;
  // setShowStatus: (showStatus: boolean) => void;
  updatedAt: number;
  setUpdatedAt: (updatedAt: number) => void;
};

export const useAssignmentFeedbackConfig = createWithEqualityFn<
  FeedbackData & FeedbackDataActions
>()(
  persist(
    devtools(
      withUpdatedAt((set, get) => ({
        verbosityLevel: "Custom",
        setVerbosityLevel: (verbosityLevel) => set({ verbosityLevel }),
        // showCorrectAnswer: false,
        // toggleShowCorrectAnswer: () =>
        // set((state) => ({ showCorrectAnswer: !state.showCorrectAnswer })),
        // setShowCorrectAnswer: (showCorrectAnswer: boolean) =>
        // 	set({ showCorrectAnswer }),
        showSubmissionFeedback: false,
        toggleShowSubmissionFeedback: () =>
          set((state) => ({
            showSubmissionFeedback: !state.showSubmissionFeedback,
          })),
        setShowSubmissionFeedback: (showSubmissionFeedback: boolean) =>
          set({ showSubmissionFeedback }),
        showQuestionScore: false,
        toggleShowQuestionScore: () =>
          set((state) => ({ showQuestionScore: !state.showQuestionScore })),
        setShowQuestionScore: (showQuestionScore: boolean) =>
          set({ showQuestionScore }),
        showAssignmentScore: false,
        toggleShowAssignmentScore: () =>
          set((state) => ({ showAssignmentScore: !state.showAssignmentScore })),
        setShowAssignmentScore: (showAssignmentScore: boolean) =>
          set({ showAssignmentScore }),
        // showStatus: false,
        // toggleShowStatus: () =>
        // 	set((state) => ({ showStatus: !state.showStatus })),
        // setShowStatus: (showStatus: boolean) => set({ showStatus }),
        updatedAt: Date.now(),
        setUpdatedAt: (updatedAt) => set({ updatedAt }),
      })),
    ),
    {
      name: getAssignmentFeedbackConfigName(),
      storage: createJSONStorage(() => localStorage),
      partialize(state) {
        // store everything that is not a function
        return Object.fromEntries(
          Object.entries(state).filter(
            ([_, value]) => typeof value !== "function",
          ),
        );
      },
    },
  ),
);
function getAssignmentFeedbackConfigName() {
  if (typeof window !== "undefined") {
    return `assignment-${extractAssignmentId(window.location.pathname)}-feedback-config`;
  }
  return "assignment-feedback-config";
}
