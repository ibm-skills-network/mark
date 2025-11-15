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
      "ONLY use if question details are NOT in the context. Check FEEDBACK SUMMARY first - if question info is already there, DO NOT call this. Use this ONLY when you need additional details not available in the current context.",
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
    description:
      "Submit ONE regrading request with ALL question IDs. CRITICAL: Learner says 'questions 4 and 5' → Look in FEEDBACK SUMMARY for 'Question #4 (ID:6827)' and 'Question #5 (ID:6828)' → Call ONCE with questionIds: [6827, 6828]. DO NOT call this function multiple times! Submit ONE request with ALL IDs together.",
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
          description:
            "Specific reason: facts, sources, rubric criteria. NOT vague.",
        },
        questionIds: {
          type: "array",
          items: {
            type: "number",
          },
          description:
            "REQUIRED: Put ALL database IDs in this single array. Example: Learner mentions 'questions 4 and 5' → Find 'Question #4 (ID:6827)' and 'Question #5 (ID:6828)' in FEEDBACK SUMMARY → Use [6827, 6828] in ONE request. NEVER split into multiple requests!",
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
