import {
  Choice,
  Criteria,
  QuestionType,
  QuestionVariants,
  Rubric,
  Scoring,
} from "@/config/types";
/* eslint-disable */ import { useAuthorStore } from "@/stores/author";

// Create a new question in the assignment
async function createQuestion(
  questionType: string,
  questionText: string,
  totalPoints: number,
  options?: any[]
): Promise<string> {
  const authorStore = useAuthorStore.getState();
  const activeAssignmentId = authorStore.activeAssignmentId;

  if (!activeAssignmentId) {
    return "Cannot create question: No active assignment. Please save the assignment first.";
  }

  try {
    // Create ID for the new question
    // In a real implementation, this would be handled by the backend
    const newQuestionId =
      Math.max(0, ...authorStore.questions.map((q) => q.id || 0)) + 1;

    // Convert questionType string to the actual enum value
    const validQuestionType = questionType as QuestionType;

    // Create base question structure
    const newQuestion = {
      id: newQuestionId,
      type: validQuestionType,
      question: questionText,
      totalPoints: totalPoints || 10,
      assignmentId: activeAssignmentId,
      variants: [],
    };

    // Add choices if provided and question type is compatible
    if (
      options &&
      ["SINGLE_CORRECT", "MULTIPLE_CORRECT"].includes(validQuestionType)
    ) {
      const choices = options.map((option, index) => ({
        choice: option.text || "",
        isCorrect: option.isCorrect || false,
        points:
          option.points ||
          (validQuestionType === "MULTIPLE_CORRECT"
            ? option.isCorrect
              ? 1
              : -1
            : 0),
      }));
      Object.assign(newQuestion, { choices });
    }

    // Add scoring structure
    const scoring: Scoring = {
      type: "CRITERIA_BASED",
      rubrics: [],
      showRubricsToLearner: true,
    };
    Object.assign(newQuestion, { scoring });

    // Add the question to the store
    authorStore.addQuestion(newQuestion);

    // Add to question order if needed
    if (!authorStore.questionOrder.includes(newQuestionId)) {
      authorStore.setQuestionOrder([
        ...authorStore.questionOrder,
        newQuestionId,
      ]);
    }

    return `Successfully created a new ${questionType} question with ID ${newQuestionId}. The question has been added to your assignment.`;
  } catch (error) {
    console.error("Error creating question:", error);
    return "Failed to create question due to an error. Please try again.";
  }
}

// Modify an existing question
async function modifyQuestion(
  questionId: number,
  questionText?: string,
  totalPoints?: number,
  questionType?: string
): Promise<string> {
  const authorStore = useAuthorStore.getState();

  try {
    // Check if question exists
    const questionExists = authorStore.questions.some(
      (q) => q.id === questionId
    );
    if (!questionExists) {
      return `Question with ID ${questionId} not found.`;
    }

    // Create modification object
    const modification: any = {};
    if (questionText !== undefined) modification.question = questionText;
    if (totalPoints !== undefined) modification.totalPoints = totalPoints;
    if (questionType !== undefined) modification.type = questionType;

    // Apply modifications
    authorStore.modifyQuestion(questionId, modification);

    return `Successfully modified question ${questionId}.`;
  } catch (error) {
    console.error("Error modifying question:", error);
    return `Failed to modify question ${questionId} due to an error.`;
  }
}

// Set question choices for multiple choice questions
async function setQuestionChoices(
  questionId: number,
  choices: { text: string; isCorrect: boolean; points?: number }[],
  variantId?: number
): Promise<string> {
  const authorStore = useAuthorStore.getState();

  try {
    // Verify question exists
    const question = authorStore.questions.find((q) => q.id === questionId);
    if (!question) {
      return `Question with ID ${questionId} not found.`;
    }

    // Verify question type is compatible with choices
    if (
      !["SINGLE_CORRECT", "MULTIPLE_CORRECT"].includes(question.type as string)
    ) {
      return `Cannot set choices for question type ${question.type}. Only SINGLE_CORRECT and MULTIPLE_CORRECT questions support choices.`;
    }

    // Format choices for the store
    const formattedChoices = choices.map((choice) => ({
      choice: choice.text,
      isCorrect: choice.isCorrect,
      points:
        choice.points !== undefined
          ? choice.points
          : question.type === "MULTIPLE_CORRECT"
          ? choice.isCorrect
            ? 1
            : -1
          : 0,
    }));

    // Update question choices
    authorStore.setChoices(questionId, formattedChoices, variantId);

    return `Successfully updated choices for question ${questionId}${
      variantId ? ` variant ${variantId}` : ""
    }.`;
  } catch (error) {
    console.error("Error setting question choices:", error);
    return `Failed to update choices for question ${questionId} due to an error.`;
  }
}

// Add rubric to question
async function addRubric(
  questionId: number,
  rubricQuestion: string,
  criteria: { description: string; points: number }[]
): Promise<string> {
  const authorStore = useAuthorStore.getState();

  try {
    // Verify question exists
    const question = authorStore.questions.find((q) => q.id === questionId);
    if (!question) {
      return `Question with ID ${questionId} not found.`;
    }

    // Add rubric to question
    authorStore.addOneRubric(questionId);

    // Get latest rubric index
    const scoring = question.scoring || { type: "CRITERIA_BASED", rubrics: [] };
    const rubricIndex = (scoring.rubrics?.length || 1) - 1;

    // Set rubric question text
    if (rubricQuestion) {
      authorStore.setRubricQuestionText(
        questionId,
        0,
        rubricIndex,
        rubricQuestion
      );
    }

    // Add criteria if provided
    if (criteria && criteria.length > 0) {
      const formattedCriteria = criteria.map((criterion, index) => ({
        id: index + 1,
        description: criterion.description,
        points: criterion.points,
      }));

      authorStore.setCriterias(questionId, rubricIndex, formattedCriteria);
    }

    return `Successfully added rubric to question ${questionId}.`;
  } catch (error) {
    console.error("Error adding rubric:", error);
    return `Failed to add rubric to question ${questionId} due to an error.`;
  }
}

// Generate question variant
async function generateQuestionVariant(
  questionId: number,
  variantType: string
): Promise<string> {
  const authorStore = useAuthorStore.getState();

  try {
    // Verify question exists
    const question = authorStore.questions.find((q) => q.id === questionId);
    if (!question) {
      return `Question with ID ${questionId} not found.`;
    }

    // Generate a new variant ID
    const variantId =
      Math.max(0, ...question.variants.map((v) => v.id || 0)) + 1;

    // Create variant object
    const newVariant: QuestionVariants = {
      id: variantId,
      questionId: questionId,
      type: question.type,
      variantContent: question.question, // Starting with the same content
      choices: question.choices,
      scoring: question.scoring,
      createdAt: new Date().toISOString(),
      variantType: variantType as any, // REWORDED or REPHRASED
      randomizedChoices: question.randomizedChoices,
    };

    // Add variant to question
    authorStore.addVariant(questionId, newVariant);

    return `Successfully created ${variantType.toLowerCase()} variant for question ${questionId}. You can now edit this variant.`;
  } catch (error) {
    console.error("Error generating question variant:", error);
    return `Failed to generate variant for question ${questionId} due to an error.`;
  }
}

// Delete question
async function deleteQuestion(questionId: number): Promise<string> {
  const authorStore = useAuthorStore.getState();

  try {
    // Verify question exists
    const questionExists = authorStore.questions.some(
      (q) => q.id === questionId
    );
    if (!questionExists) {
      return `Question with ID ${questionId} not found.`;
    }

    // Delete question
    authorStore.removeQuestion(questionId);

    // Update question order
    const updatedOrder = authorStore.questionOrder.filter(
      (id) => id !== questionId
    );
    authorStore.setQuestionOrder(updatedOrder);

    return `Successfully deleted question ${questionId}.`;
  } catch (error) {
    console.error("Error deleting question:", error);
    return `Failed to delete question ${questionId} due to an error.`;
  }
}

// Generate questions from learning objectives
async function generateQuestionsFromObjectives(
  learningObjectives: string,
  questionTypes: string[],
  count: number
): Promise<string> {
  const authorStore = useAuthorStore.getState();

  try {
    if (!learningObjectives.trim()) {
      return `Cannot generate questions: No learning objectives provided. Please add learning objectives to your assignment.`;
    }

    // In a real implementation, this would call an AI endpoint
    // For now we just simulate the generation by creating placeholder questions
    let generatedCount = 0;
    const questionIds: number[] = [];

    // Get starting ID for new questions
    const startId =
      Math.max(0, ...authorStore.questions.map((q) => q.id || 0)) + 1;

    // Generate questions based on learning objectives
    for (let i = 0; i < count; i++) {
      // Cycle through question types
      const qType = questionTypes[i % questionTypes.length] as QuestionType;

      // Create a question ID
      const qId = startId + i;

      // Create base question structure
      const newQuestion = {
        id: qId,
        type: qType,
        question: `Generated question ${
          i + 1
        } based on learning objectives (type: ${qType})`,
        totalPoints: 10,
        assignmentId: authorStore.activeAssignmentId || 0,
        variants: [],
      };

      // Add question-type specific properties
      if (qType === "SINGLE_CORRECT" || qType === "MULTIPLE_CORRECT") {
        const choices = [
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
        Object.assign(newQuestion, { choices });
      }

      if (qType === "TRUE_FALSE") {
        Object.assign(newQuestion, { answer: true });
      }

      // Add scoring structure
      const scoring: Scoring = {
        type: "CRITERIA_BASED",
        rubrics: [],
        showRubricsToLearner: true,
      };
      Object.assign(newQuestion, { scoring });

      // Add the question to the store
      authorStore.addQuestion(newQuestion);
      questionIds.push(qId);
      generatedCount++;
    }

    // Update question order
    authorStore.setQuestionOrder([
      ...authorStore.questionOrder,
      ...questionIds,
    ]);

    return `Successfully generated ${generatedCount} questions based on your learning objectives. The questions have been added to your assignment.`;
  } catch (error) {
    console.error("Error generating questions from objectives:", error);
    return `Failed to generate questions due to an error. Please try again.`;
  }
}

// Update learning objectives
async function updateLearningObjectives(
  learningObjectives: string
): Promise<string> {
  const authorStore = useAuthorStore.getState();

  try {
    authorStore.setLearningObjectives(learningObjectives);
    return `Successfully updated learning objectives.`;
  } catch (error) {
    console.error("Error updating learning objectives:", error);
    return `Failed to update learning objectives due to an error.`;
  }
}

// Set question title (shortcut for modifyQuestion for title only)
async function setQuestionTitle(
  questionId: number,
  title: string
): Promise<string> {
  const authorStore = useAuthorStore.getState();

  try {
    authorStore.setQuestionTitle(title, questionId);
    return `Successfully updated title for question ${questionId}.`;
  } catch (error) {
    console.error("Error setting question title:", error);
    return `Failed to update title for question ${questionId} due to an error.`;
  }
}

// Export all functions for use with the AI SDK
export {
  createQuestion,
  modifyQuestion,
  setQuestionChoices,
  addRubric,
  generateQuestionVariant,
  deleteQuestion,
  generateQuestionsFromObjectives,
  updateLearningObjectives,
  setQuestionTitle,
};
