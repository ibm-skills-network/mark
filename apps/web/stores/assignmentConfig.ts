import { withUpdatedAt } from "./middlewares";
import {
  GradingData,
  QuestionDisplayType,
  QuestionControls,
} from "@/config/types";
import { createAssignmentScopedStorage } from "@/lib/assignment-storage";
import { extractAssignmentId } from "@/lib/strings";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { createWithEqualityFn } from "zustand/traditional";

type GradingDataActions = {
  questionDisplay: QuestionDisplayType;
  setQuestionDisplay: (questionDisplay: QuestionDisplayType) => void;
  questionVariationNumber: number;
  setNumberOfQuestionsPerAttempt?: (
    numberOfQuestionsPerAttempt: number | undefined,
  ) => void;
  setQuestionVariationNumber: (questionVariationNumber: number) => void;
  setGraded: (graded: boolean) => void;
  setNumAttempts: (numAttempts: number) => void;
  setAttemptsBeforeCoolDown: (attemptsBeforeCoolDown: number) => void;
  setRetakeAttemptCoolDownMinutes: (
    retakeAttemptCoolDownMinutes: number,
  ) => void;
  setPassingGrade: (passingGrade: number) => void;
  setTimeEstimateMinutes: (timeEstimateMinutes: number) => void;
  setAllotedTimeMinutes: (
    allotedTimeMinutes: number | null | undefined,
  ) => void;
  setDisplayOrder: (displayOrder: "DEFINED" | "RANDOM") => void;
  toggleStrictTimeLimit: () => void;
  toggleRequireAllQuestions: () => void;
  setRequireAllQuestions: (requireAllQuestions: boolean) => void;
  toggleOptionalQuestionId: (questionId: number) => void;
  setOptionalQuestionIds: (optionalQuestionIds: number[]) => void;
  setUpdatedAt: (updatedAt: number) => void;
  setAssignmentConfigStore: (state: Partial<GradingData>) => void;
  setStrictTimeLimit: (strictTimeLimit: boolean) => void;
  questionControls?: QuestionControls;
  setQuestionControls: (questionControls: QuestionControls) => void;
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
        attemptsBeforeCoolDown: 1,
        retakeAttemptCoolDownMinutes: 1,
        passingGrade: 50,
        displayOrder: "DEFINED",
        questionControls: {
          disableCopy: false,
          disablePaste: false,
          disableRightClick: false,
          disablePrint: false,
        },
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
        showQuestions: true,
        showSubmissionFeedback: true,
        showAssignmentScore: false,
        requireAllQuestions: false,
        optionalQuestionIds: [],
        numberOfQuestionsPerAttempt: null,
        setNumberOfQuestionsPerAttempt: (numberOfQuestionsPerAttempt) => {
          set({ numberOfQuestionsPerAttempt });
        },
        setShowSubmissionFeedback: (showSubmissionFeedback: boolean) =>
          set({ showSubmissionFeedback }),
        setShowQuestions: (showQuestions: boolean) => set({ showQuestions }),
        toggleRequireAllQuestions: () =>
          set((state) => ({
            requireAllQuestions: !state.requireAllQuestions,
          })),
        setRequireAllQuestions: (requireAllQuestions: boolean) =>
          set({ requireAllQuestions }),
        toggleOptionalQuestionId: (questionId: number) =>
          set((state) => {
            const optionalQuestionIds = state.optionalQuestionIds ?? [];
            const isOptional = optionalQuestionIds.includes(questionId);
            return {
              optionalQuestionIds: isOptional
                ? optionalQuestionIds.filter((id) => id !== questionId)
                : [...optionalQuestionIds, questionId],
            };
          }),
        setOptionalQuestionIds: (optionalQuestionIds: number[]) =>
          set({ optionalQuestionIds }),
        setQuestionControls: (questionControls: QuestionControls) =>
          set({ questionControls }),
        setGraded: (graded) => set({ graded }),
        setNumAttempts: (numAttempts) =>
          set({
            numAttempts: numAttempts === undefined ? -1 : numAttempts,
          }),
        setAttemptsBeforeCoolDown: (attemptsBeforeCoolDown) =>
          set({
            attemptsBeforeCoolDown:
              attemptsBeforeCoolDown === undefined
                ? -1
                : attemptsBeforeCoolDown,
          }),
        setRetakeAttemptCoolDownMinutes: (retakeAttemptCoolDownMinutes) =>
          set({
            retakeAttemptCoolDownMinutes:
              retakeAttemptCoolDownMinutes === undefined
                ? -1
                : retakeAttemptCoolDownMinutes,
          }),
        setPassingGrade: (passingGrade) => set({ passingGrade }),
        timeEstimateMinutes: undefined,
        setTimeEstimateMinutes: (timeEstimateMinutes) =>
          set({ timeEstimateMinutes }),
        allotedTimeMinutes: undefined,
        setAllotedTimeMinutes: (value) => {
          const state = get();
          const newErrors = { ...state.errors };

          if (value !== null && value !== undefined && value > 0) {
            delete newErrors.allotedTimeMinutes;
          }

          set({
            allotedTimeMinutes: value,
            timeEstimateMinutes: typeof value === "number" ? value : undefined,
            errors: newErrors,
          });
        },
        setDisplayOrder: (displayOrder) => set({ displayOrder }),
        setStrictTimeLimit: (strictTimeLimit) => {
          set({ strictTimeLimit });
          if (!strictTimeLimit) {
            set({ allotedTimeMinutes: null });
          }
        },
        toggleStrictTimeLimit: () => {
          set((state) => {
            const newStrictTimeLimit = !state.strictTimeLimit;
            return {
              ...state,
              strictTimeLimit: newStrictTimeLimit,
              allotedTimeMinutes: newStrictTimeLimit ? 20 : null,
              timeEstimateMinutes: newStrictTimeLimit ? 20 : null,
            };
          });
        },
        setUpdatedAt: (updatedAt) => set({ updatedAt }),
        validate: () => {
          const state = get();
          const errors: Record<string, string> = {};
          if (
            state.strictTimeLimit &&
            (!state.allotedTimeMinutes || state.allotedTimeMinutes <= 0)
          ) {
            errors.allotedTimeMinutes =
              "Please enter a time limit greater than 0 minutes.";
          }
          if (state.graded === null) {
            errors.graded = "Assignment type is required.";
          }
          if (!state.numAttempts || state.numAttempts < -1) {
            errors.numAttempts = "Please enter a valid number of attempts.";
          }
          if (!(state.attemptsBeforeCoolDown >= 0)) {
            errors.attemptsBeforeCoolDown =
              "Please enter a valid number of attempts before a cool down period is required.";
          }
          if (!(state.retakeAttemptCoolDownMinutes >= 0)) {
            errors.retakeAttemptCoolDownMinutes =
              "Please enter a valid number for the amount of time for a cooldown period in minutes";
          }
          if (
            state.passingGrade === undefined ||
            state.passingGrade <= 0 ||
            state.passingGrade > 100
          ) {
            errors.passingGrade = "Passing grade must be between 1 and 100.";
          }
          if (
            !state.displayOrder &&
            state.numberOfQuestionsPerAttempt === null
          ) {
            state.displayOrder = "DEFINED";
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
            attemptsBeforeCoolDown: 1,
            retakeAttemptCoolDownMinutes: 0,
            passingGrade: 50,
            displayOrder: "DEFINED",
            strictTimeLimit: false,
            updatedAt: undefined,
            graded: false,
            requireAllQuestions: false,
            optionalQuestionIds: [],
            questionVariationNumber: 0,
            questionDisplay: QuestionDisplayType.ONE_PER_PAGE,
            timeEstimateMinutes: undefined,
            allotedTimeMinutes: undefined,
            questionControls: {
              allowCopy: false,
              allowPaste: false,
              allowRightClick: false,
              preventPrint: false,
            },
          })),

        setAssignmentConfigStore: (state) =>
          set((prevState) => ({ ...prevState, ...state })),
      })),
    ),
    {
      name: getAssignmentConfigName(),
      storage: createJSONStorage(() =>
        createAssignmentScopedStorage("config", getAssignmentConfigName()),
      ),
      partialize(state) {
        return Object.fromEntries(
          Object.entries(state).filter(
            ([, value]) => typeof value !== "function",
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
