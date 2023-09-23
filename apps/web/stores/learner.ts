import { questionsData } from "@/config/constants";
import type { QuestionStore } from "@/config/types";
import { devtools } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";

export type LearnerState = {
  activeAssignmentId: number | undefined;
  activeQuestionId: number | undefined;
  questions: QuestionStore[];
};

export type LearnerActions = {
  setActiveAssignmentId: (id: number) => void;
  setActiveQuestionId: (id: number) => void;
  addQuestion: (question: QuestionStore) => void;
  setQuestion: (question: QuestionStore) => void;
  setTextResponse: (learnerTextResponse: string, questionId?: number) => void;
  setURLResponse: (learnerUrlResponse: string, questionId?: number) => void;
  setChoices: (learnerChoices: string[], questionId?: number) => void;
  setAnswerChoice: (learnerAnswerChoice: boolean, questionId?: number) => void;
};

export const useLearnerStore = createWithEqualityFn<
  LearnerState & LearnerActions
>()(
  devtools(
    (set) => ({
      activeAssignmentId: undefined,
      setActiveAssignmentId: (id) => set({ activeAssignmentId: id }),
      activeQuestionId: 1,
      setActiveQuestionId: (id) => set({ activeQuestionId: id }),
      questions: [],
      addQuestion: (question) =>
        set((state) => ({
          questions: [...(state.questions ?? []), question],
        })),
      setQuestion: (question) =>
        set((state) => ({
          questions: state.questions?.map((q) =>
            q.id === question.id ? question : q
          ),
        })),
      setTextResponse: (learnerTextResponse, questionId) =>
        set((state) => ({
          questions: state.questions?.map((q) => {
            return q.id === (questionId || state.activeQuestionId)
              ? { ...q, learnerTextResponse }
              : q;
          }),
        })),
      setURLResponse: (learnerUrlResponse, questionId) =>
        set((state) => ({
          questions: state.questions?.map((q) =>
            q.id === (questionId || state.activeQuestionId)
              ? { ...q, learnerUrlResponse }
              : q
          ),
        })),
      setChoices: (learnerChoices, questionId) =>
        set((state) => ({
          questions: state.questions?.map((q) =>
            q.id === (questionId || state.activeQuestionId)
              ? { ...q, learnerChoices }
              : q
          ),
        })),
      setAnswerChoice: (learnerAnswerChoice, questionId) =>
        set((state) => ({
          questions: state.questions?.map((q) =>
            q.id === (questionId || state.activeQuestionId)
              ? { ...q, learnerAnswerChoice }
              : q
          ),
        })),
    }),
    {
      name: "learner",
      enabled: process.env.NODE_ENV === "development",
    }
  ),
  shallow
);
