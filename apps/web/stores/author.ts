"use client";

/* eslint-disable */

import {
  AuthorAssignmentState,
  AuthorFileUploads,
  Choice,
  Criteria,
  QuestionAuthorStore,
  QuestionVariants,
  RubricType,
  Scoring,
} from "@/config/types";
import { extractAssignmentId } from "@/lib/strings";
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
  fileUploaded: AuthorFileUploads[];
  pageState: "loading" | "success" | "error";
  updatedAt: number | undefined;
  focusedQuestionId?: number | undefined;
  originalAssignment: AuthorAssignmentState;
  role?: string;
};

export type OptionalQuestion = {
  [K in keyof QuestionAuthorStore]?: QuestionAuthorStore[K];
};

export type AuthorActions = {
  setOriginalAssignment: (assignment: any) => void;
  setLearningObjectives: (learningObjectives: string) => void;
  setFilesUploaded: (filesUploaded: AuthorFileUploads[]) => void;
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
  addOneRubric: (questionId: number, variantId?: number) => void;
  removeRubric: (
    questionId: number,
    rubricIndex: number,
    variantId?: number,
  ) => void;
  setRubricCriteriaDescription: (
    questionId: number,
    variantId: number,
    rubricIndex: number,
    criteriaIndex: number,
    value: string,
  ) => void;
  setQuestionScoring: (
    questionId: number,
    scoring: Scoring,
    variantId?: number,
  ) => void;
  setRubricQuestionText: (
    questionId: number,
    variantId: number,
    rubricIndex: number,
    value: string,
  ) => void;
  setCriterias: (
    questionId: number,
    rubricIndex: number,
    criterias: Criteria[],
  ) => Criteria[];
  addCriteria: (
    questionId: number,
    rubricIndex: number,
    criteria: Criteria,
  ) => void;
  removeCriteria: (
    questionId: number,
    rubricIndex: number,
    criteriaIndex: number,
  ) => void;
  addTrueFalseChoice: (
    questionId: number,
    isTrueOrFalse: boolean,
    variantId?: number,
  ) => void;
  getTrueFalsePoints: (questionId: number) => number;
  updatePointsTrueFalse: (questionId: number, points: number) => void;
  isItTrueOrFalse: (questionId: number, variantId?: number) => boolean | null;
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
  updateQuestionTitle: (
    questionId: number,
    title: string,
    variantId?: number,
  ) => void;
  deleteVariant: (questionId: number, variantId: number) => void;
  setQuestionOrder: (order: number[]) => void;
  setAuthorStore: (state: Partial<AuthorState>) => void;
  validate: () => boolean;
  deleteStore: () => void;
  setRole: (role: string) => void;
  toggleRandomizedChoicesMode: (
    questionId: number,
    variantId?: number,
  ) => boolean;
  setEvaluateBodyLanguage: (
    questionId: number,
    bodyLanguageBool: boolean,
  ) => void;
  setRealTimeAiCoach: (
    questionId: number,
    realTimeAiCoachBool: boolean,
  ) => void;
  setEvaluateTimeManagement: (
    questionId: number,
    timeManagementBool: boolean,
    responseType: string,
  ) => void;
  setTargetTime: (
    questionId: number,
    time: number,
    responseType: string,
  ) => void;
  setEvaluateSlidesQuality: (
    questionId: number,
    slidesQualityBool: boolean,
  ) => void;
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
      selectedRubric?: RubricType;
      variants?: {
        [variantId: number]: {
          toggleTitle?: boolean;
          isloading?: boolean;
          selectedRubric?: RubricType;
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
  setSelectedRubric: (
    questionId: number,
    value: RubricType,
    variantId?: number,
  ) => void;
  getSelectedRubric: (
    questionId: number,
    variantId?: number,
  ) => RubricType | undefined;
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

      setSelectedRubric: (questionId, value, variantId) => {
        if (variantId !== undefined) {
          set((state) => ({
            questionStates: {
              ...state.questionStates,
              [questionId]: {
                ...state.questionStates[questionId],
                variants: {
                  ...state.questionStates[questionId]?.variants,
                  [variantId]: {
                    ...state.questionStates[questionId]?.variants?.[variantId],
                    selectedRubric: value,
                  },
                },
              },
            },
          }));
        } else {
          set((state) => ({
            questionStates: {
              ...state.questionStates,
              [questionId]: {
                ...state.questionStates[questionId],
                selectedRubric: value,
              },
            },
          }));
        }
      },
      getSelectedRubric: (questionId, variantId) => {
        const state = get();
        if (variantId) {
          return state.questionStates[questionId]?.variants?.[variantId]
            ?.selectedRubric;
        }
        return (
          state.questionStates[questionId]?.selectedRubric ??
          RubricType.COMPREHENSIVE
        );
      },
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

      toggleLoading: (questionId, value, variantId) =>
        set((state) => {
          if (variantId !== undefined) {
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
      name: "QuestionStore",
    },
  ),
);

export const useAuthorStore = createWithEqualityFn<
  AuthorState & AuthorActions
>()(
  persist(
    devtools(
      withUpdatedAt((set, get) => ({
        role: undefined,
        setRole: (role) => set({ role }),
        learningObjectives: "",
        originalAssignment: null,
        removeRubric(questionId, rubricIndex, variantId) {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                if (variantId) {
                  const updatedVariants = q.variants.map((variant) => {
                    if (variant.id === variantId) {
                      const rubrics = variant.scoring.rubrics || [];
                      rubrics.splice(rubricIndex, 1);
                      return {
                        ...variant,
                        scoring: { ...variant.scoring, rubrics },
                      };
                    }
                    return variant;
                  });
                  return { ...q, variants: updatedVariants };
                }
                const rubrics = q.scoring.rubrics || [];
                rubrics.splice(rubricIndex, 1);
                return { ...q, scoring: { ...q.scoring, rubrics } };
              }
              return q;
            }),
          }));
        },
        updateQuestionTitle: (questionId, title, variantId) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                if (variantId) {
                  const updatedVariants = q.variants.map((variant) =>
                    variant.id === variantId
                      ? { ...variant, variantContent: title }
                      : variant,
                  );
                  return { ...q, variants: updatedVariants };
                }
                return { ...q, question: title };
              }
              return q;
            }),
          }));
        },
        addOneRubric: (questionId, variantId) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                const newRubric = {
                  rubricQuestion: "",
                  criteria: [
                    { id: 1, description: "", points: 1 },
                    { id: 2, description: "", points: 0 },
                  ],
                };

                if (variantId) {
                  const updatedVariants = q.variants.map((variant) =>
                    variant.id === variantId
                      ? {
                          ...variant,
                          scoring: {
                            ...variant.scoring,
                            rubrics:
                              variant.scoring && variant.scoring.rubrics
                                ? [...variant.scoring.rubrics, newRubric]
                                : [newRubric],
                          },
                        }
                      : variant,
                  );
                  return { ...q, variants: updatedVariants };
                } else {
                  const rubrics =
                    q.scoring && q.scoring.rubrics
                      ? [...q.scoring.rubrics]
                      : [];
                  rubrics.push(newRubric);
                  return { ...q, scoring: { ...q.scoring, rubrics } };
                }
              }
              return q;
            }),
          }));
        },

        setRubricCriteriaDescription: (
          questionId,
          variantId,
          rubricIndex,
          criteriaIndex,
          value,
        ) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                if (variantId) {
                  const updatedVariants = q.variants.map((variant) => {
                    if (variant.id === variantId) {
                      const rubrics =
                        variant.scoring && variant.scoring.rubrics
                          ? variant.scoring.rubrics.map((r) => ({
                              ...r,
                              criteria: r.criteria ? [...r.criteria] : [],
                            }))
                          : [];

                      if (!rubrics[rubricIndex]) {
                        rubrics[rubricIndex] = {
                          rubricQuestion: "",
                          criteria: [],
                        };
                      }
                      if (!rubrics[rubricIndex].criteria[criteriaIndex]) {
                        rubrics[rubricIndex].criteria[criteriaIndex] = {
                          id: criteriaIndex + 1,
                          description: "",
                          points: 0,
                        };
                      }
                      rubrics[rubricIndex].criteria[criteriaIndex].description =
                        value;

                      return {
                        ...variant,
                        scoring: { ...variant.scoring, rubrics },
                      };
                    }
                    return variant;
                  });
                  return { ...q, variants: updatedVariants };
                } else {
                  const rubrics = q.scoring.rubrics
                    ? q.scoring.rubrics.map((rubric) => ({
                        ...rubric,
                        criteria: rubric.criteria ? [...rubric.criteria] : [],
                      }))
                    : [];
                  if (!rubrics[rubricIndex]) {
                    rubrics[rubricIndex] = {
                      rubricQuestion: "",
                      criteria: [],
                    };
                  }
                  if (!rubrics[rubricIndex].criteria[criteriaIndex]) {
                    rubrics[rubricIndex].criteria[criteriaIndex] = {
                      id: criteriaIndex + 1,
                      description: "",
                      points: 0,
                    };
                  }
                  rubrics[rubricIndex].criteria[criteriaIndex].description =
                    value;
                  return { ...q, scoring: { ...q.scoring, rubrics } };
                }
              }
              return q;
            }),
          }));
        },

        setRubricQuestionText: (questionId, variantId, rubricIndex, value) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                if (variantId) {
                  const updatedVariants = q.variants?.map((variant) => {
                    if (variant.id === variantId) {
                      const oldRubrics = variant.scoring?.rubrics
                        ? [...variant.scoring.rubrics]
                        : [];
                      const rubric = oldRubrics[rubricIndex]
                        ? { ...oldRubrics[rubricIndex] }
                        : { rubricQuestion: "", criteria: [] };
                      rubric.rubricQuestion = value;
                      oldRubrics[rubricIndex] = rubric;
                      return {
                        ...variant,
                        scoring: {
                          ...variant.scoring,
                          rubrics: oldRubrics,
                        },
                      };
                    }
                    return variant;
                  });
                  return { ...q, variants: updatedVariants };
                } else {
                  const oldRubrics = q.scoring?.rubrics
                    ? [...q.scoring.rubrics]
                    : [];
                  const rubric = oldRubrics[rubricIndex]
                    ? { ...oldRubrics[rubricIndex] }
                    : { rubricQuestion: "", criteria: [] };
                  rubric.rubricQuestion = value;
                  oldRubrics[rubricIndex] = rubric;
                  return {
                    ...q,
                    scoring: {
                      ...q.scoring,
                      rubrics: oldRubrics,
                    },
                  };
                }
              }
              return q;
            }),
          }));
        },
        setOriginalAssignment: (assignment: AuthorAssignmentState) =>
          set({ originalAssignment: assignment }),
        fileUploaded: [],
        setFilesUploaded: (filesUploaded) =>
          set({ fileUploaded: filesUploaded }),
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
        setEvaluateBodyLanguage: (questionId, bodyLanguageBool) => {
          set((state) => {
            const updatedQuestions = state.questions.map((q) => {
              if (q.id === questionId) {
                return {
                  ...q,
                  liveRecordingConfig: {
                    ...q.liveRecordingConfig,
                    evaluateBodyLanguage: bodyLanguageBool,
                  },
                };
              } else {
                return q;
              }
            });
            return { questions: updatedQuestions };
          });
        },
        setRealTimeAiCoach: (questionId, realTimeAiCoachBool) => {
          set((state) => {
            const updatedQuestions = state.questions.map((q) => {
              if (q.id === questionId) {
                return {
                  ...q,
                  liveRecordingConfig: {
                    ...q.liveRecordingConfig,
                    realTimeAiCoach: realTimeAiCoachBool,
                  },
                };
              } else {
                return q;
              }
            });
            return { questions: updatedQuestions };
          });
        },
        setEvaluateTimeManagement: (
          questionId,
          timeManagementBool,
          responseType,
        ) => {
          set((state) => {
            const updatedQuestions = state.questions.map((q) => {
              if (q.id === questionId) {
                if (responseType === "PRESENTATION") {
                  return {
                    ...q,
                    videoPresentationConfig: {
                      ...q.videoPresentationConfig,
                      evaluateTimeManagement: timeManagementBool,
                    },
                  };
                } else if (responseType === "LIVE_RECORDING") {
                  return {
                    ...q,
                    liveRecordingConfig: {
                      ...q.liveRecordingConfig,
                      evaluateTimeManagement: timeManagementBool,
                    },
                  };
                }
              } else {
                return q;
              }
            });
            return { questions: updatedQuestions };
          });
        },
        setTargetTime: (questionId, time, responseType) => {
          set((state) => {
            const updatedQuestions = state.questions.map((q) => {
              if (q.id === questionId) {
                if (responseType === "PRESENTATION") {
                  return {
                    ...q,
                    videoPresentationConfig: {
                      ...q.videoPresentationConfig,
                      targetTime: time,
                    },
                  };
                } else if (responseType === "LIVE_RECORDING") {
                  return {
                    ...q,
                    liveRecordingConfig: {
                      ...q.liveRecordingConfig,
                      targetTime: time,
                    },
                  };
                }
              } else {
                return q;
              }
            });
            return { questions: updatedQuestions };
          });
        },
        setEvaluateSlidesQuality: (questionId, slidesQualityBool) => {
          set((state) => {
            const updatedQuestions = state.questions.map((q) => {
              if (q.id === questionId) {
                return {
                  ...q,
                  videoPresentationConfig: {
                    ...q.videoPresentationConfig,
                    evaluateSlidesQuality: slidesQualityBool,
                  },
                };
              } else {
                return q;
              }
            });
            return { questions: updatedQuestions };
          });
        },
        addQuestion: (question) => {
          set((state) => {
            const updatedQuestions = [...state.questions];
            updatedQuestions.push({ ...question });

            return {
              questions: updatedQuestions,
              updatedAt: Date.now(),
            };
          });
        },
        removeQuestion: (questionId) =>
          set((state) => {
            const index = state.questions.findIndex((q) => q.id === questionId);
            if (index === -1) return {};
            const updatedQuestions = state.questions.filter(
              (q) => q.id !== questionId,
            );
            useQuestionStore.getState().clearQuestionState(questionId);
            return { questions: updatedQuestions };
          }),
        replaceQuestion: (questionId, newQuestion) =>
          set((state) => {
            const index = state.questions.findIndex((q) => q.id === questionId);
            if (index === -1) return {};
            const updatedQuestions = [...state.questions];
            updatedQuestions[index] = newQuestion;
            return { questions: updatedQuestions };
          }),
        modifyQuestion: (questionId, modifiedData) => {
          set((state) => {
            const index = state.questions.findIndex((q) => q.id === questionId);
            if (index === -1) {
              return {};
            }

            const existingQuestion = state.questions[index];

            const updatedQuestion = {
              ...existingQuestion,
              ...modifiedData,
            };

            if (modifiedData.scoring) {
              updatedQuestion.scoring = {
                ...(existingQuestion.scoring || {}),
                ...modifiedData.scoring,
              };
            }

            if (modifiedData.choices) {
              updatedQuestion.choices = [...modifiedData.choices];
            }

            const updatedQuestions = [...state.questions];
            updatedQuestions[index] = updatedQuestion;

            return {
              questions: updatedQuestions,
              updatedAt: Date.now(),
            };
          });

          const newState = useAuthorStore.getState();
          const updatedQuestion = newState.questions.find(
            (q) => q.id === questionId,
          );
        },
        setCriterias: (questionId, rubricIndex, criterias) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                const rubrics = q.scoring.rubrics ? [...q.scoring.rubrics] : [];
                if (!rubrics[rubricIndex]) {
                  rubrics[rubricIndex] = { rubricQuestion: "", criteria: [] };
                }
                rubrics[rubricIndex].criteria = criterias;
                return {
                  ...q,
                  rubrics,
                };
              }
              return q;
            }),
          }));
          return criterias;
        },

        addCriteria: (questionId, rubricIndex, criteria) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                const rubrics = q.scoring.rubrics ? [...q.scoring.rubrics] : [];
                if (!rubrics[rubricIndex]) {
                  rubrics[rubricIndex] = { rubricQuestion: "", criteria: [] };
                }
                rubrics[rubricIndex].criteria = [
                  ...rubrics[rubricIndex].criteria,
                  criteria,
                ];
                return {
                  ...q,
                  rubrics,
                };
              }
              return q;
            }),
          }));
        },
        removeCriteria: (questionId, rubricIndex, criteriaIndex) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId && q.scoring.rubrics) {
                const updatedRubrics = q.scoring.rubrics.map(
                  (rubric, index) => {
                    if (index === rubricIndex) {
                      return {
                        ...rubric,
                        criteria: rubric.criteria.filter(
                          (_, idx) => idx !== criteriaIndex,
                        ),
                      };
                    }
                    return rubric;
                  },
                );
                return {
                  ...q,
                  rubrics: updatedRubrics,
                };
              }
              return q;
            }),
          }));
        },
        setQuestionScoring: (
          questionId: number,
          scoring: Scoring,
          variantId?: number,
        ) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                if (variantId) {
                  const updatedVariants = q.variants.map((variant) => {
                    if (variant.id === variantId) {
                      return { ...variant, scoring };
                    }
                    return variant;
                  });
                  return { ...q, variants: updatedVariants };
                }
                return { ...q, scoring };
              }
              return q;
            }),
          }));
        },

        setChoices: (questionId, choices, variantId) => {
          set((state) => {
            const deepCopiedChoices = choices.map((choice) => ({ ...choice }));

            if (variantId) {
              return {
                questions: state.questions.map((q) => {
                  if (q.id === questionId) {
                    const updatedVariants = q.variants.map((variant) => {
                      if (variant.id === variantId) {
                        return {
                          ...variant,
                          choices: deepCopiedChoices,
                        };
                      }
                      return { ...variant };
                    });
                    return {
                      ...q,
                      variants: updatedVariants,
                      updatedAt: Date.now(),
                    };
                  }
                  return { ...q };
                }),
                updatedAt: Date.now(),
              };
            } else {
              return {
                questions: state.questions.map((q) => {
                  if (q.id === questionId) {
                    return {
                      ...q,
                      choices: deepCopiedChoices,
                      updatedAt: Date.now(),
                    };
                  }
                  return { ...q };
                }),
                updatedAt: Date.now(),
              };
            }
          });

          const newState = useAuthorStore.getState();
          const updatedQuestion = newState.questions.find(
            (q) => q.id === questionId,
          );
        },
        toggleRandomizedChoicesMode: (
          questionId: number,
          variantId: number,
        ) => {
          set((state) => {
            if (variantId) {
              return {
                questions: state.questions.map((q) => {
                  if (q.id === questionId) {
                    const updatedVariants = q.variants.map((variant) => {
                      if (variant.id === variantId) {
                        return {
                          ...variant,
                          randomizedChoices: !variant.randomizedChoices,
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
              return {
                questions: state.questions.map((q) => {
                  if (q.id === questionId) {
                    return {
                      ...q,
                      randomizedChoices: !q.randomizedChoices,
                    };
                  }
                  return q;
                }),
              };
            }
          });
          if (variantId) {
            return (
              get()
                .questions.find((q) => q.id === questionId)
                ?.variants?.find((v) => v.id === variantId)
                ?.randomizedChoices || false
            );
          }
          return (
            get().questions.find((q) => q.id === questionId)
              ?.randomizedChoices || false
          );
        },
        addTrueFalseChoice: (questionId, isTrue, variantId) => {
          return set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                if (variantId) {
                  const updatedVariants = q.variants.map((variant) => {
                    if (variant.id === variantId) {
                      return {
                        ...variant,
                        choices: Array.isArray(variant.choices)
                          ? variant.choices.map((choice) => ({
                              ...choice,
                              choice:
                                choice.choice === "true" ? "false" : "true",
                              isCorrect: choice.choice !== "true",
                            }))
                          : [
                              {
                                choice: isTrue ? "true" : "false",
                                isCorrect: true,
                                points: 1,
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
                } else {
                  const updatedChoices = Array.isArray(q.choices)
                    ? q.choices.map((choice) => ({
                        ...choice,
                        choice: choice.choice === "true" ? "false" : "true",
                        isCorrect: choice.choice !== "true",
                      }))
                    : [
                        {
                          choice: isTrue ? "true" : "false",
                          isCorrect: true,
                          points: 1,
                        },
                      ];

                  return {
                    ...q,
                    choices: updatedChoices,
                  };
                }
              }
              return q;
            }),
          }));
        },
        getTrueFalsePoints: (questionId) => {
          const question = get().questions.find((q) => q.id === questionId);
          if (!question || !question.choices) return 1;
          return question.choices[0]?.points || 1;
        },

        updatePointsTrueFalse: (questionId, points) => {
          set((state) => ({
            questions: state.questions.map((q) => {
              if (q.id === questionId) {
                if (q.choices) {
                  const updatedChoices = q.choices.map((choice) => ({
                    ...choice,
                    points,
                  }));
                  return {
                    ...q,
                    choices: updatedChoices,
                  };
                } else {
                  return {
                    ...q,
                    choices: [
                      {
                        choice: undefined,
                        isCorrect: undefined,
                        points,
                      },
                    ],
                  };
                }
              }
              return q;
            }),
          }));
        },

        isItTrueOrFalse: (questionId, variantId) => {
          const question = get().questions.find((q) => q.id === questionId);
          if (!question || !question.choices) return null;
          if (variantId) {
            const variant = question.variants?.find((v) => v.id === variantId);
            if (!variant || !variant.choices) return null;
            return (
              Array.isArray(variant.choices) &&
              variant.choices.every((choice) => {
                return choice.choice.toLowerCase() === "true";
              })
            );
          } else {
            return (
              Array.isArray(question.choices) &&
              question.choices.every((choice) => {
                return choice.choice.toLowerCase() === "true";
              })
            );
          }
        },
        addChoice: (questionId, choice, variantId) =>
          set((state) => {
            if (variantId) {
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

        addVariant: (questionId, newVariant) => {
          set((state) => {
            const questionIndex = state.questions.findIndex(
              (q) => q.id === questionId,
            );
            if (questionIndex === -1) {
              return {};
            }

            const updatedQuestions = [...state.questions];
            const question = { ...updatedQuestions[questionIndex] };

            const deepCopiedVariant = {
              ...newVariant,
              choices: Array.isArray(newVariant.choices)
                ? [...newVariant.choices.map((c) => ({ ...c }))]
                : undefined,
              scoring: newVariant.scoring
                ? {
                    ...newVariant.scoring,
                    rubrics: newVariant.scoring.rubrics
                      ? [
                          ...newVariant.scoring.rubrics.map((r) => ({
                            ...r,
                            criteria: r.criteria
                              ? [...r.criteria.map((c) => ({ ...c }))]
                              : [],
                          })),
                        ]
                      : [],
                  }
                : undefined,
            };

            question.variants = [
              ...(question.variants || []),
              deepCopiedVariant,
            ];

            updatedQuestions[questionIndex] = question;

            return {
              questions: updatedQuestions,
              updatedAt: Date.now(),
            };
          });

          const newState = useAuthorStore.getState();
          const updatedQuestion = newState.questions.find(
            (q) => q.id === questionId,
          );
        },

        editVariant: (questionId, variantId, updatedData) =>
          set((state) => {
            const questionIndex = state.questions.findIndex(
              (q) => q.id === questionId,
            );
            if (questionIndex === -1) {
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

        deleteVariant: (questionId, variantId) => {
          set((state) => {
            const questionIndex = state.questions.findIndex(
              (q) => q.id === questionId,
            );
            if (questionIndex === -1) {
              return {};
            }

            const updatedQuestions = [...state.questions];
            const question = { ...updatedQuestions[questionIndex] };

            question.variants = question.variants.filter(
              (v) => v.id !== variantId,
            );

            updatedQuestions[questionIndex] = question;

            useQuestionStore
              .getState()
              .clearQuestionState(questionId, variantId);

            return {
              questions: updatedQuestions,
              updatedAt: Date.now(),
            };
          });

          const newState = useAuthorStore.getState();
          const updatedQuestion = newState.questions.find(
            (q) => q.id === questionId,
          );
        },

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
        trace: true,
        traceLimit: 25,
      },
    ),
    {
      name: getAuthorStoreName(),
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? localStorage
          : {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            },
      ),
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
          state?.deleteStore();
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
  return "assignment-1-author";
}
