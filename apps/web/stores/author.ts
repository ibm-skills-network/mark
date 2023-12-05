import type { Choice, Criteria, QuestionAuthorStore } from "@/config/types";
import { createRef, type RefObject } from "react";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";

export type AuthorState = {
  activeAssignmentId?: number | null;
  assignmentTitle: string;
  updateAssignmentButtonRef: RefObject<HTMLButtonElement>;
  questions: QuestionAuthorStore[];
};

type OptionalQuestion = {
  [K in keyof QuestionAuthorStore]?: QuestionAuthorStore[K];
};

export type AuthorActions = {
  setActiveAssignmentId: (id: number) => void;
  setQuestions: (questions: QuestionAuthorStore[]) => void;
  setAssignmentTitle: (title: string) => void;
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
    modifiedData: string
  ) => void;
  setPoints: (questionId: number, points: number) => void;
};

export const useAuthorStore = createWithEqualityFn<AuthorState & AuthorActions>(
  (set, get) => ({
    activeAssignmentId: null,
    setActiveAssignmentId: (id) => set({ activeAssignmentId: id }),
    assignmentTitle: "",
    setAssignmentTitle: (title) => set({ assignmentTitle: title }),
    updateAssignmentButtonRef: createRef<HTMLButtonElement>(),
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
              }
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
                  (_, index) => index !== criteriaIndex
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
              choices: [...q.choices, { choice, isCorrect: false, points: 1 }],
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
              (_, index) => index !== choiceIndex
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
                  choice: modifiedData,
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
  }),
  shallow
);
