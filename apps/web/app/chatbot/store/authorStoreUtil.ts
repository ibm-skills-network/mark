/* eslint-disable */
"use client";
/**
 * Client-side utilities for interacting with the author store
 * This file provides functions to execute author store operations from client components
 */

/**
 * Wait for the bridge to be initialized with a more reliable approach
 * @param maxWait Maximum time to wait in milliseconds
 * @returns Promise that resolves when bridge is ready
 */
export function waitForBridge(maxWait = 10000) {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && window._authorStoreBridgeInitialized) {
      resolve(true);
      return;
    }

    if (typeof window === "undefined") {
      reject(new Error("Cannot wait for bridge in server context"));
      return;
    }

    const registerCallback = () => {
      const startTime = Date.now();

      const callback = () => {
        resolve(true);
      };

      const timeoutId = setTimeout(() => {
        if (window._authorStoreBridgeCallbacks) {
          window._authorStoreBridgeCallbacks =
            window._authorStoreBridgeCallbacks.filter((cb) => cb !== callback);
        }
        reject(new Error("Bridge did not initialize in time"));
      }, maxWait);

      if (window._authorStoreBridgeCallbacks) {
        window._authorStoreBridgeCallbacks.push(() => {
          clearTimeout(timeoutId);
          callback();
        });
      } else {
        window._authorStoreBridgeCallbacks = [];
        window._authorStoreBridgeCallbacks.push(() => {
          clearTimeout(timeoutId);
          callback();
        });
        window._notifyBridgeInitialized = () => {
          window._authorStoreBridgeInitialized = true;
          window._authorStoreBridgeCallbacks.forEach((cb) => cb());
          window._authorStoreBridgeCallbacks = [];
        };
      }
    };

    registerCallback();

    if (
      !window.authorStoreBridge &&
      !document.getElementById("author-store-bridge-trigger")
    ) {
      const bridgeTrigger = document.createElement("div");
      bridgeTrigger.id = "author-store-bridge-trigger";
      bridgeTrigger.style.display = "none";
      document.body.appendChild(bridgeTrigger);

      setTimeout(() => {
        if (bridgeTrigger.parentNode) {
          bridgeTrigger.parentNode.removeChild(bridgeTrigger);
        }
      }, 1000);
    }
  });
}

/**
 * Execute an operation on the author store bridge with improved reliability
 * @param {string} operation - The operation to execute
 * @param {array} args - The arguments to pass to the operation
 * @returns {Promise} - A promise that resolves with the result of the operation
 */
export async function executeAuthorStoreOperation(operation, ...args) {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("Cannot execute author store operation on server"),
    );
  }

  try {
    await waitForBridge();

    if (!window.authorStoreBridge) {
      return Promise.reject(new Error("Author store bridge not available"));
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return new Promise((resolve, reject) => {
      const resultHandler = (e) => {
        if (e.detail.requestId === requestId) {
          window.removeEventListener("author-store-result", resultHandler);
          if (e.detail.result && e.detail.result.success) {
            resolve(e.detail.result);
          } else {
            reject(
              new Error(
                e.detail.result?.message ||
                  "Unknown error in author store operation",
              ),
            );
          }
        }
      };

      window.addEventListener("author-store-result", resultHandler);

      window.dispatchEvent(
        new CustomEvent("author-store-operation", {
          detail: {
            operation,
            args,
            requestId,
          },
        }),
      );

      setTimeout(() => {
        window.removeEventListener("author-store-result", resultHandler);
        reject(new Error(`Operation ${operation} timed out after 10 seconds`));
      }, 10000);
    });
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Create a new question
 * @param {string} questionType - Type of question
 * @param {string} questionText - Question text
 * @param {number} totalPoints - Total points
 * @param {array} options - Options for multiple choice questions
 * @returns {Promise} - Promise that resolves with the result
 */
export function createQuestion(
  questionType,
  questionText,
  totalPoints = 10,
  options = [],
) {
  return executeAuthorStoreOperation(
    "createQuestion",
    questionType,
    questionText,
    totalPoints,
    options,
  );
}

/**
 * Modify an existing question
 * @param {number} questionId - ID of the question
 * @param {string} questionText - New question text
 * @param {number} totalPoints - New total points
 * @param {string} questionType - New question type
 * @returns {Promise} - Promise that resolves with the result
 */
export function modifyQuestion(
  questionId,
  questionText,
  totalPoints,
  questionType,
) {
  return executeAuthorStoreOperation(
    "modifyQuestion",
    questionId,
    questionText,
    totalPoints,
    questionType,
  );
}

/**
 * Set choices for a question
 * @param {number} questionId - ID of the question
 * @param {array} choices - Array of choice objects
 * @param {number} variantId - Variant ID (optional)
 * @returns {Promise} - Promise that resolves with the result
 */
export function setQuestionChoices(questionId, choices, variantId) {
  return executeAuthorStoreOperation(
    "setQuestionChoices",
    questionId,
    choices,
    variantId,
  );
}

/**
 * Add a rubric to a question
 * @param {number} questionId - ID of the question
 * @param {string} rubricQuestion - Rubric question text
 * @param {array} criteria - Array of criteria objects
 * @returns {Promise} - Promise that resolves with the result
 */
export function addRubric(questionId, rubricQuestion, criteria) {
  return executeAuthorStoreOperation(
    "addRubric",
    questionId,
    rubricQuestion,
    criteria,
  );
}

/**
 * Generate a variant for a question
 * @param {number} questionId - ID of the question
 * @param {string} variantType - Type of variant
 * @returns {Promise} - Promise that resolves with the result
 */
export function generateQuestionVariant(questionId, variantType) {
  return executeAuthorStoreOperation(
    "generateQuestionVariant",
    questionId,
    variantType,
  );
}

/**
 * Delete a question
 * @param {number} questionId - ID of the question
 * @returns {Promise} - Promise that resolves with the result
 */
export function deleteQuestion(questionId) {
  return executeAuthorStoreOperation("deleteQuestion", questionId);
}

/**
 * Generate questions from learning objectives
 * @param {string} learningObjectives - Learning objectives text
 * @param {array} questionTypes - Types of questions to generate
 * @param {number} count - Number of questions to generate
 * @returns {Promise} - Promise that resolves with the result
 */
export function generateQuestionsFromObjectives(
  learningObjectives,
  questionTypes,
  count,
) {
  return executeAuthorStoreOperation(
    "generateQuestionsFromObjectives",
    learningObjectives,
    questionTypes,
    count,
  );
}

/**
 * Update learning objectives
 * @param {string} learningObjectives - New learning objectives
 * @returns {Promise} - Promise that resolves with the result
 */
export function updateLearningObjectives(learningObjectives) {
  return executeAuthorStoreOperation(
    "updateLearningObjectives",
    learningObjectives,
  );
}

/**
 * Set the title of a question
 * @param {number} questionId - ID of the question
 * @param {string} title - New title
 * @returns {Promise} - Promise that resolves with the result
 */
export function setQuestionTitle(questionId, title) {
  return executeAuthorStoreOperation("setQuestionTitle", questionId, title);
}

/**
 * Show a report preview form - this is handled client-side only
 * @param {object} params - Parameters for the report preview (issueType, description, severity, etc.)
 * @returns {Promise} - Promise that resolves with success
 */
export function showReportPreview(params) {
  // This is a client-side only operation that triggers UI changes
  // The actual form display is handled by the MarkChat component
  return Promise.resolve({
    success: true,
    message: "Report preview form displayed",
    data: params,
  });
}

/**
 * Run an author operation directly without using the utility functions
 * This is a more flexible approach that can be used for any operation
 * @param {string} operation - The operation name
 * @param {object} params - The parameters for the operation
 * @returns {Promise} - Promise that resolves with the result
 */
export function runAuthorOperation(operation, params) {
  switch (operation) {
    case "createQuestion":
      return createQuestion(
        params.questionType,
        params.questionText,
        params.totalPoints,
        params.options,
      );
    case "modifyQuestion":
      return modifyQuestion(
        params.questionId,
        params.questionText,
        params.totalPoints,
        params.questionType,
      );
    case "setQuestionChoices":
      return setQuestionChoices(
        params.questionId,
        params.choices,
        params.variantId,
      );
    case "addRubric":
      return addRubric(
        params.questionId,
        params.rubricQuestion,
        params.criteria,
      );
    case "generateQuestionVariant":
      return generateQuestionVariant(params.questionId, params.variantType);
    case "deleteQuestion":
      return deleteQuestion(params.questionId);
    case "generateQuestionsFromObjectives":
      return generateQuestionsFromObjectives(
        params.learningObjectives,
        params.questionTypes,
        params.count,
      );
    case "updateLearningObjectives":
      return updateLearningObjectives(params.learningObjectives);
    case "setQuestionTitle":
      return setQuestionTitle(params.questionId, params.title);
    case "showReportPreview":
      // This is handled directly by the React component, not through store operations
      return Promise.resolve({
        success: true,
        message: "Report preview handled by component",
      });
    default:
      return Promise.reject(new Error(`Unknown operation: ${operation}`));
  }
}

export default {
  createQuestion,
  modifyQuestion,
  setQuestionChoices,
  addRubric,
  generateQuestionVariant,
  deleteQuestion,
  generateQuestionsFromObjectives,
  updateLearningObjectives,
  setQuestionTitle,
  showReportPreview,
  executeAuthorStoreOperation,
  runAuthorOperation,
  waitForBridge,
};
