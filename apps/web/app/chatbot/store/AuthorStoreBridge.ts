/* eslint-disable */

"use client";

import { QuestionGenerationPayload, QuestionType } from "@/config/types";
import {
  buildQuestionGenerationPayloadFromObjectives,
  coerceCreateQuestionTypeForPrompt,
  pollQuestionGenerationJob,
  startQuestionGenerationJob,
} from "@/lib/question-generation/client";
import { mergeGeneratedQuestionsForAuthorStore } from "@/lib/question-generation/normalize";
import { OptionalQuestion, useAuthorStore } from "@/stores/author";
import { useEffect } from "react";

/* eslint-disable */

type MultipleChoiceSubtypeCounts = NonNullable<
  QuestionGenerationPayload["questionsToGenerate"]["multipleChoiceSubtypes"]
>;

type GenerateQuestionsFromObjectivesInput = {
  learningObjectives: string;
  questionTypes?: string[];
  count?: number;
  multipleChoiceSubtypes?: Partial<MultipleChoiceSubtypeCounts>;
};

declare global {
  interface Window {
    authorStoreBridge?: {
      getState: () => any;
      createQuestion: (
        questionType: string,
        questionText: string,
        totalPoints?: number,
        options?: Array<{ text: string; isCorrect: boolean; points?: number }>,
      ) => any;
      modifyQuestion: (
        questionId: number,
        questionText?: string,
        totalPoints?: number,
        questionType?: string,
      ) => any;
      setQuestionChoices: (
        questionId: number,
        choices: Array<{ text: string; isCorrect: boolean; points?: number }>,
        variantId?: number,
      ) => any;
      addRubric: (
        questionId: number,
        rubricQuestion: string,
        criteria: Array<{ description: string; points: number }>,
      ) => any;
      generateQuestionVariant: (questionId: number, variantType: string) => any;
      deleteQuestion: (questionId: number) => any;
      generateQuestionsFromObjectives: (
        learningObjectives: string,
        questionTypes?: string[],
        count?: number,
        multipleChoiceSubtypes?: Partial<MultipleChoiceSubtypeCounts>,
      ) => any;
      updateLearningObjectives: (learningObjectives: string) => any;
      setQuestionTitle: (questionId: number, title: string) => any;
    };
    _authorStoreBridgeInitialized: boolean;
    _authorStoreBridgeCallbacks: Function[];
    _notifyBridgeInitialized: () => void;
  }
}

/**
 * AuthorStoreBridge - A client component that provides a bridge between
 * server routes and client-side state management.
 *
 * This component creates a global bridge object that can execute store operations
 * and listens for message events from the server routes.
 */
export default function AuthorStoreBridge() {
  useEffect(() => {
    if (!window._authorStoreBridgeCallbacks) {
      window._authorStoreBridgeCallbacks = [];
      window._notifyBridgeInitialized = () => {
        window._authorStoreBridgeInitialized = true;
        window._authorStoreBridgeCallbacks.forEach((callback) => callback());
        window._authorStoreBridgeCallbacks = [];
      };
    }

    if (!window.authorStoreBridge) {
      type QuestionGenerationPipelineSuccess = {
        success: true;
        message: string;
        questionIds: number[];
        jobId: string;
      };

      type QuestionGenerationPipelineFailure = {
        success: false;
        message: string;
        error: string;
        jobId?: string;
      };

      type QuestionGenerationPipelineResult =
        | QuestionGenerationPipelineSuccess
        | QuestionGenerationPipelineFailure;

      const AI_QUESTION_TYPES = new Set([
        "TEXT",
        "SINGLE_CORRECT",
        "MULTIPLE_CORRECT",
        "TRUE_FALSE",
        "URL",
        "UPLOAD",
        "LINK_FILE",
      ]);

      const generateQuestionsFromAiPipeline = async ({
        learningObjectives,
        questionTypes,
        count,
        multipleChoiceSubtypes,
      }: GenerateQuestionsFromObjectivesInput): Promise<QuestionGenerationPipelineResult> => {
        const authorStore = useAuthorStore.getState();

        if (!learningObjectives || !learningObjectives.trim()) {
          throw new Error("No learning objectives provided");
        }

        const assignmentId = authorStore.activeAssignmentId;
        if (!assignmentId) {
          throw new Error("No active assignment selected");
        }

        const payload = buildQuestionGenerationPayloadFromObjectives({
          assignmentId,
          learningObjectives,
          questionTypes,
          count,
          multipleChoiceSubtypes,
        });

        const jobId = await startQuestionGenerationJob(payload);

        return await new Promise<QuestionGenerationPipelineResult>(
          (resolve) => {
            let settled = false;
            const settle = (result: QuestionGenerationPipelineResult) => {
              if (settled) return;
              settled = true;
              resolve(result);
            };

            const stopPolling = pollQuestionGenerationJob({
              jobId,
              onUpdate: () => {},
              onCompleted: (latestStatusData) => {
                try {
                  const latestStore = useAuthorStore.getState();
                  const generatedQuestions = latestStatusData.questions || [];
                  const mergeResult = mergeGeneratedQuestionsForAuthorStore({
                    existingQuestions: latestStore.questions || [],
                    generatedQuestions,
                    assignmentId,
                    existingQuestionOrder: latestStore.questionOrder || [],
                  });

                  latestStore.setQuestions(mergeResult.questions);
                  latestStore.setQuestionOrder(mergeResult.questionOrder);

                  if (latestStore.setUpdatedAt) {
                    latestStore.setUpdatedAt(Date.now());
                  }

                  stopPolling();
                  settle({
                    success: true,
                    message: `Successfully generated ${mergeResult.processedQuestions.length} questions based on your learning objectives.`,
                    questionIds: mergeResult.generatedIds,
                    jobId,
                  });
                } catch (error) {
                  stopPolling();
                  const errorMessage =
                    error instanceof Error
                      ? error.message
                      : "Unknown error during question processing";

                  settle({
                    success: false,
                    message: `Failed to process generated questions: ${errorMessage}`,
                    error: errorMessage,
                    jobId,
                  });
                }
              },
              onFailed: () => {
                stopPolling();
                settle({
                  success: false,
                  message: "Failed to generate questions: Processing failed.",
                  error: "Processing failed",
                  jobId,
                });
              },
              onError: (error) => {
                stopPolling();
                const errorMessage =
                  error instanceof Error
                    ? error.message
                    : "An error occurred while fetching job status";
                settle({
                  success: false,
                  message: `Failed to generate questions: ${errorMessage}`,
                  error: errorMessage,
                  jobId,
                });
              },
            });
          },
        );
      };

      window.authorStoreBridge = {
        getState: () => {
          return useAuthorStore.getState();
        },

        createQuestion: (
          questionType,
          questionText,
          totalPoints = 10,
          options = [],
        ) => {
          console.group("Bridge: createQuestion");

          return (async () => {
            try {
              if (!questionType || !questionText) {
                throw new Error("Question type and text are required");
              }

              const normalizedQuestionType = coerceCreateQuestionTypeForPrompt({
                questionType,
                prompt: questionText,
              });
              if (
                !normalizedQuestionType ||
                !AI_QUESTION_TYPES.has(normalizedQuestionType)
              ) {
                throw new Error(`Unsupported question type: ${questionType}`);
              }

              const generationResult = await generateQuestionsFromAiPipeline({
                learningObjectives: questionText,
                questionTypes: [normalizedQuestionType],
                count: 1,
              });

              if (!generationResult.success) {
                return generationResult;
              }

              const generatedQuestionId = Array.isArray(
                generationResult.questionIds,
              )
                ? generationResult.questionIds.find(
                    (id) => typeof id === "number",
                  )
                : undefined;

              if (typeof generatedQuestionId !== "number") {
                return {
                  success: false,
                  message:
                    "Question generation completed but no question ID was returned.",
                  error: "No generated question ID",
                  jobId: generationResult.jobId,
                };
              }

              return {
                success: true,
                message: `Successfully created a new ${normalizedQuestionType} question with ID ${generatedQuestionId}.`,
                questionId: generatedQuestionId,
                questionIds: generationResult.questionIds,
                jobId: generationResult.jobId,
              };
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
              return {
                success: false,
                message: `Error creating question: ${errorMessage}`,
                error: errorMessage,
              };
            }
          })().finally(() => {
            console.groupEnd();
          });
        },

        modifyQuestion: (
          questionId,
          questionText,
          totalPoints,
          questionType,
        ) => {
          console.group("Bridge: modifyQuestion");

          try {
            const authorStore = useAuthorStore.getState();

            questionId = parseInt(questionId.toString());
            if (isNaN(questionId)) {
              throw new Error("Invalid question ID format");
            }

            const question = authorStore.questions.find(
              (q) => q.id === questionId,
            );
            if (!question) {
              throw new Error(`Question with ID ${questionId} not found`);
            }

            const modification: OptionalQuestion = {};
            if (questionText !== undefined && questionText !== null)
              modification.question = questionText;
            if (totalPoints !== undefined && totalPoints !== null)
              modification.totalPoints = totalPoints;
            if (questionType !== undefined && questionType !== null)
              modification.type = questionType as QuestionType;

            authorStore.modifyQuestion(questionId, modification);

            if (authorStore.setUpdatedAt) {
              authorStore.setUpdatedAt(Date.now());
            }

            console.groupEnd();

            return {
              success: true,
              message: `Successfully modified question ${questionId}.`,
            };
          } catch (error) {
            console.groupEnd();
            return {
              success: false,
              message: `Error modifying question: ${error.message}`,
              error: error.message,
            };
          }
        },

        setQuestionChoices: (questionId, choices, variantId) => {
          console.group("Bridge: setQuestionChoices");

          try {
            const authorStore = useAuthorStore.getState();

            questionId = parseInt(questionId.toString());
            if (isNaN(questionId)) {
              throw new Error("Invalid question ID format");
            }

            if (variantId !== undefined) {
              variantId = parseInt(variantId.toString());
              if (isNaN(variantId)) {
                throw new Error("Invalid variant ID format");
              }
            }

            const question = authorStore.questions.find(
              (q) => q.id === questionId,
            );
            if (!question) {
              throw new Error(`Question with ID ${questionId} not found`);
            }

            if (!choices || !Array.isArray(choices) || choices.length === 0) {
              throw new Error("Choices must be a non-empty array");
            }

            if (
              !["SINGLE_CORRECT", "MULTIPLE_CORRECT"].includes(question.type)
            ) {
              authorStore.modifyQuestion(questionId, {
                type: "SINGLE_CORRECT",
              });
            }

            const formattedChoices = choices.map((choice) => ({
              choice: choice.text || "",
              isCorrect: choice.isCorrect || false,
              points:
                choice.points !== undefined
                  ? choice.points
                  : question.type === "MULTIPLE_CORRECT"
                    ? choice.isCorrect
                      ? 1
                      : -1
                    : 0,
              feedback: "",
            }));

            authorStore.setChoices(questionId, formattedChoices, variantId);

            if (authorStore.setUpdatedAt) {
              authorStore.setUpdatedAt(Date.now());
            }

            console.groupEnd();

            return {
              success: true,
              message: `Successfully updated choices for question ${questionId}${variantId ? ` variant ${variantId}` : ""}.`,
            };
          } catch (error) {
            console.groupEnd();
            return {
              success: false,
              message: `Error setting question choices: ${error.message}`,
              error: error.message,
            };
          }
        },

        addRubric: (questionId, rubricQuestion, criteria) => {
          console.group("Bridge: addRubric");

          try {
            const authorStore = useAuthorStore.getState();

            questionId = parseInt(questionId.toString());
            if (isNaN(questionId)) {
              throw new Error("Invalid question ID format");
            }

            const question = authorStore.questions.find(
              (q) => q.id === questionId,
            );
            if (!question) {
              throw new Error(`Question with ID ${questionId} not found`);
            }

            authorStore.addOneRubric(questionId);

            const scoring = question.scoring || {
              type: "CRITERIA_BASED",
              rubrics: [],
            };
            const rubricIndex = (scoring.rubrics?.length || 1) - 1;

            if (rubricQuestion) {
              authorStore.setRubricQuestionText(
                questionId,
                0,
                rubricIndex,
                rubricQuestion,
              );
            }

            if (criteria && criteria.length > 0) {
              const formattedCriteria = criteria.map((criterion, index) => ({
                id: index + 1,
                description: criterion.description,
                points: criterion.points || 0,
              }));

              authorStore.setCriterias(
                questionId,
                rubricIndex,
                formattedCriteria,
              );
            }

            if (authorStore.setUpdatedAt) {
              authorStore.setUpdatedAt(Date.now());
            }
            console.groupEnd();

            return {
              success: true,
              message: `Successfully added rubric to question ${questionId}.`,
            };
          } catch (error) {
            console.groupEnd();
            return {
              success: false,
              message: `Failed to add rubric: ${error.message}`,
              error: error.message,
            };
          }
        },

        generateQuestionVariant: (questionId, variantType) => {
          console.group("Bridge: generateQuestionVariant");

          try {
            const authorStore = useAuthorStore.getState();

            questionId = parseInt(questionId.toString());
            if (isNaN(questionId)) {
              throw new Error("Invalid question ID format");
            }

            const question = authorStore.questions.find(
              (q) => q.id === questionId,
            );
            if (!question) {
              throw new Error(`Question with ID ${questionId} not found`);
            }

            const variantId =
              Math.max(0, ...(question.variants || []).map((v) => v.id || 0)) +
              1;

            const newVariant = {
              id: variantId,
              questionId: questionId,
              type: question.type,
              variantContent: question.question,
              choices: question.choices ? [...question.choices] : [],
              scoring: question.scoring
                ? { ...question.scoring }
                : { type: "CRITERIA_BASED" as const, rubrics: [] },
              createdAt: new Date().toISOString(),
              variantType: variantType as "REWORDED" | "REPHRASED",
              randomizedChoices: question.randomizedChoices,
            };

            authorStore.addVariant(questionId, newVariant);

            if (authorStore.setUpdatedAt) {
              authorStore.setUpdatedAt(Date.now());
            }

            console.groupEnd();

            return {
              success: true,
              message: `Successfully created ${variantType.toLowerCase()} variant for question ${questionId}.`,
              variantId: variantId,
            };
          } catch (error) {
            console.groupEnd();
            return {
              success: false,
              message: `Failed to generate variant: ${error.message}`,
              error: error.message,
            };
          }
        },

        deleteQuestion: (questionId) => {
          console.group("Bridge: deleteQuestion");

          try {
            const authorStore = useAuthorStore.getState();

            questionId = parseInt(questionId.toString());
            if (isNaN(questionId)) {
              throw new Error("Invalid question ID format");
            }

            const questionExists = authorStore.questions.some(
              (q) => q.id === questionId,
            );
            if (!questionExists) {
              throw new Error(`Question with ID ${questionId} not found`);
            }

            authorStore.removeQuestion(questionId);

            if (authorStore.questionOrder) {
              const updatedOrder = authorStore.questionOrder.filter(
                (id) => id !== questionId,
              );
              authorStore.setQuestionOrder(updatedOrder);
            }

            if (authorStore.setUpdatedAt) {
              authorStore.setUpdatedAt(Date.now());
            }

            console.groupEnd();

            return {
              success: true,
              message: `Successfully deleted question ${questionId}.`,
            };
          } catch (error) {
            console.groupEnd();
            return {
              success: false,
              message: `Failed to delete question: ${error.message}`,
              error: error.message,
            };
          }
        },

        generateQuestionsFromObjectives: (
          learningObjectives,
          questionTypes,
          count,
          multipleChoiceSubtypes,
        ) => {
          console.group("Bridge: generateQuestionsFromObjectives");

          return (async () => {
            try {
              return await generateQuestionsFromAiPipeline({
                learningObjectives,
                questionTypes,
                count,
                multipleChoiceSubtypes,
              });
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
              return {
                success: false,
                message: `Failed to generate questions: ${errorMessage}`,
                error: errorMessage,
              };
            }
          })().finally(() => {
            console.groupEnd();
          });
        },

        updateLearningObjectives: (learningObjectives) => {
          console.group("Bridge: updateLearningObjectives");

          try {
            const authorStore = useAuthorStore.getState();

            authorStore.setLearningObjectives(learningObjectives);

            if (authorStore.setUpdatedAt) {
              authorStore.setUpdatedAt(Date.now());
            }

            console.groupEnd();

            return {
              success: true,
              message: `Successfully updated learning objectives.`,
            };
          } catch (error) {
            console.groupEnd();
            return {
              success: false,
              message: `Failed to update learning objectives: ${error.message}`,
              error: error.message,
            };
          }
        },

        setQuestionTitle: (questionId, title) => {
          console.group("Bridge: setQuestionTitle");

          try {
            const authorStore = useAuthorStore.getState();

            questionId = parseInt(questionId.toString());
            if (isNaN(questionId)) {
              throw new Error("Invalid question ID format");
            }

            const questionExists = authorStore.questions.some(
              (q) => q.id === questionId,
            );
            if (!questionExists) {
              throw new Error(`Question with ID ${questionId} not found`);
            }

            authorStore.setQuestionTitle(title, questionId);

            if (authorStore.setUpdatedAt) {
              authorStore.setUpdatedAt(Date.now());
            }

            console.groupEnd();

            return {
              success: true,
              message: `Successfully updated title for question ${questionId}.`,
            };
          } catch (error) {
            console.groupEnd();
            return {
              success: false,
              message: `Failed to update title: ${error.message}`,
              error: error.message,
            };
          }
        },
      };

      const dispatchOperationResult = (requestId, result) => {
        window.dispatchEvent(
          new CustomEvent("author-store-result", {
            detail: {
              requestId,
              result,
            },
          }),
        );
      };

      const dispatchOperationError = (requestId, operation, error) => {
        const message =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "Unknown error";

        window.dispatchEvent(
          new CustomEvent("author-store-result", {
            detail: {
              requestId,
              result: {
                success: false,
                message: `Error executing ${operation}: ${message}`,
                error: message,
              },
            },
          }),
        );
      };

      const isPromiseLike = (value) =>
        value &&
        (typeof value === "object" || typeof value === "function") &&
        typeof value.then === "function";

      const authorOperationHandler = (e) => {
        if (!window.authorStoreBridge) {
          return;
        }

        const { operation, args, requestId } = e.detail;
        if (!operation || !args || !requestId) {
          return;
        }

        if (typeof window.authorStoreBridge[operation] !== "function") {
          dispatchOperationResult(requestId, {
            success: false,
            message: `Operation ${operation} not found in bridge`,
            error: "Operation not found",
          });
          return;
        }

        try {
          const operationArgs = Array.isArray(args) ? args : [];
          const result = window.authorStoreBridge[operation](...operationArgs);

          if (isPromiseLike(result)) {
            void result
              .then((resolvedResult) => {
                dispatchOperationResult(requestId, resolvedResult);
              })
              .catch((error) => {
                dispatchOperationError(requestId, operation, error);
              });
            return;
          }

          dispatchOperationResult(requestId, result);
        } catch (error) {
          dispatchOperationError(requestId, operation, error);
        }
      };

      window.addEventListener("author-store-operation", authorOperationHandler);

      window._authorStoreBridgeInitialized = true;
      window._notifyBridgeInitialized();

      return () => {
        window.removeEventListener(
          "author-store-operation",
          authorOperationHandler,
        );
        delete window.authorStoreBridge;
        window._authorStoreBridgeInitialized = false;
      };
    } else {
      window._authorStoreBridgeInitialized = true;
      window._notifyBridgeInitialized();
    }
  }, []);

  return null;
}
