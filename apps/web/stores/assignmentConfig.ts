import { GradingData, QuestionDisplayType } from "@/config/types";
import { extractAssignmentId } from "@/lib/strings";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { createWithEqualityFn } from "zustand/traditional";
import { withUpdatedAt } from "./middlewares";

type GradingDataActions = {
  questionDisplay: QuestionDisplayType;
  setQuestionDisplay: (questionDisplay: QuestionDisplayType) => void;
  questionVariationNumber: number;
  setQuestionVariationNumber: (questionVariationNumber: number) => void;
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
  deleteStore: () => void;
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
        displayOrder: "DEFINED" as const,
        strictTimeLimit: false,
        updatedAt: undefined,
        graded: false,
        questionVariationNumber: 0,
        setQuestionVariationNumber: (questionVariationNumber) =>
          set({ questionVariationNumber }),
        questionDisplay: QuestionDisplayType.ONE_PER_PAGE,
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
          set({
            allotedTimeMinutes:
              allotedTimeMinutes === 0 ? 1 : allotedTimeMinutes,
            timeEstimateMinutes: allotedTimeMinutes,
          }),
        setDisplayOrder: (displayOrder) => set({ displayOrder }),
        setStrictTimeLimit: (strictTimeLimit) => {
          set({ strictTimeLimit });
          if (!strictTimeLimit) {
            set({ allotedTimeMinutes: 0 });
          }
        },
        toggleStrictTimeLimit: () => {
          set((state) => {
            const newStrictTimeLimit = !state.strictTimeLimit; // toggle strictTime limit, if newStrictTimeLimit is true, it means the time limit is strict
            return {
              ...state,
              strictTimeLimit: newStrictTimeLimit,
              allotedTimeMinutes: newStrictTimeLimit ? 1 : null,
              timeEstimateMinutes: newStrictTimeLimit ? 1 : null,
            };
          });
        },
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
        deleteStore: () =>
          set(() => ({
            errors: {},
            numAttempts: -1,
            passingGrade: 50,
            displayOrder: "DEFINED",
            strictTimeLimit: false,
            updatedAt: undefined,
            graded: false,
            questionVariationNumber: 0,
            questionDisplay: QuestionDisplayType.ONE_PER_PAGE,
            timeEstimateMinutes: undefined,
            allotedTimeMinutes: undefined,
          })),

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
