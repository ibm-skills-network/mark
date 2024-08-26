import type { Choice, Criteria, QuestionAuthorStore } from "@/config/types";
import { createRef, type RefObject } from "react";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import { extractAssignmentId } from "@/lib/strings";
import { withUpdatedAt } from "./middlewares";

export type AuthorState = {
  activeAssignmentId?: number | undefined;
  name: string;
  introduction: string;
  instructions: string;
  gradingCriteriaOverview: string;
  questions: QuestionAuthorStore[];
  questionOrder: number[];
  pageState: "loading" | "success" | "error";
  updatedAt: number | undefined;
};

type OptionalQuestion = {
  [K in keyof QuestionAuthorStore]?: QuestionAuthorStore[K];
};

export type AuthorActions = {
  setActiveAssignmentId: (id: number) => void;
  setName: (name: string) => void;
  setIntroduction: (introduction: string) => void;
  setInstructions: (instructions: string) => void;
  setGradingCriteriaOverview: (gradingCriteriaOverview: string) => void;
  setQuestions: (questions: QuestionAuthorStore[]) => void;
  addQuestion: (question: QuestionAuthorStore) => void;
  removeQuestion: (question: number) => void;
  modifyQuestion: (questionId: number, modifiedData: OptionalQuestion) => void;
  setCriterias: (questionId: number, criterias: Criteria[]) => Criteria[];
  addCriteria: (questionId: number, criteria: Criteria) => void;
  removeCriteria: (questionId: number, criteriaIndex: number) => void;
  setChoices: (questionId: number, choices: Choice[]) => void;
  addChoice: (questionId: number, choice?: string) => void;
  removeChoice: (questionId: number, choiceIndex: number) => void;
  toggleChoice: (questionId: number, choiceIndex: number) => void;
  modifyChoice: (
    questionId: number,
    choiceIndex: number,
    modifiedData: Partial<Choice>,
  ) => void;
  setPoints: (questionId: number, points: number) => void;
  setPageState: (state: "loading" | "success" | "error") => void;
  setUpdatedAt: (updatedAt: number) => void;
  setQuestionTitle: (questionTitle: string, questionId: number) => void;
  setQuestionOrder: (order: number[]) => void; // Ensure you add this method
  setAuthorStore: (state: Partial<AuthorState>) => void;
};
interface QuestionState {
  questionStates: {
    [key: number]: {
      showWordCountInput: boolean;
      countMode: "CHARACTER" | "WORD";
      toggleTitle: boolean;
      criteriaMode: "AI_GEN" | "CUSTOM";
    };
    showCriteriaHeader: boolean;
  };
  setShowWordCountInput: (questionId: number, value: boolean) => void;
  setCountMode: (questionId: number, mode: "CHARACTER" | "WORD") => void;
  setToggleTitle: (questionId: number, value: boolean) => void;
  setShowCriteriaHeader: (value: boolean) => void;
  setCriteriaMode: (questionId: number, mode: "AI_GEN" | "CUSTOM") => void;
}

export const useQuestionStore = createWithEqualityFn<QuestionState>((set) => ({
  questionStates: {
    showCriteriaHeader: true,
  },
  setShowWordCountInput: (questionId, value) =>
    set((state) => ({
      questionStates: {
        ...state.questionStates,
        [questionId]: {
          ...state.questionStates[questionId],
          showWordCountInput: value,
        },
      },
    })),
  setCountMode: (questionId, mode) =>
    set((state) => ({
      questionStates: {
        ...state.questionStates,
        [questionId]: {
          ...state.questionStates[questionId],
          countMode: mode,
        },
      },
    })),
  setToggleTitle: (questionId, value) =>
    set((state) => ({
      questionStates: {
        ...state.questionStates,
        [questionId]: {
          ...state.questionStates[questionId],
          toggleTitle: value,
        },
      },
    })),
  setShowCriteriaHeader: (value) =>
    set((state) => ({
      questionStates: {
        ...state.questionStates,
        showCriteriaHeader: value,
      },
    })),
  setCriteriaMode: (questionId, mode) =>
    set((state) => ({
      questionStates: {
        ...state.questionStates,
        [questionId]: {
          ...state.questionStates[questionId],
          criteriaMode: mode,
        },
      },
    })),
}));

export const useAuthorStore = createWithEqualityFn<
  AuthorState & AuthorActions
>()(
  persist(
    devtools(
      withUpdatedAt((set, get) => ({
        activeAssignmentId: undefined,
        setActiveAssignmentId: (id) => set({ activeAssignmentId: id }),
        name: "",
        setName: (title) => set({ name: title }),
        introduction: "",
        setIntroduction: (introduction) => set({ introduction }),
        instructions: "",
        setInstructions: (instructions) => set({ instructions }),
        gradingCriteriaOverview: "",
        setGradingCriteriaOverview: (gradingCriteriaOverview) =>
          set({ gradingCriteriaOverview }),
        questions: [],
        setQuestions: (questions) => set({ questions }),
        addQuestion: (question) =>
          set((state) => ({ questions: [...state.questions, question] })),
        removeQuestion: (questionId) =>
          set((state) => ({
            questions: state.questions.filter((q) => q.id !== questionId),
          })),
        modifyQuestion: (questionId, modifiedData) =>
          set((state) => ({
            questions: state.questions.map((q) =>
              q.id === questionId
                ? {
                    // keep the original data
                    ...q,
                    // add the modified data to the question
                    ...modifiedData,
                  }
                : {
                    ...q,
                  },
            ),
          })),
        setCriterias: (questionId, criterias) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                return {
                  ...q,
                  scoring: {
                    ...q.scoring,
                    criteria: criterias,
                  },
                };
              }
              return q;
            }),
          }));
          return criterias;
        },
        addCriteria: (questionId, criteria) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                return {
                  ...q,
                  scoring: {
                    ...q.scoring,
                    criteria: [...q.scoring.criteria, criteria],
                  },
                };
              }
              return q;
            }),
          }));
        },
        removeCriteria: (questionId, criteriaIndex) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                return {
                  ...q,
                  scoring: {
                    ...q.scoring,
                    criteria: q.scoring.criteria.filter(
                      (_, index) => index !== criteriaIndex,
                    ),
                  },
                };
              }
              return q;
            }),
          }));
        },
        setChoices: (questionId, choices) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                return {
                  ...q,
                  choices,
                };
              }
              return q;
            }),
          }));
        },
        addChoice: (questionId, choice) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                return {
                  ...q,
                  choices: [
                    ...q.choices,
                    { choice, isCorrect: false, points: 0 },
                  ],
                };
              }
              return q;
            }),
          }));
        },
        removeChoice: (questionId, choiceIndex) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                const choices = q.choices.filter(
                  (_, index) => index !== choiceIndex,
                );
                return {
                  ...q,
                  choices,
                };
              }
              return q;
            }),
          }));
        },
        toggleChoice: (questionId, choiceIndex) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                const choices = q.choices.map((choice, index) => {
                  if (index === choiceIndex) {
                    return {
                      ...choice,
                      isCorrect: !choice.isCorrect,
                    };
                  }
                  return choice;
                });
                return {
                  ...q,
                  choices,
                };
              }
              return q;
            }),
          }));
        },
        modifyChoice: (questionId, choiceIndex, modifiedData) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                const choices = q.choices.map((choice, index) => {
                  if (index === choiceIndex) {
                    return {
                      ...choice,
                      ...modifiedData,
                    };
                  }
                  return choice;
                });
                return {
                  ...q,
                  choices,
                };
              }
              return q;
            }),
          }));
        },
        setPoints: (questionId, points) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                return {
                  ...q,
                  totalPoints: points,
                };
              }
              return q;
            }),
          }));
        },
        questionOrder: [],
        setQuestionTitle: (questionTitle, questionId) => {
          set((state) => ({
            questions: state.questions.map((q) =>
              q.id === questionId
                ? {
                    ...q,
                    question: questionTitle,
                  }
                : q,
            ),
          }));
        },
        setQuestionOrder: (order) => {
          set((state) => ({
            ...state,
            questionOrder: order,
          }));
        },
        pageState: "loading",
        setPageState: (pageState) => set({ pageState }),
        updatedAt: undefined,
        setUpdatedAt: (updatedAt) => set({ updatedAt }),
        setAuthorStore: (state) => set((prev) => ({ ...prev, ...state })),
      })),
      {
        name: "author",
        enabled: process.env.NODE_ENV === "development",
      },
    ),
    {
      name: getAuthorStoreName(),
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
  shallow,
);
function getAuthorStoreName() {
  if (typeof window !== "undefined") {
    return `assignment-${extractAssignmentId(window.location.pathname)}-author`;
  }
  return "assignment-feedback-author";
}
