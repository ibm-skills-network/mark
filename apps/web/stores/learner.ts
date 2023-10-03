import type { assignmentDetailsStore, QuestionStore } from "@/config/types";
import { devtools, persist } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";

export type LearnerState = {
  activeAttemptId: number | null;
  activeQuestionId: number | null;
  questions: QuestionStore[];
};

export type LearnerActions = {
  setActiveAttemptId: (id: number) => void;
  setActiveQuestionId: (id: number) => void;
  addQuestion: (question: QuestionStore) => void;
  setQuestion: (question: QuestionStore) => void;
  setTextResponse: (learnerTextResponse: string, questionId?: number) => void;
  setURLResponse: (learnerUrlResponse: string, questionId?: number) => void;
  setChoices: (learnerChoices: string[], questionId?: number) => void;
  setAnswerChoice: (learnerAnswerChoice: boolean, questionId?: number) => void;
};

export type AssignmentDetailsState = {
  assignmentDetails: assignmentDetailsStore | null;
};

export type AssignmentDetailsActions = {
  setAssignmentDetails: (assignmentDetails: assignmentDetailsStore) => void;
};

export const useLearnerStore = createWithEqualityFn<
  LearnerState & LearnerActions
>()(
  devtools(
    (set) => ({
      activeAttemptId: null,
      setActiveAttemptId: (id) => set({ activeAttemptId: id }),
      activeQuestionId: 1,
      setActiveQuestionId: (id) => set({ activeQuestionId: id }),
      assignmentDetails: null,
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

/**
 * made this a separate store so I can leverage the persist middleware (to store in sessionStorage)
 * Purpose: to store the assignment details which are fetched from the backend when the learner
 * is on the assignment overview page. This reduces the number of requests to the backend.
 */
export const useAssignmentDetails = createWithEqualityFn<
  AssignmentDetailsState & AssignmentDetailsActions
>()(
  persist(
    devtools(
      (set) => ({
        assignmentDetails: null,
        setAssignmentDetails: (assignmentDetails) =>
          set({ assignmentDetails: assignmentDetails }),
      }),
      {
        name: "learner",
        enabled: process.env.NODE_ENV === "development",
      }
    ),
    {
      name: "assignmentDetails",
      getStorage: () => sessionStorage,
    }
  ),
  shallow
);
