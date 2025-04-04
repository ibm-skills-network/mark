/* eslint-disable */
import { useAuthorStore, useQuestionStore } from "@/stores/author";
import { useEffect, useState } from "react";
import { shallow } from "zustand/shallow";

type ContextMessage = {
  id: string;
  role: "system";
  content: string;
};

/**
 * A hook that provides comprehensive assignment context for the Mark chatbot when in author mode
 */
export const useAuthorContext = () => {
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
    }),
    shallow,
  );

  // Get question states from question store
  const questionStates = useQuestionStore((state) => state.questionStates);

  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [assignmentMeta, setAssignmentMeta] = useState<{
    name: string;
    questionCount: number;
    hasLearningObjectives: boolean;
    hasFocusedQuestion: boolean;
    hasUploadedFiles: boolean;
  } | null>(null);

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
    }
  }, [questions, focusedQuestionId]);

  // Update assignment metadata
  useEffect(() => {
    setAssignmentMeta({
      name: name || "Untitled Assignment",
      questionCount: questions.length,
      hasLearningObjectives: Boolean(
        learningObjectives && learningObjectives.trim() !== "",
      ),
      hasFocusedQuestion: Boolean(focusedQuestionId),
      hasUploadedFiles: fileUploaded.length > 0,
    });
  }, [
    name,
    questions.length,
    learningObjectives,
    focusedQuestionId,
    fileUploaded,
  ]);

  // Check if a question has rubrics defined
  const hasRubrics = (question: any): boolean => {
    return question?.scoring?.rubrics && question.scoring.rubrics.length > 0;
  };

  // Generate a comprehensive context message for the current state
  const getContextMessage = async (): Promise<ContextMessage> => {
    let contextContent = "MARK ASSISTANT CONTEXT (AUTHOR MODE):\n\n";

    // Add basic assignment info
    contextContent += `Assignment: ${name || "Untitled Assignment"}\n`;
    contextContent += `Assignment ID: ${
      activeAssignmentId || "Not saved yet"
    }\n`;
    contextContent += `Number of Questions: ${questions.length}\n`;

    // Add learning objectives if available
    if (learningObjectives) {
      contextContent += `\nLEARNING OBJECTIVES:\n${learningObjectives}\n\n`;
    }

    // Add uploaded files information
    if (fileUploaded.length > 0) {
      contextContent += `\nUPLOADED CONTENT FILES (${fileUploaded.length}):\n`;
      fileUploaded.forEach((file, index) => {
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
    if (questions.length > 0) {
      contextContent += "\nQUESTIONS OVERVIEW:\n";

      // First list all questions in order
      contextContent += "Question List:\n";

      const orderedQuestions = [...questions].sort((a, b) => {
        const aIndex = questionOrder.indexOf(a.id);
        const bIndex = questionOrder.indexOf(b.id);
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });

      orderedQuestions.forEach((q, idx) => {
        const questionType = q.type || "Unknown";
        contextContent += `${idx + 1}. [ID: ${q.id}] ${
          q.question ? q.question.substring(0, 50) + "..." : "Untitled Question"
        } (${questionType})\n`;
      });

      // Then add detailed info for focused question (if any)
      if (focusedQuestionId && currentQuestion) {
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
          currentQuestion.choices.forEach((choice: any, index: number) => {
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
          currentQuestion.scoring.rubrics.forEach(
            (rubric: any, rIndex: number) => {
              contextContent += `Rubric ${rIndex + 1}: ${
                rubric.rubricQuestion || "No rubric question"
              }\n`;
              rubric.criteria.forEach((criterion: any, cIndex: number) => {
                contextContent += `- Criterion ${cIndex + 1}: ${
                  criterion.description || "No description"
                } (${criterion.points || 0} points)\n`;
              });
            },
          );
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
  };

  // Get information about the current question
  const getCurrentQuestionInfo = () => {
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
  };

  // Get information about all questions
  const getAllQuestionsInfo = () => {
    return questions.map((q) => ({
      id: q.id,
      type: q.type,
      question: q.question,
      totalPoints: q.totalPoints,
    }));
  };

  // Get generation capabilities
  const getGenerationCapabilities = () => {
    return {
      canGenerateQuestions:
        learningObjectives.length > 0 || fileUploaded.length > 0,
      hasLearningObjectives: learningObjectives.length > 0,
      hasUploadedFiles: fileUploaded.length > 0,
    };
  };

  return {
    getContextMessage,
    currentQuestion,
    getCurrentQuestionInfo,
    getAllQuestionsInfo,
    assignmentMeta,
    getGenerationCapabilities,
    activeAssignmentId,
    focusedQuestionId,
  };
};
