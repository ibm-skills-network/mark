import type { Choice, Criteria, QuestionAuthorStore } from "@/config/types";
import { extractAssignmentId } from "@/lib/strings";
import { createRef, type RefObject } from "react";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";
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
  focusedQuestionId?: number | undefined;
};

type OptionalQuestion = {
  [K in keyof QuestionAuthorStore]?: QuestionAuthorStore[K];
};

export type AuthorActions = {
  setFocusedQuestionId: (id: number) => void;
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
  addChoice: (questionId: number, choice?: boolean) => void;
  addTrueFalseChoice: (questionId: number, isTrueOrFalse: boolean) => void;
  getTrueFalsePoints: (questionId: number) => number;
  updatePointsTrueFalse: (questionId: number, points: number) => void;
  isItTrueOrFalse: (questionId: number) => boolean;
  removeChoice: (questionId: number, choiceIndex: number) => void;
  toggleChoice: (questionId: number, choiceIndex: number) => void;
  modifyChoice: (
    questionId: number,
    choiceIndex: number,
    modifiedData: Partial<Choice>,
  ) => void;
  modifyChoiceFeedback: (
    questionId: number,
    choiceIndex: number,
    feedback: string,
  ) => void;
  setPoints: (questionId: number, points: number) => void;
  setPageState: (state: "loading" | "success" | "error") => void;
  setUpdatedAt: (updatedAt: number) => void;
  setQuestionTitle: (questionTitle: string, questionId: number) => void;
  setQuestionOrder: (order: number[]) => void;
  setAuthorStore: (state: Partial<AuthorState>) => void;
  validate: () => boolean;
  errors: Record<string, string>;
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
        errors: {},
        focusedQuestionId: undefined,
        setFocusedQuestionId: (id: number) => set({ focusedQuestionId: id }),
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
          set((state) => {
            const index = state.questions.findIndex((q) => q.id === questionId);
            if (index === -1) return {}; // No changes
            const updatedQuestions = state.questions.filter(
              (q) => q.id !== questionId,
            );
            return { questions: updatedQuestions };
          }),
        modifyQuestion: (questionId, modifiedData) =>
          set((state) => {
            const index = state.questions.findIndex((q) => q.id === questionId);
            if (index === -1) return {}; // No changes

            const existingQuestion = state.questions[index];
            const updatedQuestion = {
              ...existingQuestion,
              ...modifiedData,
            };

            if (existingQuestion === updatedQuestion) {
              return {}; // No changes
            }

            const updatedQuestions = [...state.questions];
            updatedQuestions[index] = updatedQuestion;

            return { questions: updatedQuestions };
          }),
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
        // Add or update a question's choice to be either "True" or "False"
        addTrueFalseChoice: (questionId, isTrue) => {
          return set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId && q.choices) {
                // Only update the choice and isCorrect, keep the points unchanged
                const updatedChoices = q.choices.map((choice) => ({
                  ...choice,
                  choice: isTrue ? "true" : "false", // Toggle between True and False
                  isCorrect: true,
                }));

                return {
                  ...q,
                  choices: updatedChoices,
                };
              } else if (q.id === questionId && !q.choices) {
                return {
                  ...q,
                  choices: [
                    {
                      choice: isTrue ? "true" : "false",
                      isCorrect: true,
                      points: 0,
                    },
                  ],
                };
              }
              return q;
            }),
          }));
        },

        getTrueFalsePoints: (questionId) => {
          const question = get().questions.find((q) => q.id === questionId);
          if (!question || !question.choices) return 0; // If no question or no choices exist, return 0
          return question.choices[0]?.points || 0; // Return the points for the first choice
        },

        updatePointsTrueFalse: (questionId, points) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                // If the question already has a choice array, update it, otherwise create new
                const updatedChoices = q.choices?.map((choice) => ({
                  ...choice,
                  points,
                }));

                return {
                  ...q,
                  choices: updatedChoices,
                };
              }
              return q;
            }),
          }));
        },
        // Function to retrieve whether the question has only "True" or "False" choices
        isItTrueOrFalse: (questionId) => {
          const question = get().questions.find((q) => q.id === questionId);
          if (!question || !question.choices) return null; // If no question or no choices exist, return null

          return question.choices.find((choice) => choice?.choice === "true")
            ? true
            : false;
        },
        addChoice: (questionId, choice) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                return {
                  ...q,
                  choices: [
                    ...q.choices,
                    {
                      choice: "",
                      isCorrect: false,
                      points: q.type === "MULTIPLE_CORRECT" ? -1 : 0,
                    },
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
        modifyChoice: (questionId, choiceIndex, modifiedData) =>
          set((state) => {
            const questions = state.questions;
            const questionIndex = questions.findIndex(
              (q) => q.id === questionId,
            );
            if (questionIndex === -1) return {}; // No changes
            const question = questions[questionIndex];
            const choices = question.choices;
            const choice = choices[choiceIndex];
            const updatedChoice = { ...choice, ...modifiedData };
            if (choice === updatedChoice) return {};
            const updatedChoices = [...choices];
            updatedChoices[choiceIndex] = updatedChoice;
            const updatedQuestion = { ...question, choices: updatedChoices };
            const updatedQuestions = [...questions];
            updatedQuestions[questionIndex] = updatedQuestion;
            return { questions: updatedQuestions };
          }),
        modifyChoiceFeedback: (questionId, choiceIndex, feedback) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                const choices = q.choices.map((choice, index) => {
                  if (index === choiceIndex) {
                    return {
                      ...choice,
                      feedback,
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
        setAuthorStore: (state) => {
          const currentState = get();
          set((prev) => ({
            ...prev,
            ...state,
            questions: currentState.questions.length
              ? currentState.questions
              : state.questions || [],
          }));
        },
        validate: () => {
          const state = get();
          const errors: Record<string, string> = {};
          if (
            !state.introduction ||
            state.introduction.trim() === "<p><br></p>"
          ) {
            errors.introduction = "Introduction is required.";
          }
          set({ errors });
          return Object.keys(errors).length === 0;
        },
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
      onRehydrateStorage: (state) => (storedState) => {
        if (process.env.NODE_ENV !== "development") {
          console.log("Rehydrated state", storedState);
        }
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
