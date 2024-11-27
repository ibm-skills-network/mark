import type {
  Choice,
  Criteria,
  QuestionAuthorStore,
  QuestionVariants,
} from "@/config/types";
import { extractAssignmentId } from "@/lib/strings";
import { createRef, type RefObject } from "react";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import { withUpdatedAt } from "./middlewares";

export type AuthorState = {
  activeAssignmentId?: number | undefined;
  learningObjectives: string;
  name: string;
  introduction: string;
  instructions: string;
  gradingCriteriaOverview: string;
  questions: QuestionAuthorStore[];
  questionOrder: number[];
  pageState: "loading" | "success" | "error";
  updatedAt: number | undefined;
  focusedQuestionId?: number | undefined;
};

type OptionalQuestion = {
  [K in keyof QuestionAuthorStore]?: QuestionAuthorStore[K];
};

export type AuthorActions = {
  setLearningObjectives: (learningObjectives: string) => void;
  setFocusedQuestionId: (id: number) => void;
  setActiveAssignmentId: (id: number) => void;
  setName: (name: string) => void;
  setIntroduction: (introduction: string) => void;
  setInstructions: (instructions: string) => void;
  setGradingCriteriaOverview: (gradingCriteriaOverview: string) => void;
  setQuestions: (questions: QuestionAuthorStore[]) => void;
  addQuestion: (question: QuestionAuthorStore) => void;
  removeQuestion: (question: number) => void;
  replaceQuestion: (
    questionId: number,
    newQuestion: QuestionAuthorStore,
  ) => void;
  modifyQuestion: (questionId: number, modifiedData: OptionalQuestion) => void;
  setCriterias: (questionId: number, criterias: Criteria[]) => Criteria[];
  addCriteria: (questionId: number, criteria: Criteria) => void;
  removeCriteria: (questionId: number, criteriaIndex: number) => void;
  addTrueFalseChoice: (questionId: number, isTrueOrFalse: boolean) => void;
  getTrueFalsePoints: (questionId: number) => number;
  updatePointsTrueFalse: (questionId: number, points: number) => void;
  isItTrueOrFalse: (questionId: number) => boolean;
  setChoices: (
    questionId: number,
    choices: Choice[],
    variantId?: number,
  ) => void;
  addChoice: (questionId: number, choice?: Choice, variantId?: number) => void;
  removeChoice: (
    questionId: number,
    choiceIndex: number,
    variantId?: number,
  ) => void;
  toggleChoice: (
    questionId: number,
    choiceIndex: number,
    variantId?: number,
  ) => void;
  handleUpdateAllVariantsCriteria: (
    questionId: number,
    criteria: Criteria[],
  ) => void;
  modifyChoice: (
    questionId: number,
    choiceIndex: number,
    modifiedData: Partial<Choice>,
    variantId?: number,
  ) => void;
  modifyChoiceFeedback: (
    questionId: number,
    choiceIndex: number,
    feedback: string,
    variantId?: number,
  ) => void;
  setPoints: (questionId: number, points: number) => void;
  setPageState: (state: "loading" | "success" | "error") => void;
  setUpdatedAt: (updatedAt: number) => void;
  setQuestionTitle: (questionTitle: string, questionId: number) => void;
  setQuestionVariantTitle: (
    questionVariantTitle: string,
    questionId: number,
    variantId: number,
  ) => void;
  addVariant: (questionId: number, newVariant: QuestionVariants) => void;
  editVariant: (
    questionId: number,
    variantId: number,
    updatedData: Partial<QuestionVariants>,
  ) => void;
  deleteVariant: (questionId: number, variantId: number) => void;
  setQuestionOrder: (order: number[]) => void;
  setAuthorStore: (state: Partial<AuthorState>) => void;
  validate: () => boolean;
  deleteStore: () => void;
  errors: Record<string, string>;
};
interface QuestionState {
  questionStates: {
    [key: number]: {
      isloading?: boolean;
      showWordCountInput?: boolean;
      countMode?: "CHARACTER" | "WORD";
      toggleTitle?: boolean;
      criteriaMode?: "AI_GEN" | "CUSTOM";
      variants?: {
        [variantId: number]: {
          toggleTitle?: boolean;
          isloading?: boolean;
        };
      };
    };
    showCriteriaHeader: boolean;
  };
  clearQuestionState: (questionId: number, variantId?: number) => void;
  setShowWordCountInput: (questionId: number, value: boolean) => void;
  setCountMode: (questionId: number, mode: "CHARACTER" | "WORD") => void;
  getToggleTitle: (questionId: number, variantId?: number) => boolean;
  setToggleTitle: (
    questionId: number,
    value: boolean,
    variantId?: number,
  ) => void;
  setShowCriteriaHeader: (value: boolean) => void;
  setCriteriaMode: (questionId: number, mode: "AI_GEN" | "CUSTOM") => void;
  toggleLoading: (
    questionId: number,
    value: boolean,
    variantId?: number,
  ) => void;
}

export const useQuestionStore = createWithEqualityFn<QuestionState>()(
  devtools(
    (set, get) => ({
      questionStates: {
        showCriteriaHeader: true,
      },
      setShowWordCountInput: (questionId, value) =>
        set((state) => ({
          questionStates: {
            ...state.questionStates,
            [questionId]: {
              ...state.questionStates[questionId],
              showWordCountInput: value,
            },
          },
        })),

      setCountMode: (questionId, mode) =>
        set((state) => ({
          questionStates: {
            ...state.questionStates,
            [questionId]: {
              ...state.questionStates[questionId],
              countMode: mode,
            },
          },
        })),
      getToggleTitle: (questionId, variantId) => {
        const state = get();
        if (variantId) {
          return !!state.questionStates[questionId]?.variants?.[variantId]
            ?.toggleTitle;
        }
        return !!state.questionStates[questionId]?.toggleTitle;
      },
      clearQuestionState: (questionId, variantId) =>
        // if variantId is provided delete the variant state only, otherwise delete the main question state
        set((state) => ({
          questionStates: {
            ...state.questionStates,
            [questionId]: {
              ...(variantId
                ? {
                    ...state.questionStates[questionId],
                    variants: Object.fromEntries(
                      Object.entries(
                        state.questionStates[questionId]?.variants || {},
                      ).filter(([key]) => key !== variantId.toString()),
                    ),
                  }
                : {}),
            },
          },
        })),
      // In useQuestionStore
      toggleLoading: (questionId, value, variantId) =>
        set((state) => {
          if (variantId !== undefined) {
            // Set loading state for a specific variant
            return {
              questionStates: {
                ...state.questionStates,
                [questionId]: {
                  ...state.questionStates[questionId],
                  variants: {
                    ...state.questionStates[questionId]?.variants,
                    [variantId]: {
                      ...state.questionStates[questionId]?.variants?.[
                        variantId
                      ],
                      isloading: value,
                    },
                  },
                },
              },
            };
          } else {
            // Set loading state for the question and all its variants
            const questionState = {
              ...state.questionStates[questionId],
              isloading: value,
            };

            if (questionState.variants) {
              questionState.variants = Object.fromEntries(
                Object.entries(questionState.variants).map(([vid, vstate]) => [
                  vid,
                  {
                    ...vstate,
                    isloading: value,
                  },
                ]),
              );
            }

            return {
              questionStates: {
                ...state.questionStates,
                [questionId]: questionState,
              },
            };
          }
        }),

      setToggleTitle: (questionId, value, variantId) =>
        set((state) => ({
          questionStates: {
            ...state.questionStates,
            [questionId]: {
              ...state.questionStates[questionId],
              ...(variantId
                ? {
                    variants: {
                      ...state.questionStates[questionId]?.variants,
                      [variantId]: {
                        ...state.questionStates[questionId]?.variants?.[
                          variantId
                        ],
                        toggleTitle: value,
                      },
                    },
                  }
                : {
                    toggleTitle: value,
                  }),
            },
          },
        })),

      setShowCriteriaHeader: (value) =>
        set((state) => ({
          questionStates: {
            ...state.questionStates,
            showCriteriaHeader: value,
          },
        })),
      setCriteriaMode: (questionId, mode) =>
        set((state) => ({
          questionStates: {
            ...state.questionStates,
            [questionId]: {
              ...state.questionStates[questionId],
              criteriaMode: mode,
            },
          },
        })),
    }),
    {
      name: "QuestionStore", // Optional: Name your store for easier identification in DevTools
    },
  ),
);

export const useAuthorStore = createWithEqualityFn<
  AuthorState & AuthorActions
>()(
  persist(
    devtools(
      withUpdatedAt((set, get) => ({
        learningObjectives: "",
        setLearningObjectives: (learningObjectives) =>
          set({ learningObjectives }),
        errors: {},
        handleUpdateAllVariantsCriteria: (questionId, criteria) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId && q.variants) {
                return {
                  ...q,
                  variants: q.variants.map((variant) => ({
                    ...variant,
                    scoring: {
                      ...variant.scoring,
                      criteria,
                    },
                  })),
                };
              }
              return q;
            }),
          }));
        },
        focusedQuestionId: undefined,
        setFocusedQuestionId: (id: number) => set({ focusedQuestionId: id }),
        activeAssignmentId: undefined,
        setActiveAssignmentId: (id) => set({ activeAssignmentId: id }),
        name: "",
        setName: (title) => set({ name: title }),
        introduction: "",
        setIntroduction: (introduction) => set({ introduction }),
        instructions: "",
        setInstructions: (instructions) => set({ instructions }),
        gradingCriteriaOverview: "",
        setGradingCriteriaOverview: (gradingCriteriaOverview) =>
          set({ gradingCriteriaOverview }),
        questions: [],
        setQuestions: (questions) => set({ questions }),
        addQuestion: (question) =>
          set((state) => ({ questions: [...state.questions, question] })),
        removeQuestion: (questionId) =>
          set((state) => {
            const index = state.questions.findIndex((q) => q.id === questionId);
            if (index === -1) return {}; // No changes
            const updatedQuestions = state.questions.filter(
              (q) => q.id !== questionId,
            );
            useQuestionStore.getState().clearQuestionState(questionId);
            return { questions: updatedQuestions };
          }),
        replaceQuestion: (questionId, newQuestion) =>
          set((state) => {
            const index = state.questions.findIndex((q) => q.id === questionId);
            if (index === -1) return {}; // No changes
            const updatedQuestions = [...state.questions];
            updatedQuestions[index] = newQuestion;
            return { questions: updatedQuestions };
          }),
        modifyQuestion: (questionId, modifiedData) =>
          set((state) => {
            const index = state.questions.findIndex((q) => q.id === questionId);
            if (index === -1) return {}; // No changes

            const existingQuestion = state.questions[index];
            const updatedQuestion = {
              ...existingQuestion,
              ...modifiedData,
            };

            if (existingQuestion === updatedQuestion) {
              return {}; // No changes
            }

            const updatedQuestions = [...state.questions];
            updatedQuestions[index] = updatedQuestion;

            return { questions: updatedQuestions };
          }),
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
                      (_, index) => index !== criteriaIndex,
                    ),
                  },
                };
              }
              return q;
            }),
          }));
        },
        setChoices: (questionId, choices, variantId) =>
          set((state) => {
            if (variantId) {
              // Set choices for variant
              return {
                questions: state.questions.map((q) => {
                  if (q.id === questionId) {
                    const updatedVariants = q.variants.map((variant) => {
                      if (variant.id === variantId) {
                        return {
                          ...variant,
                          choices,
                        };
                      }
                      return variant;
                    });
                    return {
                      ...q,
                      variants: updatedVariants,
                    };
                  }
                  return q;
                }),
              };
            } else {
              // Set choices for main question
              return {
                questions: state.questions.map((q) => {
                  if (q.id === questionId) {
                    return {
                      ...q,
                      choices,
                    };
                  }
                  return q;
                }),
              };
            }
          }),
        // Add or update a question's choice to be either "True" or "False"
        addTrueFalseChoice: (questionId, isTrue) => {
          return set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId && q.choices) {
                // Only update the choice and isCorrect, keep the points unchanged
                const updatedChoices = q.choices?.map((choice) => ({
                  ...choice,
                  choice: isTrue ? "true" : "false", // Toggle between True and False
                  isCorrect: true,
                }));

                return {
                  ...q,
                  choices: updatedChoices,
                };
              } else if (q.id === questionId && !q.choices) {
                return {
                  ...q,
                  choices: [
                    {
                      choice: isTrue ? "true" : "false",
                      isCorrect: true,
                      points: 0,
                    },
                  ],
                };
              }
              return q;
            }),
          }));
        },

        getTrueFalsePoints: (questionId) => {
          const question = get().questions.find((q) => q.id === questionId);
          if (!question || !question.choices) return 0; // If no question or no choices exist, return 0
          return question.choices[0]?.points || 0; // Return the points for the first choice
        },

        updatePointsTrueFalse: (questionId, points) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                // If the question already has a choice array, update it, otherwise create new
                const updatedChoices = q.choices?.map((choice) => ({
                  ...choice,
                  points,
                }));

                return {
                  ...q,
                  choices: updatedChoices,
                };
              }
              return q;
            }),
          }));
        },
        // Function to retrieve whether the question has only "True" or "False" choices
        isItTrueOrFalse: (questionId) => {
          const question = get().questions.find((q) => q.id === questionId);
          if (!question || !question.choices) return null; // If no question or no choices exist, return null

          return question.choices.find(
            (choice) => choice?.choice.toLowerCase() === "true",
          )
            ? true
            : false;
        },
        addChoice: (questionId, choice, variantId) =>
          set((state) => {
            if (variantId) {
              // Update variant choices
              return {
                questions: state.questions.map((q) => {
                  if (q.id === questionId) {
                    const updatedVariants = q.variants.map((variant) => {
                      if (variant.id === variantId) {
                        return {
                          ...variant,
                          choices: [
                            ...(Array.isArray(variant.choices)
                              ? variant.choices
                              : []),
                            {
                              choice: "",
                              isCorrect: false,
                              points:
                                variant.type === "MULTIPLE_CORRECT" ? -1 : 0,
                            },
                          ],
                        };
                      }
                      return variant;
                    });
                    return {
                      ...q,
                      variants: updatedVariants,
                    };
                  }
                  return q;
                }),
              };
            } else {
              // Update main question choices
              return {
                questions: state.questions.map((q) => {
                  if (q.id === questionId) {
                    return {
                      ...q,
                      choices: [
                        ...(q.choices || []),
                        {
                          choice: "",
                          isCorrect: false,
                          points: q.type === "MULTIPLE_CORRECT" ? -1 : 0,
                        },
                      ],
                    };
                  }
                  return q;
                }),
              };
            }
          }),
        removeChoice: (questionId, choiceIndex, variantId) =>
          set((state) => {
            if (variantId) {
              // Remove choice from variant
              return {
                questions: state.questions.map((q) => {
                  if (q.id === questionId) {
                    const updatedVariants = q.variants.map((variant) => {
                      if (variant.id === variantId) {
                        const updatedChoices = Array.isArray(variant.choices)
                          ? variant.choices.filter(
                              (_, index) => index !== choiceIndex,
                            )
                          : [];
                        return {
                          ...variant,
                          choices: updatedChoices,
                        };
                      }
                      return variant;
                    });
                    return {
                      ...q,
                      variants: updatedVariants,
                    };
                  }
                  return q;
                }),
              };
            } else {
              // Remove choice from main question
              return {
                questions: state.questions.map((q) => {
                  if (q.id === questionId) {
                    const updatedChoices = q.choices.filter(
                      (_, index) => index !== choiceIndex,
                    );
                    return {
                      ...q,
                      choices: updatedChoices,
                    };
                  }
                  return q;
                }),
              };
            }
          }),
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
        modifyChoice: (questionId, choiceIndex, modifiedData, variantId) =>
          set((state) => {
            if (variantId) {
              // Modify choice in variant
              return {
                questions: state.questions.map((q) => {
                  if (q.id === questionId) {
                    const updatedVariants = q.variants.map((variant) => {
                      if (variant.id === variantId) {
                        const updatedChoices = Array.isArray(variant.choices)
                          ? variant.choices.map((choice, index) =>
                              index === choiceIndex
                                ? { ...choice, ...modifiedData }
                                : choice,
                            )
                          : variant.choices;
                        return {
                          ...variant,
                          choices: updatedChoices,
                        };
                      }
                      return variant;
                    });
                    return {
                      ...q,
                      variants: updatedVariants,
                    };
                  }
                  return q;
                }),
              };
            } else {
              // Modify choice in main question
              return {
                questions: state.questions.map((q) => {
                  if (q.id === questionId) {
                    const updatedChoices = q.choices.map((choice, index) =>
                      index === choiceIndex
                        ? { ...choice, ...modifiedData }
                        : choice,
                    );
                    return {
                      ...q,
                      choices: updatedChoices,
                    };
                  }
                  return q;
                }),
              };
            }
          }),
        modifyChoiceFeedback: (questionId, choiceIndex, feedback) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                const choices = q.choices.map((choice, index) => {
                  if (index === choiceIndex) {
                    return {
                      ...choice,
                      feedback,
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
        questionOrder: [],
        setQuestionTitle: (questionTitle, questionId) => {
          set((state) => ({
            questions: state.questions.map((q) =>
              q.id === questionId
                ? {
                    ...q,
                    question: questionTitle,
                  }
                : q,
            ),
          }));
        },
        setQuestionVariantTitle: (
          questionVariantTitle,
          questionId,
          variantId,
        ) => {
          set((state) => {
            const updatedQuestions = state.questions.map((q) => {
              if (q.id === questionId) {
                const updatedVariants = q.variants.map((variant) => {
                  if (variant.id === variantId) {
                    return {
                      ...variant,
                      variantContent: questionVariantTitle,
                    };
                  }
                  return variant;
                });

                return {
                  ...q,
                  variants: updatedVariants,
                };
              }
              return q;
            });
            return { questions: updatedQuestions };
          });
        },

        addVariant: (questionId, newVariant) =>
          set((state) => {
            const questionIndex = state.questions.findIndex(
              (q) => q.id === questionId,
            );
            if (questionIndex === -1) return {};

            const updatedQuestions = [...state.questions];
            const question = { ...updatedQuestions[questionIndex] };
            question.variants = [
              ...(question.variants || []),
              { ...newVariant },
            ]; // Deep copy the variant array
            updatedQuestions[questionIndex] = question;

            return { questions: updatedQuestions };
          }),

        editVariant: (questionId, variantId, updatedData) =>
          set((state) => {
            const questionIndex = state.questions.findIndex(
              (q) => q.id === questionId,
            );
            if (questionIndex === -1) {
              console.warn(`Question with ID ${questionId} not found.`);
              return state;
            }
            const updatedQuestions = [...state.questions];
            const question = { ...updatedQuestions[questionIndex] };

            const updatedVariants = question.variants.map((variant) =>
              variant.id === variantId
                ? { ...variant, ...updatedData }
                : { ...variant },
            );
            question.variants = updatedVariants;
            updatedQuestions[questionIndex] = question;
            return { questions: updatedQuestions };
          }),

        deleteVariant: (questionId, variantId) =>
          set((state) => {
            const questionIndex = state.questions.findIndex(
              (q) => q.id === questionId,
            );
            if (questionIndex === -1) return {}; // No changes if question not found

            const updatedQuestions = [...state.questions];
            const question = { ...updatedQuestions[questionIndex] };
            question.variants = question.variants.filter(
              (variant) => variant.id !== variantId,
            );
            updatedQuestions[questionIndex] = question;
            // delete from questionStates
            useQuestionStore
              .getState()
              .clearQuestionState(questionId, variantId);

            return { questions: updatedQuestions };
          }),

        setQuestionOrder: (order) => {
          set((state) => ({
            ...state,
            questionOrder: order,
          }));
        },
        pageState: "loading" as const,
        setPageState: (pageState) => set({ pageState }),
        updatedAt: undefined,
        setUpdatedAt: (updatedAt) => set({ updatedAt }),
        setAuthorStore: (state) => {
          const currentState = get();
          set((prev) => ({
            ...prev,
            ...state,
            questions: currentState.questions.length
              ? currentState.questions
              : state.questions || [],
          }));
        },
        deleteStore: () =>
          set({
            activeAssignmentId: undefined,
            name: "",
            introduction: "",
            instructions: "",
            gradingCriteriaOverview: "",
            questions: [],
            questionOrder: [],
            pageState: "loading",
            updatedAt: undefined,
            focusedQuestionId: undefined,
            errors: {},
          }),
        validate: () => {
          const state = get();
          const errors: Record<string, string> = {};
          if (
            !state.introduction ||
            state.introduction.trim() === "<p><br></p>"
          ) {
            errors.introduction = "Introduction is required.";
          }
          set({ errors });
          return Object.keys(errors).length === 0;
        },
      })),
      {
        name: "author",
        enabled: process.env.NODE_ENV === "development",
      },
    ),
    {
      name: getAuthorStoreName(),
      storage: createJSONStorage(() => localStorage),
      partialize(state) {
        return Object.fromEntries(
          Object.entries(state).filter(
            ([_, value]) => typeof value !== "function",
          ),
        );
      },
      onRehydrateStorage: (state) => (storedState) => {
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        if (storedState?.updatedAt && storedState.updatedAt < oneWeekAgo) {
          state?.deleteStore(); // Clear outdated data
        }
      },
    },
  ),
  shallow,
);
function getAuthorStoreName() {
  if (typeof window !== "undefined") {
    return `assignment-${extractAssignmentId(window.location.pathname)}-author`;
  }
  return "assignment-feedback-author";
}
