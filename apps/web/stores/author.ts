"use client";

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
import { DraftSummary, VersionSummary } from "@/lib/author";
const NON_PERSIST_KEYS = new Set<keyof AuthorState | keyof AuthorActions>([
  "versions",
  "currentVersion",
  "selectedVersion",
  "versionComparison",
  "isLoadingVersions",
  "versionsLoadFailed",
  "hasAttemptedLoadVersions",
  "lastAutoSave",
  "hasUnsavedChanges",

  "drafts",
  "isLoadingDrafts",
  "draftsLoadFailed",
  "hasAttemptedLoadDrafts",

  "favoriteVersions",
]);

export interface VersionComparison {
  fromVersion: VersionSummary;
  toVersion: VersionSummary;
  assignmentChanges: Array<{
    field: string;
    fromValue: any;
    toValue: any;
    changeType: "added" | "modified" | "removed";
  }>;
  questionChanges: Array<{
    questionId?: number;
    displayOrder: number;
    changeType: "added" | "modified" | "removed";
    field?: string;
    fromValue?: any;
    toValue?: any;
  }>;
}

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

  versions: VersionSummary[];
  currentVersion?: VersionSummary;
  checkedOutVersion?: VersionSummary;
  selectedVersion?: VersionSummary;
  versionComparison?: VersionComparison;
  isLoadingVersions: boolean;
  versionsLoadFailed: boolean;
  hasAttemptedLoadVersions: boolean;
  lastAutoSave?: Date;
  hasUnsavedChanges: boolean;

  drafts: any[];
  isLoadingDrafts: boolean;
  draftsLoadFailed: boolean;
  hasAttemptedLoadDrafts: boolean;

  favoriteVersions: number[];
};

export type OptionalQuestion = {
  [K in keyof QuestionAuthorStore]?: QuestionAuthorStore[K];
};

export type AuthorActions = {
  parseJsonField: (field: any, fieldName: string, defaultValue?: any) => any;
  updateConfigStores: (versionData: any) => Promise<void>;
  processQuestionVersion: (
    questionVersion: any,
    index: number,
    versionData: any,
    parseJsonField: (field: any, fieldName: string, defaultValue?: any) => any,
    processVariant: (
      variant: any,
      parseJsonField: (
        field: any,
        fieldName: string,
        defaultValue?: any,
      ) => any,
    ) => any,
  ) => any;
  processVariant: (
    variant: any,
    parseJsonField: (field: any, fieldName: string, defaultValue?: any) => any,
  ) => any;
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
  setDataFromBackend: (data: Partial<AuthorAssignmentState>) => void;
  validate: () => boolean;
  deleteStore: () => void;
  setRole: (role: string) => void;
  toggleRandomizedChoicesMode: (
    questionId: number,
    variantId?: number,
  ) => boolean;

  loadVersions: () => Promise<void>;
  createVersion: (
    versionDescription?: string,
    isDraft?: boolean,
    versionNumber?: string,
    updateExisting?: boolean,
    versionId?: number,
  ) => Promise<VersionSummary | undefined>;
  saveDraft: (
    versionDescription?: string,
  ) => Promise<VersionSummary | undefined>;
  restoreVersion: (
    versionId: number,
    createAsNewVersion?: boolean,
  ) => Promise<VersionSummary | undefined>;
  activateVersion: (versionId: number) => Promise<VersionSummary | undefined>;
  compareVersions: (
    fromVersionId: number,
    toVersionId: number,
  ) => Promise<void>;
  getVersionHistory: () => Promise<any[]>;
  setVersions: (versions: VersionSummary[]) => void;
  setCurrentVersion: (version?: VersionSummary) => void;
  setCheckedOutVersion: (version?: VersionSummary) => void;
  checkoutVersion: (
    versionId: number,
    versionNumber?: string | number,
  ) => Promise<boolean>;
  setSelectedVersion: (version?: VersionSummary) => void;
  setVersionComparison: (comparison?: VersionComparison) => void;
  setIsLoadingVersions: (loading: boolean) => void;
  setHasUnsavedChanges: (hasChanges: boolean) => void;
  markAutoSave: () => void;

  setDrafts: (drafts: DraftSummary[]) => void;
  setIsLoadingDrafts: (loading: boolean) => void;
  setDraftsLoadFailed: (failed: boolean) => void;
  setHasAttemptedLoadDrafts: (attempted: boolean) => void;

  toggleFavoriteVersion: (versionId: number) => Promise<void>;
  setFavoriteVersions: (favorites: number[]) => void;
  loadFavoriteVersions: () => Promise<void>;
  updateVersionDescription: (
    versionId: number,
    versionDescription: string,
  ) => Promise<VersionSummary | undefined>;
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

        versions: [],
        currentVersion: undefined,
        checkedOutVersion: undefined,
        selectedVersion: undefined,
        versionComparison: undefined,
        isLoadingVersions: false,
        versionsLoadFailed: false,
        hasAttemptedLoadVersions: false,
        lastAutoSave: undefined,
        hasUnsavedChanges: false,

        drafts: [],
        isLoadingDrafts: false,
        draftsLoadFailed: false,
        hasAttemptedLoadDrafts: false,

        favoriteVersions: [],
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
        setName: (title) => set({ name: title, hasUnsavedChanges: true }),
        introduction: "",
        setIntroduction: (introduction) => {
          set({ introduction, hasUnsavedChanges: true });
        },
        instructions: "",
        setInstructions: (instructions) => {
          set({ instructions, hasUnsavedChanges: true });
        },
        gradingCriteriaOverview: "",
        setGradingCriteriaOverview: (gradingCriteriaOverview) => {
          set({ gradingCriteriaOverview, hasUnsavedChanges: true });
        },
        questions: [],
        setQuestions: (questions) => {
          set({ questions, hasUnsavedChanges: true });
        },
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
            return { questions: updatedQuestions, hasUnsavedChanges: true };
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
            return { questions: updatedQuestions, hasUnsavedChanges: true };
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
            return { questions: updatedQuestions, hasUnsavedChanges: true };
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
            return { questions: updatedQuestions, hasUnsavedChanges: true };
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
            return { questions: updatedQuestions, hasUnsavedChanges: true };
          });
        },
        addQuestion: (question) => {
          set((state) => {
            const updatedQuestions = [...state.questions];
            updatedQuestions.push({ ...question });

            return {
              questions: updatedQuestions,
              updatedAt: Date.now(),
              hasUnsavedChanges: true,
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
            return { questions: updatedQuestions, hasUnsavedChanges: true };
          }),
        replaceQuestion: (questionId, newQuestion) =>
          set((state) => {
            const index = state.questions.findIndex((q) => q.id === questionId);
            if (index === -1) return {};
            const updatedQuestions = [...state.questions];
            updatedQuestions[index] = newQuestion;
            return { questions: updatedQuestions, hasUnsavedChanges: true };
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
              hasUnsavedChanges: true,
            };
          });
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
            return { questions: updatedQuestions, hasUnsavedChanges: true };
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
              hasUnsavedChanges: true,
            };
          });
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
            return { questions: updatedQuestions, hasUnsavedChanges: true };
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
              hasUnsavedChanges: true,
            };
          });
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

        setDataFromBackend: (data: Partial<AuthorAssignmentState>) => {
          set({ ...data, hasUnsavedChanges: true });
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

        loadVersions: async () => {
          const state = get();

          if (!state.activeAssignmentId) {
            return;
          }

          if (state.isLoadingVersions) {
            return;
          }

          set({
            isLoadingVersions: true,
            versionsLoadFailed: false,
            hasAttemptedLoadVersions: true,
          });

          try {
            const { listAssignmentVersions } = await import("@/lib/author");

            const versions = await listAssignmentVersions(
              state.activeAssignmentId,
            );

            const currentVersion = versions.find((v) => v.isActive);
            const currentState = get();

            let checkedOutVersion = currentState.checkedOutVersion;

            if (checkedOutVersion) {
              const existingCheckedOut = versions.find(
                (v) => v.id === checkedOutVersion.id,
              );
              if (existingCheckedOut) {
                checkedOutVersion = existingCheckedOut;
              } else {
                checkedOutVersion = currentVersion;
              }
            } else {
              checkedOutVersion = currentVersion;
            }

            set({
              versions,
              isLoadingVersions: false,
              versionsLoadFailed: false,
              currentVersion,
              checkedOutVersion,
            });
          } catch (error) {
            console.error("💥 Error loading versions in store:", error);
            set({ isLoadingVersions: false, versionsLoadFailed: true });
          }
        },

        parseJsonField: (
          field: any,
          fieldName: string,
          defaultValue: any = null,
        ) => {
          if (!field) return defaultValue;

          try {
            if (
              field === "[object Object]" ||
              (typeof field === "string" &&
                !field.trim().startsWith("{") &&
                !field.trim().startsWith("["))
            ) {
              console.warn(`Invalid JSON format for ${fieldName}:`, field);
              return defaultValue;
            }
            return typeof field === "string" ? JSON.parse(field) : field;
          } catch (error) {
            console.error(`Failed to parse ${fieldName}:`, field, error);
            return defaultValue;
          }
        },

        processVariant: (
          variant: any,
          parseJsonField: (
            field: any,
            fieldName: string,
            defaultValue?: any,
          ) => any,
        ) => ({
          ...variant,
          choices: parseJsonField(variant.choices, "variant choices", []),
          scoring: parseJsonField(variant.scoring, "variant scoring", null),
        }),

        processQuestionVersion: (
          questionVersion: any,
          index: number,
          versionData: any,
          parseJsonField: (
            field: any,
            fieldName: string,
            defaultValue?: any,
          ) => any,
          processVariant: (
            variant: any,
            parseJsonField: (
              field: any,
              fieldName: string,
              defaultValue?: any,
            ) => any,
          ) => any,
        ) => {
          const question = {
            id: questionVersion.questionId,
            type: questionVersion.type,
            responseType: questionVersion.responseType,
            question: questionVersion.question,
            maxWords: questionVersion.maxWords,
            maxCharacters: questionVersion.maxCharacters,
            totalPoints: questionVersion.totalPoints,
            answer: questionVersion.answer,
            choices: parseJsonField(
              questionVersion.choices,
              "question choices",
              [],
            ),
            scoring: parseJsonField(
              questionVersion.scoring,
              "question scoring",
              null,
            ),
            randomizedChoices: questionVersion.randomizedChoices,
            gradingContextQuestionIds:
              questionVersion.gradingContextQuestionIds || [],
            videoPresentationConfig: questionVersion.videoPresentationConfig,
            liveRecordingConfig: questionVersion.liveRecordingConfig,
            displayOrder: questionVersion.displayOrder,
          };

          return {
            ...question,
            alreadyInBackend: true,
            assignmentId: versionData.assignmentId,
            variants: (questionVersion.variants || []).map((variant: any) =>
              processVariant(variant, parseJsonField),
            ),
            scoring: question.scoring || {
              type: "CRITERIA_BASED",
              rubrics: [],
            },
            index: index + 1,
            answer: question.answer ?? false,
            createdAt: questionVersion.createdAt,
            updatedAt: questionVersion.createdAt,
            maxWords: question.maxWords || null,
            maxCharacters: question.maxCharacters || null,
          };
        },

        updateConfigStores: async (versionData: any) => {
          const { useAssignmentConfig } = await import(
            "@/stores/assignmentConfig"
          );
          const { useAssignmentFeedbackConfig } = await import(
            "@/stores/assignmentFeedbackConfig"
          );

          const assignmentConfigState = useAssignmentConfig.getState();
          const feedbackConfigState = useAssignmentFeedbackConfig.getState();

          useAssignmentConfig.getState().setAssignmentConfigStore({
            graded:
              versionData.graded !== undefined
                ? versionData.graded
                : assignmentConfigState.graded,
            numAttempts:
              versionData.numAttempts !== undefined
                ? versionData.numAttempts
                : assignmentConfigState.numAttempts,
            attemptsBeforeCoolDown:
              versionData.attemptsBeforeCoolDown !== undefined
                ? versionData.attemptsBeforeCoolDown
                : assignmentConfigState.attemptsBeforeCoolDown,
            retakeAttemptCoolDownMinutes:
              versionData.retakeAttemptCoolDownMinutes !== undefined
                ? versionData.retakeAttemptCoolDownMinutes
                : assignmentConfigState.retakeAttemptCoolDownMinutes,
            passingGrade:
              versionData.passingGrade !== undefined
                ? versionData.passingGrade
                : assignmentConfigState.passingGrade,
            timeEstimateMinutes:
              versionData.timeEstimateMinutes !== undefined
                ? versionData.timeEstimateMinutes
                : assignmentConfigState.timeEstimateMinutes,
            allotedTimeMinutes:
              versionData.allotedTimeMinutes !== undefined
                ? versionData.allotedTimeMinutes
                : assignmentConfigState.allotedTimeMinutes,
            displayOrder:
              versionData.displayOrder !== undefined
                ? versionData.displayOrder
                : assignmentConfigState.displayOrder,
            questionDisplay:
              versionData.questionDisplay !== undefined
                ? versionData.questionDisplay
                : assignmentConfigState.questionDisplay,
          });

          useAssignmentFeedbackConfig
            .getState()
            .setAssignmentFeedbackConfigStore({
              correctAnswerVisibility:
                versionData.correctAnswerVisibility !== undefined
                  ? versionData.correctAnswerVisibility
                  : feedbackConfigState.correctAnswerVisibility,
              showAssignmentScore:
                versionData.showAssignmentScore !== undefined
                  ? versionData.showAssignmentScore
                  : feedbackConfigState.showAssignmentScore,
              showQuestionScore:
                versionData.showQuestionScore !== undefined
                  ? versionData.showQuestionScore
                  : feedbackConfigState.showQuestionScore,
              showSubmissionFeedback:
                versionData.showSubmissionFeedback !== undefined
                  ? versionData.showSubmissionFeedback
                  : feedbackConfigState.showSubmissionFeedback,
              showQuestions:
                versionData.showQuestions !== undefined
                  ? versionData.showQuestions
                  : feedbackConfigState.showQuestions,
            });
        },

        checkoutVersion: async (
          versionId: number,
          versionNumber?: string | number,
        ) => {
          const state = get();
          if (!state.activeAssignmentId) return false;

          try {
            const versionToCheckout = state.versions.find(
              (v) => v.id === versionId,
            );
            if (!versionToCheckout) {
              console.error("Version not found:", versionId);
              return false;
            }

            const { getAssignmentVersion } = await import("@/lib/author");
            const versionData = await getAssignmentVersion(
              state.activeAssignmentId,
              versionId,
            );

            if (!versionData) return false;

            const rawQuestions = versionData.questionVersions || [];
            const {
              parseJsonField,
              processVariant,
              processQuestionVersion,
              updateConfigStores,
            } = get();

            const questionOrderArray: number[] =
              versionData.questionOrder &&
              Array.isArray(versionData.questionOrder)
                ? (versionData.questionOrder
                    .map((value: unknown) => {
                      if (typeof value === "number" && Number.isFinite(value)) {
                        return value;
                      }

                      if (typeof value === "string") {
                        const parsed = Number.parseInt(value, 10);
                        if (!Number.isNaN(parsed)) {
                          return parsed;
                        }
                      }

                      return null;
                    })
                    .filter(
                      (value: number | null): value is number => value !== null,
                    ) as number[])
                : [];

            const allProcessedQuestions = rawQuestions.map(
              (questionVersion: any, index: number) =>
                processQuestionVersion(
                  questionVersion,
                  index,
                  versionData,
                  parseJsonField,
                  processVariant,
                ),
            );

            let processedQuestions: typeof allProcessedQuestions;
            if (questionOrderArray.length > 0) {
              const orderedQuestions = questionOrderArray
                .map((questionId: number) =>
                  allProcessedQuestions.find((q: any) => q.id === questionId),
                )
                .filter(
                  (q: any): q is (typeof allProcessedQuestions)[0] =>
                    q !== undefined,
                );

              const remainingQuestions = allProcessedQuestions.filter(
                (q: any) => !questionOrderArray.includes(q.id),
              );

              processedQuestions = [...orderedQuestions, ...remainingQuestions];
            } else {
              processedQuestions = allProcessedQuestions;
            }

            processedQuestions = processedQuestions.map(
              (q: any, index: number) => ({
                ...q,
                index: index + 1,
              }),
            );

            const finalQuestionOrder = processedQuestions.map((q: any) => q.id);

            set({
              name: versionData.name,
              introduction: versionData.introduction,
              instructions: versionData.instructions,
              gradingCriteriaOverview: versionData.gradingCriteriaOverview,
              questions: processedQuestions,
              questionOrder: finalQuestionOrder,
              checkedOutVersion: versionToCheckout,
              hasUnsavedChanges: false,
            });

            await updateConfigStores(versionData);

            return true;
          } catch (error) {
            console.error("💥 Error checking out version:", error);
            return false;
          }
        },

        createVersion: async (
          versionDescription?: string,
          isDraft = false,
          versionNumber?: string,
          updateExisting = false,
          versionId?: number,
        ) => {
          const state = get();
          if (!state.activeAssignmentId) {
            console.error("❌ createVersion: No active assignment ID");
            return undefined;
          }

          try {
            let newVersion: VersionSummary | undefined;

            if (isDraft) {
              const { createDraftVersion } = await import("@/lib/author");
              const { encodeFields } = await import("@/app/Helpers/encoder");
              const { processQuestions } = await import(
                "@/app/Helpers/processQuestionsBeforePublish"
              );

              const configStore = await import("@/stores/assignmentConfig");
              const feedbackStore = await import(
                "@/stores/assignmentFeedbackConfig"
              );

              const configData = configStore.useAssignmentConfig.getState();
              const feedbackData =
                feedbackStore.useAssignmentFeedbackConfig.getState();

              const encodedFields = encodeFields({
                introduction: state.introduction,
                instructions: state.instructions,
                gradingCriteriaOverview: state.gradingCriteriaOverview,
              });

              let processedQuestions = null;
              if (state.questions && state.questions.length > 0) {
                const clonedQuestions = JSON.parse(
                  JSON.stringify(state.questions),
                );
                clonedQuestions.forEach((q: any) => {
                  delete q.alreadyInBackend;
                  if (
                    q.type !== "MULTIPLE_CORRECT" &&
                    q.type !== "SINGLE_CORRECT"
                  ) {
                    delete q.randomizedChoices;
                  }
                  if (q.responseType !== "PRESENTATION") {
                    delete q.videoPresentationConfig;
                  }
                  if (q.responseType !== "LIVE_RECORDING") {
                    delete q.liveRecordingConfig;
                  }
                });
                processedQuestions = processQuestions(clonedQuestions);
              }

              newVersion = await createDraftVersion(state.activeAssignmentId, {
                assignmentData: {
                  ...encodedFields,
                  name: state.name,
                  numAttempts: configData.numAttempts,
                  attemptsBeforeCoolDown: configData.attemptsBeforeCoolDown,
                  retakeAttemptCoolDownMinutes:
                    configData.retakeAttemptCoolDownMinutes,
                  passingGrade: configData.passingGrade,
                  displayOrder: configData.displayOrder,
                  graded: configData.graded,
                  questionDisplay: configData.questionDisplay,
                  allotedTimeMinutes: configData.allotedTimeMinutes || null,
                  updatedAt: configData.updatedAt,
                  questionOrder: state.questionOrder,
                  timeEstimateMinutes: configData.timeEstimateMinutes,
                  published: false,
                  showSubmissionFeedback: feedbackData.showSubmissionFeedback,
                  showQuestions: feedbackData.showQuestions,
                  showQuestionScore: feedbackData.showQuestionScore,
                  showAssignmentScore: feedbackData.showAssignmentScore,
                  numberOfQuestionsPerAttempt:
                    configData.numberOfQuestionsPerAttempt,
                },
                questionsData: processedQuestions,
                versionNumber,
                versionDescription,
              });
            } else {
              const { createAssignmentVersion } = await import("@/lib/author");
              newVersion = await createAssignmentVersion(
                state.activeAssignmentId,
                {
                  versionNumber,
                  versionDescription,
                  isDraft,
                  shouldActivate: !isDraft,
                  updateExisting,
                  versionId,
                },
              );
            }

            if (newVersion) {
              if (
                newVersion.wasAutoIncremented &&
                newVersion.originalVersionNumber
              ) {
                const { toast } = await import("sonner");
                toast.success(
                  `Version auto-incremented to ${newVersion.versionNumber}`,
                  {
                    description: `Original version ${newVersion.originalVersionNumber} already existed, so we incremented to avoid conflict.`,
                    duration: 6000,
                  },
                );
              }

              let updatedVersions: VersionSummary[];
              if (updateExisting) {
                updatedVersions = state.versions.map((v) =>
                  v.id === newVersion.id ? newVersion : v,
                );
              } else {
                updatedVersions = [newVersion, ...state.versions];
              }

              set({
                versions: updatedVersions,
                currentVersion: newVersion.isActive
                  ? newVersion
                  : state.currentVersion,
              });

              if (!isDraft) {
                const checkoutSuccess = await get().checkoutVersion(
                  newVersion.id,
                );
                if (!checkoutSuccess) {
                  console.error("Failed to checkout newly created version");
                }
                set({ checkedOutVersion: newVersion });
              }
            }

            return newVersion;
          } catch (error) {
            console.error("Error creating version:", error);
            throw error;
          }
        },

        saveDraft: async (versionDescription?: string) => {
          const state = get();
          if (!state.activeAssignmentId) return undefined;

          try {
            const { saveDraft: saveDraftAPI } = await import("@/lib/author");

            const { useAssignmentConfig } = await import(
              "@/stores/assignmentConfig"
            );
            const { useAssignmentFeedbackConfig } = await import(
              "@/stores/assignmentFeedbackConfig"
            );

            const assignmentConfig = useAssignmentConfig.getState();
            const feedbackConfig = useAssignmentFeedbackConfig.getState();

            const latestVersion =
              state.versions?.length > 0
                ? Math.max(
                    ...state.versions.map(
                      (v) =>
                        Number(String(v.versionNumber).replace(/\D/g, "")) || 0,
                    ),
                  )
                : 0;
            const nextMajorVersion = Math.floor(latestVersion / 100) + 1;
            const rcVersionNumber = `${nextMajorVersion}.0.0-rc1`;

            const draftData = {
              versionNumber: rcVersionNumber,
              versionDescription:
                versionDescription ||
                `Draft saved - ${new Date().toLocaleString()}`,
              assignmentData: {
                name: state.name,
                introduction: state.introduction,
                instructions: state.instructions,
                gradingCriteriaOverview: state.gradingCriteriaOverview,
                updatedAt: state.updatedAt,

                graded: assignmentConfig.graded,
                numAttempts: assignmentConfig.numAttempts,
                attemptsBeforeCoolDown: assignmentConfig.attemptsBeforeCoolDown,
                retakeAttemptCoolDownMinutes:
                  assignmentConfig.retakeAttemptCoolDownMinutes,
                passingGrade: assignmentConfig.passingGrade,
                timeEstimateMinutes: assignmentConfig.timeEstimateMinutes,
                allotedTimeMinutes: assignmentConfig.allotedTimeMinutes,
                displayOrder: assignmentConfig.displayOrder,
                questionDisplay: assignmentConfig.questionDisplay,
                questionOrder: state.questionOrder,
                numberOfQuestionsPerAttempt:
                  assignmentConfig.numberOfQuestionsPerAttempt,

                showAssignmentScore: feedbackConfig.showAssignmentScore,
                showQuestionScore: feedbackConfig.showQuestionScore,
                showSubmissionFeedback: feedbackConfig.showSubmissionFeedback,
                showQuestions: feedbackConfig.showQuestions,

                published: false,
              },
              questionsData: state.questions,
            };

            const newDraft = await saveDraftAPI(
              state.activeAssignmentId,
              draftData,
            );

            if (newDraft) {
              const updatedVersions = [
                {
                  id: newDraft.id,
                  versionNumber: "0.0.0",
                  versionDescription: newDraft.draftName,
                  isDraft: true,
                  isActive: false,
                  createdBy: newDraft.userId,
                  createdAt: newDraft.createdAt,
                  questionCount: newDraft.questionCount,
                  published: newDraft.published,
                  updatedAt: newDraft.updatedAt,
                },
                ...state.versions.filter((v) => v.id !== newDraft.id),
              ];

              set({
                versions: updatedVersions,
                hasUnsavedChanges: false,
                lastAutoSave: new Date(),
              });
            }

            return newDraft;
          } catch (error) {
            console.error("Error saving draft:", error);
            return undefined;
          }
        },

        restoreVersion: async (
          versionId: number,
          createAsNewVersion = false,
        ) => {
          const state = get();
          if (!state.activeAssignmentId) {
            return undefined;
          }

          try {
            const { restoreAssignmentVersion, getAssignmentVersion } =
              await import("@/lib/author");

            const restoredVersion = await restoreAssignmentVersion(
              state.activeAssignmentId,
              versionId,
              { createAsNewVersion },
            );

            if (restoredVersion) {
              const versionData = await getAssignmentVersion(
                state.activeAssignmentId,
                createAsNewVersion ? restoredVersion.id : versionId,
              );

              if (versionData && versionData.assignment) {
                const assignment = versionData.assignment;

                const processedQuestions =
                  assignment.questions?.map((question: any, index: number) => {
                    const parsedVariants =
                      question.variants?.map((variant: any) => ({
                        ...variant,
                        choices:
                          typeof variant.choices === "string"
                            ? (() => {
                                try {
                                  if (
                                    variant.choices === "[object Object]" ||
                                    (!variant.choices.trim().startsWith("{") &&
                                      !variant.choices.trim().startsWith("["))
                                  ) {
                                    console.warn(
                                      "Invalid JSON format for variant choices:",
                                      variant.choices,
                                    );
                                    return [];
                                  }
                                  return JSON.parse(variant.choices);
                                } catch (error) {
                                  console.error(
                                    "Failed to parse variant choices:",
                                    variant.choices,
                                    error,
                                  );
                                  return [];
                                }
                              })()
                            : variant.choices,
                      })) || [];

                    const rubricArray = question.scoring?.rubrics?.map(
                      (rubric: any) => ({
                        rubricQuestion: rubric.rubricQuestion,
                        criteria: rubric.criteria.map(
                          (crit: any, idx: number) => ({
                            description: crit.description,
                            points: crit.points,
                            id: idx + 1,
                          }),
                        ),
                      }),
                    );

                    return {
                      ...question,
                      alreadyInBackend: true,
                      variants: parsedVariants,
                      scoring: {
                        type: "CRITERIA_BASED",
                        rubrics: rubricArray || [],
                      },
                      index: index + 1,
                    };
                  }) || [];

                set({
                  name: assignment.name || state.name,
                  introduction: assignment.introduction || state.introduction,
                  instructions: assignment.instructions || state.instructions,
                  gradingCriteriaOverview:
                    assignment.gradingCriteriaOverview ||
                    state.gradingCriteriaOverview,
                  questions: processedQuestions,
                  currentVersion: restoredVersion,
                  hasUnsavedChanges: false,
                  originalAssignment: assignment,
                });

                if (typeof window !== "undefined") {
                  const { useAssignmentConfig } = await import(
                    "@/stores/assignmentConfig"
                  );
                  const { useAssignmentFeedbackConfig } = await import(
                    "@/stores/assignmentFeedbackConfig"
                  );
                  const assignmentConfigStore = useAssignmentConfig.getState();
                  const feedbackConfigStore =
                    useAssignmentFeedbackConfig.getState();

                  if (assignmentConfigStore.setAssignmentConfigStore) {
                    assignmentConfigStore.setAssignmentConfigStore({
                      numAttempts:
                        assignment.numAttempts ||
                        assignmentConfigStore.numAttempts,
                      attemptsBeforeCoolDown:
                        assignment.attemptsBeforeCoolDown ||
                        assignmentConfigStore.attemptsBeforeCoolDown,
                      retakeAttemptCoolDownMinutes:
                        assignment.retakeAttemptCoolDownMinutes ||
                        assignmentConfigStore.retakeAttemptCoolDownMinutes,
                      passingGrade:
                        assignment.passingGrade ||
                        assignmentConfigStore.passingGrade,
                      displayOrder:
                        assignment.displayOrder ||
                        assignmentConfigStore.displayOrder,
                      graded:
                        assignment.graded !== undefined
                          ? assignment.graded
                          : assignmentConfigStore.graded,
                      questionDisplay:
                        assignment.questionDisplay ||
                        assignmentConfigStore.questionDisplay,
                      timeEstimateMinutes:
                        assignment.timeEstimateMinutes ||
                        assignmentConfigStore.timeEstimateMinutes,
                      allotedTimeMinutes:
                        assignment.allotedTimeMinutes ||
                        assignmentConfigStore.allotedTimeMinutes,
                      updatedAt:
                        assignment.updatedAt || assignmentConfigStore.updatedAt,
                      showQuestions:
                        assignment.showQuestions !== undefined
                          ? assignment.showQuestions
                          : assignmentConfigStore.showQuestions,
                      showSubmissionFeedback:
                        assignment.showSubmissionFeedback !== undefined
                          ? assignment.showSubmissionFeedback
                          : assignmentConfigStore.showSubmissionFeedback,
                    });
                  }

                  if (feedbackConfigStore.setAssignmentFeedbackConfigStore) {
                    feedbackConfigStore.setAssignmentFeedbackConfigStore({
                      showSubmissionFeedback:
                        assignment.showSubmissionFeedback !== undefined
                          ? assignment.showSubmissionFeedback
                          : feedbackConfigStore.showSubmissionFeedback,
                      showQuestionScore:
                        assignment.showQuestionScore !== undefined
                          ? assignment.showQuestionScore
                          : feedbackConfigStore.showQuestionScore,
                      showAssignmentScore:
                        assignment.showAssignmentScore !== undefined
                          ? assignment.showAssignmentScore
                          : feedbackConfigStore.showAssignmentScore,
                    });
                  }
                }
              } else {
                console.warn("⚠️ No assignment data found in version response");
              }

              await get().loadVersions();
            }

            return restoredVersion;
          } catch (error) {
            console.error("💥 Error restoring version:", error);
            return undefined;
          }
        },

        activateVersion: async (versionId: number) => {
          const state = get();
          if (!state.activeAssignmentId) return undefined;

          try {
            const { activateAssignmentVersion } = await import("@/lib/author");
            const activatedVersion = await activateAssignmentVersion(
              state.activeAssignmentId,
              versionId,
            );

            if (activatedVersion) {
              set({
                currentVersion: activatedVersion,
                versions: state.versions.map((v) => ({
                  ...v,
                  isActive: v.id === versionId,
                })),
              });
            }

            return activatedVersion;
          } catch (error) {
            console.error("Error activating version:", error);
            return undefined;
          }
        },

        compareVersions: async (fromVersionId: number, toVersionId: number) => {
          const state = get();
          if (!state.activeAssignmentId) return;

          try {
            const { compareAssignmentVersions } = await import("@/lib/author");
            const comparison = await compareAssignmentVersions(
              state.activeAssignmentId,
              { fromVersionId, toVersionId },
            );

            if (comparison) {
              set({ versionComparison: comparison });
            }
          } catch (error) {
            console.error("Error comparing versions:", error);
          }
        },

        getVersionHistory: async () => {
          const state = get();
          if (!state.activeAssignmentId) return [];

          try {
            const { getAssignmentVersionHistory } = await import(
              "@/lib/author"
            );
            return await getAssignmentVersionHistory(state.activeAssignmentId);
          } catch (error) {
            console.error("Error getting version history:", error);
            return [];
          }
        },

        setVersions: (versions) => set({ versions }),
        setCurrentVersion: (currentVersion) => set({ currentVersion }),
        setCheckedOutVersion: (checkedOutVersion) => set({ checkedOutVersion }),
        setSelectedVersion: (selectedVersion) => set({ selectedVersion }),
        setVersionComparison: (versionComparison) => set({ versionComparison }),
        setIsLoadingVersions: (isLoadingVersions) => set({ isLoadingVersions }),
        setHasUnsavedChanges: (hasUnsavedChanges) => set({ hasUnsavedChanges }),
        markAutoSave: () => set({ lastAutoSave: new Date() }),

        setDrafts: (drafts) => set({ drafts }),
        setIsLoadingDrafts: (isLoadingDrafts) => set({ isLoadingDrafts }),
        setDraftsLoadFailed: (draftsLoadFailed) => set({ draftsLoadFailed }),
        setHasAttemptedLoadDrafts: (hasAttemptedLoadDrafts) =>
          set({ hasAttemptedLoadDrafts }),

        setFavoriteVersions: (favoriteVersions) => set({ favoriteVersions }),

        loadFavoriteVersions: async () => {
          const state = get();
          if (!state.activeAssignmentId) return;

          try {
            const storageKey = `favorites-${state.activeAssignmentId}`;
            const storedFavorites = localStorage.getItem(storageKey);
            const favorites = storedFavorites
              ? JSON.parse(storedFavorites)
              : [];
            set({ favoriteVersions: favorites });
          } catch (error) {
            console.error("❌ Error loading favorite versions:", error);
            set({ favoriteVersions: [] });
          }
        },

        toggleFavoriteVersion: async (versionId: number) => {
          const state = get();
          if (!state.activeAssignmentId) return;

          try {
            const currentFavorites = [...state.favoriteVersions];
            const isFavorite = currentFavorites.includes(versionId);

            let newFavorites: number[];
            if (isFavorite) {
              newFavorites = currentFavorites.filter((id) => id !== versionId);
            } else {
              newFavorites = [...currentFavorites, versionId];
            }

            set({ favoriteVersions: newFavorites });

            const storageKey = `favorites-${state.activeAssignmentId}`;
            localStorage.setItem(storageKey, JSON.stringify(newFavorites));
          } catch (error) {
            console.error("❌ Error toggling favorite version:", error);
          }
        },

        updateVersionDescription: async (
          versionId: number,
          versionDescription: string,
        ) => {
          const state = get();
          if (!state.activeAssignmentId) return undefined;

          try {
            const { updateVersionDescription: updateVersionDescriptionAPI } =
              await import("@/lib/author");
            const updatedVersion = await updateVersionDescriptionAPI(
              state.activeAssignmentId,
              versionId,
              versionDescription,
            );

            if (updatedVersion) {
              set({
                versions: state.versions.map((v) =>
                  v.id === versionId
                    ? {
                        ...v,
                        versionDescription: updatedVersion.versionDescription,
                      }
                    : v,
                ),
              });
            }

            return updatedVersion;
          } catch (error) {
            console.error("❌ Error updating version description:", error);
            return undefined;
          }
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
              setItem: () => null,
              removeItem: () => null,
            },
      ),
      partialize(state) {
        return Object.fromEntries(
          Object.entries(state).filter(
            ([key, value]) =>
              typeof value !== "function" && !NON_PERSIST_KEYS.has(key as any),
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
