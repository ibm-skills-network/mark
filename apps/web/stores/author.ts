import type { Question } from "@/config/types";
import { createRef, type RefObject } from "react";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";

export type AuthorState = {
  activeAssignmentId?: number;
  questions: Question[];
  assignmentTitle: string;
  updateAssignmentButtonRef: RefObject<HTMLButtonElement>;
};

type OptionalQuestion = {
  [K in keyof Question]?: Question[K];
};

export type AuthorActions = {
  setActiveAssignmentId: (id: number) => void;
  setQuestions: (questions: Question[]) => void;
  addQuestion: (question: Question) => void;
  removeQuestion: (question: number) => void;
  modifyQuestion: (questionId: number, modifiedData: OptionalQuestion) => void;
  setAssignmentTitle: (title: string) => void;
};

export const useAuthorStore = createWithEqualityFn<AuthorState & AuthorActions>(
  (set) => ({
    activeAssignmentId: undefined,
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
    assignmentTitle: "",
    setAssignmentTitle: (title) => set({ assignmentTitle: title }),
    updateAssignmentButtonRef: createRef<HTMLButtonElement>(),
  }),
  shallow
);
