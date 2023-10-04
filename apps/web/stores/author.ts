import type { Criteria, QuestionAuthorStore } from "@/config/types";
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
  setCriterias: (criterias: Criteria[]) => void;
  addCriteria: (criteria: Criteria) => void;
  removeCriteria: (criteriaIndex: number) => void;
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
    setCriterias: (criterias) => {
      set((state) => ({
        questions: state.questions.map((q) => {
          // if (q.scoring?.type === "CRITERIA_BASED") {
          return {
            ...q,
            criterias,
          };
          // }
          return q;
        }),
      }));
    },
    addCriteria: (criteria) => {
      set((state) => ({
        questions: state.questions.map((q) => {
          // if (q.scoring?.type === "CRITERIA_BASED") {
          return {
            ...q,
            criterias: [...q.scoring.criteria, criteria],
          };
          // }
          return q;
        }),
      }));
    },
    removeCriteria: (criteriaIndex) => {
      set((state) => ({
        questions: state.questions.map((q) => {
          // if (q.scoring?.type === "CRITERIA_BASED") {
          return {
            ...q,
            criterias: q.scoring.criteria.filter((_, i) => i !== criteriaIndex),
          };
          // }
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
