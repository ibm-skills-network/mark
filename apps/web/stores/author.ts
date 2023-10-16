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
  addChoice: (questionId: number, choice?: string) => void;
  removeChoice: (questionId: number, choice: string) => void;
  toggleChoice: (questionId: number, choice: string) => void;
  modifyChoice: (
    questionId: number,
    choiceIndex: number,
    modifiedData: string
  ) => void;
};

export const useAuthorStore = createWithEqualityFn<AuthorState & AuthorActions>(
  (set, get) => ({
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
    addChoice: (questionId, choice = "") => {
      set((state) => ({
        questions: state.questions.map((q) => {
          if (q.id === questionId) {
            const choices = q.choices;
            const newMapWithAddedChoice = choices.set(choice, false);
            return {
              ...q,
              choices: newMapWithAddedChoice,
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
            // const { [choice]: _, ...choices } = q.choices;
            const choices = new Map(q.choices);
            choices.delete(choice);
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
            const choices = new Map(q.choices);
            return {
              ...q,
              choices: choices.set(choice, !choices.get(choice)),
            };
          }
          return q;
        }),
      }));
    },
    modifyChoice: (questionId, choiceIndex, modifiedData) => {
      set((state) => ({
        questions: state.questions.map((q) => {
          console.log(q.id, questionId);
          if (q.id === questionId) {
            // convert choices object to a list of key value pairs
            // const choices = Object.entries(q.choices);
            // // for each choice, if the index matches the choiceIndex, replace the choice with the modifiedData
            // const newChoices = choices.map(([choice, isCorrect], index) => {
            //   if (index === choiceIndex) {
            //     return [modifiedData, isCorrect];
            //   }
            //   // otherwise, keep the choice the same
            //   return [choice, isCorrect];
            // });
            // // convert back to object
            // const newChoicesObj = Object.fromEntries(newChoices) as Choices;
            // return {
            //   ...q,
            //   choices: newChoicesObj,
            // };
            const choices = new Map(q.choices);
            let index = 0;
            // for each choice, if the index matches the choiceIndex, replace the choice with the modifiedData
            choices.forEach((isCorrect, choice) => {
              if (choiceIndex === index) {
                // remove the old choice
                choices.delete(choice);
                choices.set(modifiedData, isCorrect);
              }
              index++;
            });
            return {
              ...q,
              choices,
            };
          }
          // if the question id doesn't match, return the question as is
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
