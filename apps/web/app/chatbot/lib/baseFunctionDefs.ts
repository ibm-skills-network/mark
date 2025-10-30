const commonFunctions = [
  {
    name: "searchKnowledgeBase",
    description:
      "Search the knowledge base for information about the platform or features",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to find relevant information",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "reportIssue",
    description: "Report a technical issue or bug with the platform",
    parameters: {
      type: "object",
      properties: {
        issueType: {
          type: "string",
          enum: ["technical", "content", "grading", "other"],
          description: "The type of issue being reported",
        },
        description: {
          type: "string",
          description: "Detailed description of the issue",
        },
        assignmentId: {
          type: "number",
          description:
            "The ID of the assignment where the issue was encountered (if applicable)",
        },
      },
      required: ["issueType", "description"],
    },
  },
];

const learnerFunctions = [
  {
    name: "getQuestionDetails",
    description:
      "Get detailed information about a specific question in the assignment",
    parameters: {
      type: "object",
      properties: {
        questionId: {
          type: "number",
          description: "The ID of the question to retrieve details for",
        },
      },
      required: ["questionId"],
    },
  },
  {
    name: "getAssignmentRubric",
    description: "Get the rubric or grading criteria for the assignment",
    parameters: {
      type: "object",
      properties: {
        assignmentId: {
          type: "number",
          description: "The ID of the assignment",
        },
      },
      required: ["assignmentId"],
    },
  },
  {
    name: "submitFeedbackQuestion",
    description:
      "Submit a question about feedback that requires instructor attention",
    parameters: {
      type: "object",
      properties: {
        questionId: {
          type: "number",
          description: "The ID of the question being asked about",
        },
        feedbackQuery: {
          type: "string",
          description: "The specific question or concern about the feedback",
        },
      },
      required: ["questionId", "feedbackQuery"],
    },
  },
  {
    name: "requestRegrading",
    description: "Submit a formal request for regrading an assignment",
    parameters: {
      type: "object",
      properties: {
        assignmentId: {
          type: "number",
          description: "The ID of the assignment to be regraded",
        },
        attemptId: {
          type: "number",
          description: "The ID of the attempt to be regraded",
        },
        reason: {
          type: "string",
          description: "The reason for requesting regrading",
        },
      },
      required: ["assignmentId", "reason"],
    },
  },
];

const authorFunctions = [
  {
    name: "createQuestion",
    description: "Create a new question for an assignment",
    parameters: {
      type: "object",
      properties: {
        assignmentId: {
          type: "number",
          description: "The ID of the assignment to add the question to",
        },
        questionType: {
          type: "string",
          enum: [
            "TEXT",
            "SINGLE_CORRECT",
            "MULTIPLE_CORRECT",
            "TRUE_FALSE",
            "URL",
            "UPLOAD",
          ],

          description: "The type of question to create",
        },
        questionText: {
          type: "string",
          description: "The text of the question",
        },
        totalPoints: {
          type: "number",
          description: "The number of points the question is worth",
        },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              isCorrect: { type: "boolean" },
            },
          },
          description: "For multiple choice questions, the answer options",
        },
      },
      required: ["questionType", "questionText"],
    },
  },
  {
    name: "generateQuestionVariant",
    description: "Generate a variant of an existing question",
    parameters: {
      type: "object",
      properties: {
        questionId: {
          type: "number",
          description: "The ID of the question to create a variant for",
        },
        variantType: {
          type: "string",
          enum: ["REWORDED", "REPHRASED"],
          description: "The type of variant to create",
        },
      },
      required: ["questionId", "variantType"],
    },
  },
  {
    name: "publishAssignment",
    description: "Publish an assignment to make it available to learners",
    parameters: {
      type: "object",
      properties: {
        assignmentId: {
          type: "number",
          description: "The ID of the assignment to publish",
        },
      },
      required: ["assignmentId"],
    },
  },
  {
    name: "generateQuestionsFromContent",
    description:
      "Generate questions based on provided content or learning objectives",
    parameters: {
      type: "object",
      properties: {
        assignmentId: {
          type: "number",
          description: "The ID of the assignment to add questions to",
        },
        learningObjectives: {
          type: "string",
          description: "The learning objectives for the questions",
        },
        numberOfQuestions: {
          type: "number",
          description: "The number of questions to generate",
        },
        questionTypes: {
          type: "array",
          items: {
            type: "string",
            enum: ["TEXT", "SINGLE_CORRECT", "MULTIPLE_CORRECT", "TRUE_FALSE"],
          },
          description: "The types of questions to generate",
        },
      },
      required: ["assignmentId", "learningObjectives"],
    },
  },
];

export const functionDefinitions = [
  ...commonFunctions,
  ...learnerFunctions,
  ...authorFunctions,
];
