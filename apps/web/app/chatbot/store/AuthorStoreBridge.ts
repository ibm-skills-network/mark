/* eslint-disable */

"use client";

import { QuestionType } from "@/config/types";
import { OptionalQuestion, useAuthorStore } from "@/stores/author";
import { useEffect } from "react";

/* eslint-disable */

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
        questionTypes: string[],
        count: number,
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

          try {
            const authorStore = useAuthorStore.getState();

            if (!questionType || !questionText) {
              throw new Error("Question type and text are required");
            }

            const existingIds = authorStore.questions.map((q) => q.id || 0);
            let newQuestionId = Math.max(0, ...existingIds) + 1;

            if (existingIds.includes(newQuestionId)) {
              newQuestionId = Math.max(1000000, ...existingIds) + 1;
            }

            let choices = [];
            if (
              options &&
              Array.isArray(options) &&
              options.length > 0 &&
              ["SINGLE_CORRECT", "MULTIPLE_CORRECT"].includes(questionType)
            ) {
              choices = options.map((option) => ({
                choice: option.text || "",
                isCorrect: option.isCorrect || false,
                points:
                  option.points !== undefined
                    ? option.points
                    : questionType === "MULTIPLE_CORRECT"
                      ? option.isCorrect
                        ? 1
                        : -1
                      : 0,
                feedback: "",
              }));
            }

            const newQuestion = {
              id: newQuestionId,
              type: questionType as QuestionType,
              question: questionText,
              totalPoints: totalPoints || 10,
              assignmentId: authorStore.activeAssignmentId || 1,
              variants: [],
              choices: choices,
              scoring: {
                type: "CRITERIA_BASED" as const,
                rubrics: [],
                showRubricsToLearner: true,
              },
              randomizedChoices: choices.length > 0 ? true : undefined,
              index: (authorStore.questions.length || 0) + 1,
            };

            authorStore.addQuestion(newQuestion);

            if (
              authorStore.questionOrder &&
              !authorStore.questionOrder.includes(newQuestionId)
            ) {
              authorStore.setQuestionOrder([
                ...authorStore.questionOrder,
                newQuestionId,
              ]);
            }

            if (authorStore.setUpdatedAt) {
              authorStore.setUpdatedAt(Date.now());
            }

            console.groupEnd();

            return {
              success: true,
              message: `Successfully created a new ${questionType} question with ID ${newQuestionId}.`,
              questionId: newQuestionId,
            };
          } catch (error) {
            console.groupEnd();
            return {
              success: false,
              message: `Error creating question: ${error.message}`,
              error: error.message,
            };
          }
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
        ) => {
          console.group("Bridge: generateQuestionsFromObjectives");

          try {
            const authorStore = useAuthorStore.getState();

            if (!learningObjectives || !learningObjectives.trim()) {
              throw new Error("No learning objectives provided");
            }

            count = count || 5;
            questionTypes =
              questionTypes &&
              Array.isArray(questionTypes) &&
              questionTypes.length > 0
                ? questionTypes
                : ["SINGLE_CORRECT", "MULTIPLE_CORRECT", "TEXT", "TRUE_FALSE"];

            let generatedCount = 0;
            const questionIds = [];
            const startId =
              Math.max(0, ...authorStore.questions.map((q) => q.id || 0)) + 1;

            for (let i = 0; i < count; i++) {
              const qType = questionTypes[i % questionTypes.length];
              const qId = startId + i;

              const newQuestion = {
                id: qId,
                type: qType as QuestionType,
                question: `Generated question ${i + 1} based on learning objectives (type: ${qType})`,
                totalPoints: 10,
                assignmentId: authorStore.activeAssignmentId || 0,
                variants: [],
                choices: [],
                answer: undefined,
                scoring: {
                  type: "CRITERIA_BASED" as const,
                  rubrics: [],
                  showRubricsToLearner: true,
                },
              };

              if (qType === "SINGLE_CORRECT" || qType === "MULTIPLE_CORRECT") {
                newQuestion.choices = [
                  {
                    choice: "Option A",
                    isCorrect: true,
                    points: qType === "MULTIPLE_CORRECT" ? 1 : 0,
                  },
                  {
                    choice: "Option B",
                    isCorrect: false,
                    points: qType === "MULTIPLE_CORRECT" ? -1 : 0,
                  },
                  {
                    choice: "Option C",
                    isCorrect: false,
                    points: qType === "MULTIPLE_CORRECT" ? -1 : 0,
                  },
                  {
                    choice: "Option D",
                    isCorrect: false,
                    points: qType === "MULTIPLE_CORRECT" ? -1 : 0,
                  },
                ];
              }

              if (qType === "TRUE_FALSE") {
                newQuestion.answer = true;
              }

              newQuestion.scoring = {
                type: "CRITERIA_BASED",
                rubrics: [],
                showRubricsToLearner: true,
              };

              authorStore.addQuestion(newQuestion);
              questionIds.push(qId);
              generatedCount++;
            }

            if (authorStore.questionOrder) {
              authorStore.setQuestionOrder([
                ...authorStore.questionOrder,
                ...questionIds,
              ]);
            }

            if (authorStore.setUpdatedAt) {
              authorStore.setUpdatedAt(Date.now());
            }

            console.groupEnd();

            return {
              success: true,
              message: `Successfully generated ${generatedCount} questions based on your learning objectives.`,
              questionIds: questionIds,
            };
          } catch (error) {
            console.groupEnd();
            return {
              success: false,
              message: `Failed to generate questions: ${error.message}`,
              error: error.message,
            };
          }
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

      const authorOperationHandler = (e) => {
        if (!window.authorStoreBridge) {
          return;
        }

        const { operation, args, requestId } = e.detail;
        if (!operation || !args || !requestId) {
          return;
        }

        if (typeof window.authorStoreBridge[operation] !== "function") {
          window.dispatchEvent(
            new CustomEvent("author-store-result", {
              detail: {
                requestId,
                result: {
                  success: false,
                  message: `Operation ${operation} not found in bridge`,
                  error: "Operation not found",
                },
              },
            }),
          );
          return;
        }

        try {
          const result = window.authorStoreBridge[operation](...args);

          window.dispatchEvent(
            new CustomEvent("author-store-result", {
              detail: {
                requestId,
                result,
              },
            }),
          );
        } catch (error) {
          window.dispatchEvent(
            new CustomEvent("author-store-result", {
              detail: {
                requestId,
                result: {
                  success: false,
                  message: `Error executing ${operation}: ${error.message}`,
                  error: error.message,
                },
              },
            }),
          );
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
