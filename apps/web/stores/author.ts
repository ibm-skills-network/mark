import type { Choices, Criteria, QuestionAuthorStore } from "@/config/types";
import { createRef, type RefObject } from "react";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";

export type AuthorState = {
  activeAssignmentId?: number | null;
  questions: QuestionAuthorStore[];
  assignmentTitle: string;
  updateAssignmentButtonRef: RefObject<HTMLButtonElement>;
};

type OptionalQuestion = {
  [K in keyof QuestionAuthorStore]?: QuestionAuthorStore[K];
};

export type AuthorActions = {
  setActiveAssignmentId: (id: number) => void;
  setQuestions: (questions: QuestionAuthorStore[]) => void;
  addQuestion: (question: QuestionAuthorStore) => void;
  removeQuestion: (question: number) => void;
  modifyQuestion: (questionId: number, modifiedData: OptionalQuestion) => void;
  setAssignmentTitle: (title: string) => void;
  setCriterias: (questionId: number, criterias: Criteria[]) => Criteria[];
  addCriteria: (questionId: number, criteria: Criteria) => void;
  removeCriteria: (questionId: number, criteriaIndex: number) => void;
  setChoices: (questionId: number, choices: Choices) => void;
  addChoice: (questionId: number, choice: string) => void;
  removeChoice: (questionId: number, choice: string) => void;
  toggleChoice: (questionId: number, choice: string) => void;
  modifyChoice: (
    questionId: number,
    choiceIndex: number,
    modifiedData: string
  ) => void;
};

export const useAuthorStore = createWithEqualityFn<AuthorState & AuthorActions>(
  (set) => ({
    activeAssignmentId: null,
    setActiveAssignmentId: (id) => set({ activeAssignmentId: id }),
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
              choices: {
                ...q.choices,
                [choice]: false,
              },
            };
          }
          return q;
        }),
      }));
    },
    removeChoice: (questionId, choice) => {
      set((state) => ({
        questions: state.questions.map((q) => {
          if (q.id === questionId) {
            const { [choice]: _, ...choices } = q.choices;
            return {
              ...q,
              choices,
            };
          }
          return q;
        }),
      }));
    },
    toggleChoice: (questionId, choice) => {
      set((state) => ({
        questions: state.questions.map((q) => {
          if (q.id === questionId) {
            return {
              ...q,
              choices: {
                ...q.choices,
                [choice]: !q.choices[choice],
              },
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
            const choices = Object.entries(q.choices);
            choices.map(([choice, isCorrect], index) => {
              if (index === choiceIndex) {
                const { [choice]: _, ...choices } = q.choices;
                console.log(choices);
                console.log(modifiedData);
                return {
                  ...q,
                  choices: {
                    ...choices,
                    [modifiedData]: isCorrect,
                  },
                };
              }
            });
          }
          return q;
        }),
      }));
    },
    assignmentTitle: "",
    setAssignmentTitle: (title) => set({ assignmentTitle: title }),
    updateAssignmentButtonRef: createRef<HTMLButtonElement>(),
  }),
  shallow
);
