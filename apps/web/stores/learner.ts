import type { assignmentDetailsStore, QuestionStore } from "@/config/types";
import { createRef, type RefObject } from "react";
import { devtools, persist } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";

export type LearnerState = {
  activeAttemptId: number | null;
  activeQuestionNumber: number | null;
  expiresAt?: string;
  questions: QuestionStore[];
  submitAssignmentRef: RefObject<HTMLButtonElement>;
};

export type LearnerActions = {
  setActiveAttemptId: (id: number) => void;
  setActiveQuestionNumber: (id: number) => void;
  addQuestion: (question: QuestionStore) => void;
  setQuestion: (question: QuestionStore) => void;
  setTextResponse: (learnerTextResponse: string, questionId?: number) => void;
  setURLResponse: (learnerUrlResponse: string, questionId?: number) => void;
  setChoices: (learnerChoices: string[], questionId?: number) => void;
  addChoice: (learnerChoice: string, questionId?: number) => void;
  removeChoice: (learnerChoice: string, questionId?: number) => void;
  setAnswerChoice: (learnerAnswerChoice: boolean, questionId?: number) => void;
};

export type AssignmentDetailsState = {
  assignmentDetails: assignmentDetailsStore | null;
  grade: number | null;
};

export type AssignmentDetailsActions = {
  setAssignmentDetails: (assignmentDetails: assignmentDetailsStore) => void;
  setGrade: (grade: number) => void;
};

export const useLearnerStore = createWithEqualityFn<
  LearnerState & LearnerActions
>()(
  devtools(
    (set) => ({
      activeAttemptId: null,
      setActiveAttemptId: (id) => set({ activeAttemptId: id }),
      activeQuestionNumber: 1,
      setActiveQuestionNumber: (id) => set({ activeQuestionNumber: id }),
      assignmentDetails: null,
      questions: [],
      addQuestion: (question) =>
        set((state) => ({
          questions: [...(state.questions ?? []), question],
        })),
      setQuestion: (question) =>
        set((state) => ({
          questions: state.questions?.map((q) =>
            q.id === question.id ? question : q,
          ),
        })),
      setTextResponse: (learnerTextResponse, questionId) =>
        set((state) => ({
          questions: state.questions?.map((q) => {
            return q.id ===
              (questionId || state.questions[state.activeQuestionNumber - 1].id)
              ? { ...q, learnerTextResponse }
              : q;
          }),
        })),
      setURLResponse: (learnerUrlResponse, questionId) =>
        set((state) => ({
          questions: state.questions?.map((q) =>
            q.id ===
            (questionId || state.questions[state.activeQuestionNumber - 1].id)
              ? { ...q, learnerUrlResponse }
              : q,
          ),
        })),
      setChoices: (learnerChoices, questionId) =>
        set((state) => ({
          questions: state.questions?.map((q) =>
            q.id ===
            (questionId || state.questions[state.activeQuestionNumber - 1].id)
              ? { ...q, learnerChoices }
              : q,
          ),
        })),
      addChoice: (learnerChoice, questionId) =>
        set((state) => ({
          questions: state.questions?.map((q) =>
            q.id ===
            (questionId || state.questions[state.activeQuestionNumber - 1].id)
              ? {
                  ...q,
                  learnerChoices: [...(q.learnerChoices ?? []), learnerChoice],
                }
              : q,
          ),
        })),
      removeChoice: (learnerChoice, questionId) =>
        set((state) => ({
          questions: state.questions?.map((q) =>
            q.id ===
            (questionId || state.questions[state.activeQuestionNumber - 1].id)
              ? {
                  ...q,
                  learnerChoices: q.learnerChoices?.filter(
                    (c) => c !== learnerChoice,
                  ),
                }
              : q,
          ),
        })),
      setAnswerChoice: (learnerAnswerChoice, questionId) =>
        set((state) => ({
          questions: state.questions?.map((q) =>
            q.id ===
            (questionId || state.questions[state.activeQuestionNumber - 1].id)
              ? { ...q, learnerAnswerChoice }
              : q,
          ),
        })),
      submitAssignmentRef: createRef<HTMLButtonElement>(),
    }),
    {
      name: "learner",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
  shallow,
);

/**
 * made this a separate store so I can leverage the persist middleware (to store in local storage)
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
        grade: null,
        setGrade: (grade) => set({ grade }),
      }),
      {
        name: "learner",
        enabled: process.env.NODE_ENV === "development",
      },
    ),
    {
      name: "assignmentDetails",
      // storage: createJSONStorage(() => localStorage),
    },
  ),
  shallow,
);
