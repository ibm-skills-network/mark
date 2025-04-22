/* eslint-disable */

"use client";
import { useAuthorStore, useQuestionStore } from "@/stores/author";
import { useEffect, useState, useCallback } from "react";
import { shallow } from "zustand/shallow";

export interface UseAuthorContextInterface {
  getContextMessage: () => Promise<any>;
  getContextData: () => any;
  currentQuestion: any;
  getCurrentQuestionInfo: () => any;
  getAllQuestionsInfo: () => any;
  assignmentMeta: {
    name: string;
    questionCount: number;
    hasLearningObjectives: boolean;
    hasFocusedQuestion: boolean;
    hasUploadedFiles: boolean;
  };
  getGenerationCapabilities: () => any;
  activeAssignmentId: string | number | null | undefined;
  focusedQuestionId: string | null | number | undefined;
  forceUpdate: () => void;
}
/**
 * A hook that provides comprehensive assignment context for the Mark chatbot when in author mode
 * This should ONLY be used in client components (marked with 'use client')
 */
export const useAuthorContext = (): UseAuthorContextInterface => {
  const {
    name,
    introduction,
    instructions,
    gradingCriteriaOverview,
    questions,
    questionOrder,
    activeAssignmentId,
    focusedQuestionId,
    learningObjectives,
    fileUploaded,
    setUpdatedAt,
  } = useAuthorStore(
    (state) => ({
      name: state.name,
      introduction: state.introduction,
      instructions: state.instructions,
      gradingCriteriaOverview: state.gradingCriteriaOverview,
      questions: state.questions,
      questionOrder: state.questionOrder,
      activeAssignmentId: state.activeAssignmentId,
      focusedQuestionId: state.focusedQuestionId,
      learningObjectives: state.learningObjectives,
      fileUploaded: state.fileUploaded,
      setUpdatedAt: state.setUpdatedAt,
    }),
    shallow,
  );

  // Get question states from question store
  const questionStates = useQuestionStore((state) => state.questionStates);

  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [assignmentMeta, setAssignmentMeta] = useState({
    name: "Untitled Assignment",
    questionCount: 0,
    hasLearningObjectives: false,
    hasFocusedQuestion: false,
    hasUploadedFiles: false,
  });

  // Force state update
  const forceUpdate = useCallback(() => {
    if (setUpdatedAt) {
      setUpdatedAt(Date.now());
    }
  }, [setUpdatedAt]);

  // Update current focused question
  useEffect(() => {
    if (questions && focusedQuestionId) {
      const focusedQuestion = questions.find((q) => q.id === focusedQuestionId);
      if (focusedQuestion) {
        setCurrentQuestion(focusedQuestion);
      } else if (questions.length > 0) {
        // Fallback to first question if focused question not found
        setCurrentQuestion(questions[0]);
      }
    } else if (questions && questions.length > 0) {
      // If no focused question but we have questions, set the first one
      setCurrentQuestion(questions[0]);
    }
  }, [questions, focusedQuestionId]);

  // Update assignment metadata
  useEffect(() => {
    setAssignmentMeta({
      name: name || "Untitled Assignment",
      questionCount: Array.isArray(questions) ? questions.length : 0,
      hasLearningObjectives: Boolean(
        learningObjectives && learningObjectives.trim() !== "",
      ),
      hasFocusedQuestion: Boolean(focusedQuestionId),
      hasUploadedFiles: Array.isArray(fileUploaded)
        ? fileUploaded.length > 0
        : false,
    });
  }, [name, questions, learningObjectives, focusedQuestionId, fileUploaded]);

  // Check if a question has rubrics defined
  const hasRubrics = useCallback((question) => {
    return question?.scoring?.rubrics && question.scoring.rubrics.length > 0;
  }, []);

  // Generate a comprehensive context message for the current state
  const getContextMessage = useCallback(async () => {
    let contextContent = "MARK ASSISTANT CONTEXT (AUTHOR MODE):\n\n";

    // Add basic assignment info
    contextContent += `Assignment: ${name || "Untitled Assignment"}\n`;
    contextContent += `Assignment ID: ${
      activeAssignmentId || "Not saved yet"
    }\n`;
    contextContent += `Number of Questions: ${Array.isArray(questions) ? questions.length : 0}\n`;

    // Add learning objectives if available
    if (learningObjectives) {
      contextContent += `\nLEARNING OBJECTIVES:\n${learningObjectives}\n\n`;
    }

    // Add uploaded files information
    if (Array.isArray(fileUploaded) && fileUploaded.length > 0) {
      contextContent += `\nUPLOADED CONTENT FILES (${fileUploaded.length}):\n`;
      fileUploaded.forEach((file) => {
        contextContent += `- ${file.filename} (${file.size} bytes)\n`;
      });
      contextContent += "\n";
    }

    // Add current assignment structure
    contextContent += `\nASSIGNMENT STRUCTURE:\n`;
    contextContent += `- Introduction: ${
      introduction ? "Defined" : "Not defined"
    }\n`;
    contextContent += `- Instructions: ${
      instructions ? "Defined" : "Not defined"
    }\n`;
    contextContent += `- Grading Criteria: ${
      gradingCriteriaOverview ? "Defined" : "Not defined"
    }\n`;

    // Add question information
    if (Array.isArray(questions) && questions.length > 0) {
      contextContent += "\nQUESTIONS OVERVIEW:\n";

      // First list all questions in order
      contextContent += "Question List:\n";

      // Create a safe copy of questions
      const safeQuestions = [...questions].filter(
        (q) => q && typeof q === "object",
      );

      // Only try to sort if we have a valid questionOrder array
      const orderedQuestions =
        Array.isArray(questionOrder) && questionOrder.length > 0
          ? safeQuestions.sort((a, b) => {
              const aIndex = questionOrder.indexOf(a.id);
              const bIndex = questionOrder.indexOf(b.id);
              if (aIndex === -1) return 1;
              if (bIndex === -1) return -1;
              return aIndex - bIndex;
            })
          : safeQuestions;

      orderedQuestions.forEach((q, idx) => {
        const questionType = q.type || "Unknown";
        contextContent += `${idx + 1}. [ID: ${q.id}] ${
          q.question ? q.question.substring(0, 50) + "..." : "Untitled Question"
        } (${questionType})\n`;
      });

      // Then add detailed info for focused question (if any)
      if (currentQuestion) {
        contextContent += `\nCURRENT FOCUSED QUESTION:\n`;
        contextContent += `Question ID: ${currentQuestion.id}\n`;
        contextContent += `Type: ${currentQuestion.type}\n`;
        contextContent += `Points: ${currentQuestion.totalPoints || 0}\n`;
        contextContent += `Question Text: ${
          currentQuestion.question || "No question text"
        }\n`;

        // Add choices for multiple choice questions
        if (
          (currentQuestion.type === "SINGLE_CORRECT" ||
            currentQuestion.type === "MULTIPLE_CORRECT") &&
          currentQuestion.choices &&
          Array.isArray(currentQuestion.choices)
        ) {
          contextContent += "\nAnswer Choices:\n";
          currentQuestion.choices.forEach((choice, index) => {
            const correctMark = choice.isCorrect ? "✓" : "✗";
            contextContent += `${index + 1}. ${correctMark} ${
              choice.choice || "Empty choice"
            } (${choice.points || 0} points)\n`;
          });
        }

        // Add true/false info
        if (currentQuestion.type === "TRUE_FALSE") {
          contextContent += `\nTrue/False Answer: ${
            currentQuestion.answer ? "True" : "False"
          }\n`;
        }

        // Add rubrics info
        if (hasRubrics(currentQuestion)) {
          contextContent += "\nRubrics:\n";
          currentQuestion.scoring.rubrics.forEach((rubric, rIndex) => {
            contextContent += `Rubric ${rIndex + 1}: ${
              rubric.rubricQuestion || "No rubric question"
            }\n`;
            if (Array.isArray(rubric.criteria)) {
              rubric.criteria.forEach((criterion, cIndex) => {
                contextContent += `- Criterion ${cIndex + 1}: ${
                  criterion.description || "No description"
                } (${criterion.points || 0} points)\n`;
              });
            }
          });
        }

        // Add variant info
        if (currentQuestion.variants && currentQuestion.variants.length > 0) {
          contextContent += `\nQuestion has ${currentQuestion.variants.length} variants.\n`;
        }
      }
    }

    // Add author assistance guidelines
    contextContent += "\nAUTHOR CAPABILITIES:\n";
    contextContent +=
      "- Create new questions (multiple choice, text response, true/false, etc.)\n";
    contextContent += "- Modify existing questions\n";
    contextContent += "- Generate question variants\n";
    contextContent += "- Create or modify scoring rubrics\n";
    contextContent += "- Generate questions based on learning objectives\n";

    // Add behavioral guidelines
    contextContent += "\nREQUIRED BEHAVIOR:\n";
    contextContent +=
      "1. Follow instructional design best practices when helping with assignment creation\n";
    contextContent +=
      "2. Focus on creating clear, pedagogically sound questions\n";
    contextContent +=
      "3. Suggest improvements to question wording, answer choices, and rubrics\n";
    contextContent +=
      "4. Provide detailed explanations when generating content\n";
    contextContent +=
      "5. When suggesting questions, provide complete question text and answer options\n";
    contextContent +=
      "6. Use tools to implement changes when the author approves your suggestions\n";

    return {
      id: `system-context-${Date.now()}`,
      role: "system",
      content: contextContent,
    };
  }, [
    name,
    activeAssignmentId,
    questions,
    learningObjectives,
    fileUploaded,
    introduction,
    instructions,
    gradingCriteriaOverview,
    questionOrder,
    currentQuestion,
    hasRubrics,
  ]);

  // Get information about the current question
  const getCurrentQuestionInfo = useCallback(() => {
    if (!currentQuestion) return null;

    return {
      id: currentQuestion.id,
      type: currentQuestion.type,
      question: currentQuestion.question,
      totalPoints: currentQuestion.totalPoints,
      hasChoices: Boolean(
        currentQuestion.choices && currentQuestion.choices.length > 0,
      ),
      hasRubrics: hasRubrics(currentQuestion),
      hasVariants: Boolean(
        currentQuestion.variants && currentQuestion.variants.length > 0,
      ),
    };
  }, [currentQuestion, hasRubrics]);

  // Get information about all questions
  const getAllQuestionsInfo = useCallback(() => {
    if (!Array.isArray(questions)) return [];

    return questions.map((q) => ({
      id: q.id,
      type: q.type,
      question: q.question,
      totalPoints: q.totalPoints,
    }));
  }, [questions]);

  // Get generation capabilities
  const getGenerationCapabilities = useCallback(() => {
    return {
      canGenerateQuestions:
        (learningObjectives && learningObjectives.length > 0) ||
        (Array.isArray(fileUploaded) && fileUploaded.length > 0),
      hasLearningObjectives:
        learningObjectives && learningObjectives.length > 0,
      hasUploadedFiles: Array.isArray(fileUploaded) && fileUploaded.length > 0,
    };
  }, [learningObjectives, fileUploaded]);

  // Return an object with all the context data for use in API calls
  const getContextData = useCallback(() => {
    return {
      name,
      introduction,
      instructions,
      gradingCriteriaOverview,
      questions: Array.isArray(questions) ? questions : [],
      questionOrder: Array.isArray(questionOrder) ? questionOrder : [],
      activeAssignmentId,
      focusedQuestionId,
      learningObjectives,
      fileUploaded: Array.isArray(fileUploaded) ? fileUploaded : [],
      currentQuestion,
    };
  }, [
    name,
    introduction,
    instructions,
    gradingCriteriaOverview,
    questions,
    questionOrder,
    activeAssignmentId,
    focusedQuestionId,
    learningObjectives,
    fileUploaded,
    currentQuestion,
  ]);

  return {
    getContextMessage,
    getContextData,
    currentQuestion,
    getCurrentQuestionInfo,
    getAllQuestionsInfo,
    assignmentMeta,
    getGenerationCapabilities,
    activeAssignmentId,
    focusedQuestionId,
    forceUpdate,
  };
};
