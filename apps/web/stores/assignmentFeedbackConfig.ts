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
  setUpdatedAt: (updatedAt: number) => void;
  setAssignmentFeedbackConfigStore: (state: Partial<FeedbackData>) => void;
};

export const useAssignmentFeedbackConfig = createWithEqualityFn<
  FeedbackData & FeedbackDataActions
>()(
  persist(
    devtools(
      withUpdatedAt((set, get) => ({
        verbosityLevel: "Full", // Default initial value
        showSubmissionFeedback: true, // Default initial value
        showQuestionScore: true, // Default initial value
        showAssignmentScore: true, // Default initial value
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
