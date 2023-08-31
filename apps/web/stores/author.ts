import { Question } from "@/config/types";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";

export type AuthorState = {
  activeAssignmentID?: number;
  questions: Question[];
};

export type AuthorActions = {
  setActiveAssignmentID: (id: number) => void;
  setQuestions: (questions: Question[]) => void;
  addQuestion: (question: Question) => void;
  removeQuestion: (question: number) => void;
};

export const useAuthorStore = createWithEqualityFn<AuthorState & AuthorActions>(
  (set) => ({
    activeAssignmentID: undefined,
    setActiveAssignmentID: (id) => set({ activeAssignmentID: id }),
    questions: [],
    setQuestions: (questions) => set({ questions }),
    addQuestion: (question) =>
      set((state) => ({ questions: [...state.questions, question] })),
    removeQuestion: (questionID) =>
      set((state) => ({
        questions: state.questions.filter((q) => q.id !== questionID),
      })),
  }),
  shallow
);
