import { extractAssignmentId } from "@/lib/strings";
import type { GradingData, QuestionDisplayType } from "@/config/types";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { createWithEqualityFn } from "zustand/traditional";
import { withUpdatedAt } from "./middlewares";

type GradingDataActions = {
  questionDisplay: QuestionDisplayType;
  setQuestionDisplay: (questionDisplay: QuestionDisplayType) => void;
  setGraded: (graded: boolean) => void;
  setNumAttempts: (numAttempts: number) => void;
  setPassingGrade: (passingGrade: number) => void;
  setTimeEstimateMinutes: (timeEstimateMinutes: number) => void;
  setAllotedTimeMinutes: (allotedTimeMinutes: number) => void;
  setDisplayOrder: (displayOrder: "DEFINED" | "RANDOM") => void;
  toggleStrictTimeLimit: () => void;
  setUpdatedAt: (updatedAt: number) => void;
  setAssignmentConfigStore: (state: Partial<GradingData>) => void;
  setStrictTimeLimit: (strictTimeLimit: boolean) => void;
  validate: () => boolean;
  errors: Record<string, string>;
};

export const useAssignmentConfig = createWithEqualityFn<
  GradingData & GradingDataActions
>()(
  persist(
    devtools(
      withUpdatedAt((set, get) => ({
        errors: {},
        numAttempts: -1,
        passingGrade: 50,
        displayOrder: "DEFINED",
        strictTimeLimit: false,
        updatedAt: undefined,
        graded: false,
        questionDisplay: "ONE_PER_PAGE" as QuestionDisplayType,
        setQuestionDisplay: (questionDisplay: QuestionDisplayType) => {
          set({ questionDisplay });
        },
        setGraded: (graded) => set({ graded }),
        setNumAttempts: (numAttempts) =>
          set({
            numAttempts: numAttempts === undefined ? -1 : numAttempts,
          }),
        setPassingGrade: (passingGrade) => set({ passingGrade }),
        timeEstimateMinutes: undefined,
        setTimeEstimateMinutes: (timeEstimateMinutes) =>
          set({ timeEstimateMinutes }),
        allotedTimeMinutes: undefined,
        setAllotedTimeMinutes: (allotedTimeMinutes) =>
          set({ allotedTimeMinutes }),
        setDisplayOrder: (displayOrder) => set({ displayOrder }),
        setStrictTimeLimit: (strictTimeLimit) => set({ strictTimeLimit }),
        toggleStrictTimeLimit: () =>
          set((state) => ({
            strictTimeLimit: !state.strictTimeLimit,
            allotedTimeMinutes:
              state.strictTimeLimit === false
                ? undefined
                : state.allotedTimeMinutes,
          })),

        setUpdatedAt: (updatedAt) => set({ updatedAt }),
        validate: () => {
          const state = get();
          const errors: Record<string, string> = {};
          if (state.graded === null) {
            errors.graded = "Assignment type is required.";
          }
          if (!state.numAttempts || state.numAttempts < -1) {
            errors.numAttempts = "Please enter a valid number of attempts.";
          }
          if (
            state.passingGrade === undefined ||
            state.passingGrade <= 0 ||
            state.passingGrade > 100
          ) {
            errors.passingGrade = "Passing grade must be between 1 and 100.";
          }
          if (!state.displayOrder) {
            errors.displayOrder = "Question order is required.";
          }
          if (!state.questionDisplay) {
            errors.questionDisplay = "Question display type is required.";
          }
          set({ errors });
          return Object.keys(errors).length === 0;
        },
        setAssignmentConfigStore: (state) =>
          set((prevState) => ({ ...prevState, ...state })),
      })),
    ),
    {
      name: getAssignmentConfigName(),
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
function getAssignmentConfigName() {
  if (typeof window !== "undefined") {
    return `assignment-${extractAssignmentId(window.location.pathname)}-config`;
  }
  return "assignment-config";
}
