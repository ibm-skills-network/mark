import type { Choice, Criteria, QuestionAuthorStore } from "@/config/types";
import { createRef, type RefObject } from "react";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import { withUpdatedAt } from "./middlewares";
import { extractAssignmentId } from "@/lib/strings";

export type AuthorState = {
  activeAssignmentId?: number | null;
  assignmentTitle: string;
  introduction: string;
  instructions: string;
  gradingCriteriaOverview: string;
  questions: QuestionAuthorStore[];
  pageState: "loading" | "success" | "error";
  updatedAt: number;
};

type OptionalQuestion = {
  [K in keyof QuestionAuthorStore]?: QuestionAuthorStore[K];
};

export type AuthorActions = {
  setActiveAssignmentId: (id: number) => void;
  setAssignmentTitle: (title: string) => void;
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
};

export const useAuthorStore = createWithEqualityFn<
  AuthorState & AuthorActions
>()(
  persist(
    devtools(
      withUpdatedAt((set, get) => ({
        activeAssignmentId: null,
        setActiveAssignmentId: (id) => set({ activeAssignmentId: id }),
        assignmentTitle: "",
        setAssignmentTitle: (title) => set({ assignmentTitle: title }),
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
        pageState: "loading",
        setPageState: (state) => set({ pageState: state }),
        updatedAt: Date.now(),
        setUpdatedAt: (updatedAt) => set({ updatedAt }),
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
