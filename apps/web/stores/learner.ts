import type {
  AssignmentAttempt,
  AssignmentDetails,
  QuestionStatus,
  QuestionStore,
} from "@/config/types";
import { createRef, type RefObject } from "react";
import { devtools, persist } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";

export type LearnerState = {
  activeAttemptId: number | null;
  activeQuestionNumber: number | null;
  expiresAt: number | undefined;
  questions: QuestionStore[];
  role?: "learner" | "author";
  totalPointsEarned: number;
  totalPointsPossible: number;
};

export type learnerFileResponse = {
  filename: string;
  content: string;
};

export type LearnerActions = {
  setActiveAttemptId: (id: number) => void;
  setActiveQuestionNumber: (id: number) => void;
  addQuestion: (question: QuestionStore) => void;
  setQuestion: (question: Partial<QuestionStore>) => void;
  showSubmissionFeedback: boolean;
  setShowSubmissionFeedback: (ShowSubmissionFeedback: boolean) => void;
  setQuestions: (questions: Partial<QuestionStore>[]) => void;
  setTextResponse: (learnerTextResponse: string, questionId?: number) => void;
  setURLResponse: (learnerUrlResponse: string, questionId?: number) => void;
  setChoices: (learnerChoices: string[], questionId?: number) => void;
  addChoice: (learnerChoice: string, questionId?: number) => void;
  removeChoice: (learnerChoice: string, questionId?: number) => void;
  setAnswerChoice: (learnerAnswerChoice: boolean, questionId?: number) => void;
  setLearnerStore: (learnerState: Partial<LearnerState>) => void;
  getQuestionStatusById: (questionId: number) => QuestionStatus;
  setQuestionStatus: (questionId: number, status?: QuestionStatus) => void;
  setRole: (role: "learner" | "author") => void;
  setTotalPointsEarned: (totalPointsEarned: number) => void;
  setTotalPointsPossible: (totalPointsPossible: number) => void;
  onUrlChange: (url: string, questionId: number) => void;
  onFileChange: (files: learnerFileResponse[], questionId: number) => void;
  onModeChange: (
    mode: "file" | "link",
    data: learnerFileResponse[] | string,
    questionId: number,
  ) => void;
  getFileUpload: (questionId: number) => learnerFileResponse[];
  setFileUpload: (
    learnerFileResponse: {
      filename: string;
      content: string;
    }[],
    questionId: number,
  ) => void;
  deleteFile: (fileToDelete: File, questionId: number) => void;
};

export type AssignmentDetailsState = {
  assignmentDetails: AssignmentDetails | null;
  grade: number | null;
};

export type AssignmentDetailsActions = {
  setAssignmentDetails: (assignmentDetails: AssignmentDetails) => void;
  setGrade: (grade: number) => void;
};

const isQuestionEdited = (question: QuestionStore) => {
  const {
    learnerTextResponse,
    learnerUrlResponse,
    learnerChoices,
    learnerAnswerChoice,
    learnerFileResponse,
  } = question;
  return (
    (learnerTextResponse &&
      learnerTextResponse.trim().length > 0 &&
      learnerTextResponse !== "<p><br></p>") ||
    (learnerUrlResponse && learnerUrlResponse.trim().length > 0) ||
    (learnerChoices && learnerChoices.length > 0) ||
    learnerAnswerChoice !== undefined ||
    learnerFileResponse?.map((file) => file?.content).join("") !== "" ||
    false
  );
};
export type LearnerOverviewState = {
  listOfAttempts: AssignmentAttempt[];
  assignmentId: number | null;
};
export type LearnerOverviewActions = {
  setListOfAttempts: (listOfAttempts: AssignmentAttempt[]) => void;
  setAssignmentId: (assignmentId: number) => void;
};

export const useLearnerOverviewStore = createWithEqualityFn<
  LearnerOverviewState & LearnerOverviewActions
>()(
  devtools(
    persist(
      (set) => ({
        listOfAttempts: [],
        assignmentId: undefined,
        setListOfAttempts: (listOfAttempts) => set({ listOfAttempts }),
        setAssignmentId: (assignmentId) => set({ assignmentId }),
      }),
      {
        name: "learner-store", // storage name
        partialize: (state) => ({
          listOfAttempts: state.listOfAttempts,
          assignmentId: state.assignmentId,
        }),
      },
    ),
    {
      name: "learner",
      enabled: process.env.NODE_ENV === "development",
      serialize: {
        options: true, // Enable serialization to avoid large data crashes
      },
    },
  ),
  shallow,
);

export const useLearnerStore = createWithEqualityFn<
  LearnerState & LearnerActions
>()(
  devtools(
    (set, get) => ({
      getFileUpload: (questionId) => {
        const question = get().questions.find((q) => q.id === questionId);
        return question?.learnerFileResponse || [];
      },
      onFileChange: (files, questionId) => {
        const formattedFiles = files.map((file: learnerFileResponse) => ({
          filename: file.filename,
          content: file.content,
        }));
        set((state) => {
          const updatedQuestions = state.questions.map((q) => {
            if (q.id === questionId) {
              return { ...q, learnerFileResponse: formattedFiles };
            }
            return q;
          });
          return { questions: updatedQuestions };
        });
        get().setQuestionStatus(questionId);
      },
      onUrlChange: (url, questionId) => {
        set((state) => {
          const updatedQuestions = state.questions.map((q) => {
            if (q.id === questionId) {
              return { ...q, learnerUrlResponse: url };
            }
            return q;
          });
          return { questions: updatedQuestions };
        });
      },
      onModeChange: (mode, data, questionId) => {
        if (mode === "file") {
          const formattedData = (data as learnerFileResponse[]).map((file) => ({
            filename: file.filename,
            content: file.content,
          }));
          get().onFileChange(formattedData, questionId);
        } else {
          get().onUrlChange(data as string, questionId);
        }
      },

      setFileUpload: (newFiles, questionId) => {
        set((state) => {
          const updatedQuestions = state.questions.map((q) => {
            if (q.id === questionId) {
              const existingFiles = q.learnerFileResponse || [];
              // Merge existing files with new files
              const mergedFiles = [...existingFiles, ...newFiles];
              return { ...q, learnerFileResponse: mergedFiles };
            }
            return q;
          });
          return { questions: updatedQuestions };
        });
        get().setQuestionStatus(questionId);
      },

      deleteFile: (fileToDelete, questionId) => {
        set((state) => {
          const updatedQuestions = state.questions.map((q) => {
            if (q.id === questionId) {
              const existingFiles = q.learnerFileResponse || [];
              const updatedFiles = existingFiles.filter(
                (file) => file.filename !== fileToDelete.name,
              );
              return { ...q, learnerFileResponse: updatedFiles };
            }
            return q;
          });
          return { questions: updatedQuestions };
        });
        get().setQuestionStatus(questionId);
      },
      activeAttemptId: null,
      totalPointsEarned: 0,
      totalPointsPossible: 0,
      setActiveAttemptId: (id) => set({ activeAttemptId: id }),
      activeQuestionNumber: 1,
      setActiveQuestionNumber: (id) => set({ activeQuestionNumber: id }),
      assignmentDetails: null,
      expiresAt: undefined,
      questions: [],
      showSubmissionFeedback: false,
      setShowSubmissionFeedback: (showSubmissionFeedback) =>
        set({ showSubmissionFeedback }),
      addQuestion: (question) =>
        set((state) => ({
          questions: [
            ...(state.questions ?? []),
            { ...question, status: "unedited" }, // Ensure status is initialized
          ],
        })),
      setQuestion: (question) =>
        set((state) => ({
          questions: state.questions?.map((q) =>
            q.id === question.id
              ? { ...q, ...question, status: q.status ?? "unedited" }
              : q,
          ),
        })),
      setQuestions: (questions) =>
        set((state) => {
          const updatedQuestions = questions.map((q) => {
            const prevDataForQuestion = state.questions.find(
              (q2) => q2.id === q.id,
            );
            return prevDataForQuestion ? { ...prevDataForQuestion, ...q } : q;
          });
          return { questions: updatedQuestions as QuestionStore[] };
        }),
      getQuestionStatusById: (questionId: number) => {
        const question = get().questions.find((q) => q.id === questionId);
        return question?.status ?? "unedited";
      },
      setQuestionStatus: (questionId: number, status?: QuestionStatus) => {
        const question = get().questions.find((q) => q.id === questionId);
        if (question && status === undefined) {
          const isEdited = isQuestionEdited(question);
          const newStatus = isEdited ? "edited" : "unedited";
          set((state) => ({
            questions: state.questions?.map((q) =>
              q.id === questionId ? { ...q, status: newStatus } : q,
            ),
          }));
        } else if (status) {
          set((state) => ({
            questions: state.questions?.map((q) =>
              q.id === questionId ? { ...q, status } : q,
            ),
          }));
        }
      },

      // Consolidate response updating logic
      setTextResponse: (learnerTextResponse, questionId) => {
        set((state) => ({
          questions: state.questions?.map((q) =>
            q.id === questionId ? { ...q, learnerTextResponse } : q,
          ),
        }));
        get().setQuestionStatus(questionId);
      },

      setURLResponse: (learnerUrlResponse, questionId) => {
        set((state) => ({
          questions: state.questions?.map((q) =>
            q.id === questionId ? { ...q, learnerUrlResponse } : q,
          ),
        }));
        get().setQuestionStatus(questionId);
      },

      setChoices: (learnerChoices, questionId) => {
        set((state) => ({
          questions: state.questions?.map((q) =>
            q.id === questionId ? { ...q, learnerChoices } : q,
          ),
        }));
        get().setQuestionStatus(questionId);
      },

      addChoice: (learnerChoice, questionId) => {
        set((state) => {
          const updatedQuestions = state.questions.map((q) =>
            q.id === questionId
              ? {
                  ...q,
                  learnerChoices: [...(q.learnerChoices ?? []), learnerChoice],
                }
              : q,
          );
          return { questions: updatedQuestions };
        }),
          get().setQuestionStatus(questionId);
      },
      removeChoice: (learnerChoice, questionId) => {
        set((state) => {
          const updatedQuestions = state.questions.map((q) =>
            q.id === questionId
              ? {
                  ...q,
                  learnerChoices: q.learnerChoices?.filter(
                    (c) => c !== learnerChoice,
                  ),
                }
              : q,
          );
          return { questions: updatedQuestions };
        }),
          get().setQuestionStatus(questionId);
      },
      setAnswerChoice: (learnerAnswerChoice, questionId) => {
        set((state) => {
          const activeQuestionId =
            questionId || state.questions[state.activeQuestionNumber - 1].id;
          const updatedQuestions = state.questions.map((q) =>
            q.id === activeQuestionId
              ? { ...q, learnerAnswerChoice: Boolean(learnerAnswerChoice) }
              : q,
          );
          return { questions: updatedQuestions };
        });
        get().setQuestionStatus(questionId);
      },
      setRole: (role) => set({ role }),
      setLearnerStore: (learnerState) => set(learnerState),
      setTotalPointsEarned: (totalPointsEarned) => set({ totalPointsEarned }),
      setTotalPointsPossible: (totalPointsPossible) =>
        set({ totalPointsPossible }),
    }),
    {
      name: "learner",
      enabled: process.env.NODE_ENV === "development",
      serialize: {
        options: true, // Enable serialization to avoid large data crashes
      },
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
      partialize: (state) => ({
        assignmentDetails: state.assignmentDetails,
      }),
      // storage: createJSONStorage(() => localStorage),
    },
  ),
  shallow,
);
