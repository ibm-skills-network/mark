/* eslint-disable */
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

// Import the MarkChatService
import { MarkChatService } from "../services/markChatService";
import {
  getAssignmentRubric,
  getQuestionDetails,
  requestRegrading,
  searchKnowledgeBase,
  submitFeedbackQuestion,
} from "@/app/chatbot/lib/markChatFunctions";

// Standard error message - only used when there's an actual error
const STANDARD_ERROR_MESSAGE =
  "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!";

// Higher-order function with error handling for functions
function withErrorHandling(fn) {
  return async (...args) => {
    try {
      console.group(`Tool Execution: ${fn.name || "unknown"}`);
      console.log("Arguments:", args);

      // Extract the first argument which contains all parameters
      const params = args[0] || {};
      console.log("Parameter object:", params);

      // Execute the function and capture the result
      const result = await fn(...args);
      console.log("Result:", result);
      console.groupEnd();

      // Only return STANDARD_ERROR_MESSAGE if result is empty or undefined
      if (!result) {
        return STANDARD_ERROR_MESSAGE;
      }

      return result;
    } catch (error) {
      console.error(`Error in function ${fn.name || "unknown"}:`, error);
      console.groupEnd();
      return `Error in ${fn.name || "function"}: ${error.message || STANDARD_ERROR_MESSAGE}`;
    }
  };
}

// Set up learner-specific tools
export const learnerTools = {
  searchKnowledgeBase: {
    description:
      "Search the knowledge base for information about the platform or features",
    parameters: z.object({
      query: z
        .string()
        .describe("The search query to find relevant information"),
    }),
    execute: withErrorHandling(async ({ query }) => {
      return await searchKnowledgeBase(query);
    }),
  },
  reportIssue: {
    description:
      "Report a technical issue or bug or suggestions with the platform",
    parameters: z.object({
      issueType: z
        .enum(["technical", "content", "grading", "other", "suggestion"])
        .describe("The type of issue being reported"),
      description: z.string().describe("Detailed description of the issue"),
      assignmentId: z
        .number()
        .optional()
        .describe(
          "The ID of the assignment where the issue was encountered (if applicable)",
        ),
    }),
    execute: withErrorHandling(
      async ({ issueType, description, assignmentId }) => {
        // use markChatService to report the issue
        return MarkChatService.reportIssue(issueType, description, {
          assignmentId,
          userRole: "learner",
          severity: "info",
          category: "Learner Issue",
        });
      },
    ),
  },
  getQuestionDetails: {
    description:
      "Get detailed information about a specific question in the assignment",
    parameters: z.object({
      questionId: z
        .number()
        .describe("The ID of the question to retrieve details for"),
    }),
    execute: withErrorHandling(async ({ questionId }) => {
      return await getQuestionDetails(questionId);
    }),
  },
  getAssignmentRubric: {
    description: "Get the rubric or grading criteria for the assignment",
    parameters: z.object({
      assignmentId: z.number().describe("The ID of the assignment"),
    }),
    execute: withErrorHandling(async ({ assignmentId }) => {
      return await getAssignmentRubric(assignmentId);
    }),
  },
  submitFeedbackQuestion: {
    description:
      "Submit a question about feedback that requires instructor attention",
    parameters: z.object({
      questionId: z
        .number()
        .describe("The ID of the question being asked about"),
      feedbackQuery: z
        .string()
        .describe("The specific question or concern about the feedback"),
    }),
    execute: withErrorHandling(async ({ questionId, feedbackQuery }) => {
      return await submitFeedbackQuestion(questionId, feedbackQuery);
    }),
  },
  requestRegrading: {
    description: "Submit a formal request for regrading an assignment",
    parameters: z.object({
      assignmentId: z
        .number()
        .optional()
        .describe("The ID of the assignment to be regraded"),
      attemptId: z
        .number()
        .optional()
        .describe("The ID of the attempt to be regraded"),
      reason: z.string().describe("The reason for requesting regrading"),
    }),
    execute: withErrorHandling(async ({ assignmentId, attemptId, reason }) => {
      const result = await requestRegrading(assignmentId, attemptId, reason);
      return result;
    }),
  },
};

// Set up author tools that return client execution data
export const authorTools = {
  createQuestion: {
    description: "Create a new question for the assignment",
    parameters: z.object({
      questionType: z
        .enum([
          "TEXT",
          "SINGLE_CORRECT",
          "MULTIPLE_CORRECT",
          "TRUE_FALSE",
          "URL",
          "UPLOAD",
        ])
        .describe("The type of question to create"),
      questionText: z.string().describe("The text of the question"),
      totalPoints: z
        .number()
        .optional()
        .describe("The number of points the question is worth"),
      feedback: z.string().optional().describe("Feedback for the question"),
      options: z
        .array(
          z.object({
            text: z.string().describe("The text of the option"),
            isCorrect: z.boolean().describe("Whether this option is correct"),
            points: z.number().optional().describe("Points for this option"),
          }),
        )
        .optional()
        .describe("For multiple choice questions, the answer options"),
    }),
    execute: async (params) => {
      return JSON.stringify({
        clientExecution: true,
        function: "createQuestion",
        params,
      });
    },
  },
  modifyQuestion: {
    description: "Modify an existing question",
    parameters: z.object({
      questionId: z.number().describe("The ID of the question to modify"),
      questionText: z
        .string()
        .optional()
        .describe("The updated text of the question"),
      totalPoints: z
        .number()
        .optional()
        .describe("The updated number of points"),
      questionType: z
        .string()
        .optional()
        .describe("The updated type of the question"),
      feedback: z.string().optional().describe("Feedback for the question"),
    }),
    execute: async (params) => {
      return JSON.stringify({
        clientExecution: true,
        function: "modifyQuestion",
        params,
      });
    },
  },
  setQuestionChoices: {
    description: "Set the choices for a multiple choice question",
    parameters: z.object({
      questionId: z.number().describe("The ID of the question"),
      choices: z
        .array(
          z.object({
            text: z.string().describe("The text of the choice"),
            isCorrect: z.boolean().describe("Whether this choice is correct"),
            points: z.number().optional().describe("Points for this choice"),
            feedback: z
              .string()
              .optional()
              .describe("Feedback for this choice"),
          }),
        )
        .describe("The choices for the question"),
      variantId: z
        .number()
        .optional()
        .describe("The ID of the variant if applicable"),
    }),
    execute: async (params) => {
      return JSON.stringify({
        clientExecution: true,
        function: "setQuestionChoices",
        params,
      });
    },
  },
  addRubric: {
    description: "Add a scoring rubric to a question",
    parameters: z.object({
      questionId: z.number().describe("The ID of the question"),
      rubricQuestion: z.string().describe("The text of the rubric question"),
      criteria: z
        .array(
          z.object({
            description: z.string().describe("Description of the criterion"),
            points: z.number().describe("Points for this criterion"),
          }),
        )
        .describe("The criteria for the rubric"),
    }),
    execute: async (params) => {
      return JSON.stringify({
        clientExecution: true,
        function: "addRubric",
        params,
      });
    },
  },
  generateQuestionVariant: {
    description: "Generate a variant of an existing question",
    parameters: z.object({
      questionId: z
        .number()
        .describe("The ID of the question to create a variant for"),
      variantType: z
        .enum(["REWORDED", "REPHRASED"])
        .describe("The type of variant to create"),
    }),
    execute: async (params) => {
      return JSON.stringify({
        clientExecution: true,
        function: "generateQuestionVariant",
        params,
      });
    },
  },
  deleteQuestion: {
    description: "Delete a question from the assignment",
    parameters: z.object({
      questionId: z.number().describe("The ID of the question to delete"),
    }),
    execute: async (params) => {
      return JSON.stringify({
        clientExecution: true,
        function: "deleteQuestion",
        params,
      });
    },
  },
  generateQuestionsFromObjectives: {
    description: "Generate questions based on learning objectives",
    parameters: z.object({
      learningObjectives: z
        .string()
        .describe("The learning objectives to generate questions from"),
      questionTypes: z
        .array(z.string())
        .optional()
        .describe("The types of questions to generate"),
      count: z
        .number()
        .optional()
        .describe("The number of questions to generate"),
    }),
    execute: async (params) => {
      return JSON.stringify({
        clientExecution: true,
        function: "generateQuestionsFromObjectives",
        params,
      });
    },
  },
  updateLearningObjectives: {
    description: "Update the learning objectives for the assignment",
    parameters: z.object({
      learningObjectives: z
        .string()
        .describe("The updated learning objectives"),
    }),
    execute: async (params) => {
      return JSON.stringify({
        clientExecution: true,
        function: "updateLearningObjectives",
        params,
      });
    },
  },
  setQuestionTitle: {
    description: "Set the title for a question",
    parameters: z.object({
      questionId: z.number().describe("The ID of the question"),
      title: z.string().describe("The title of the question"),
    }),
    execute: async (params) => {
      return JSON.stringify({
        clientExecution: true,
        function: "setQuestionTitle",
        params,
      });
    },
  },

  // Include common functions for authors too
  searchKnowledgeBase: {
    description:
      "Search the knowledge base for information about the platform or features",
    parameters: z.object({
      query: z
        .string()
        .describe("The search query to find relevant information"),
    }),
    execute: withErrorHandling(async ({ query }) => {
      return await searchKnowledgeBase(query);
    }),
  },
  reportIssue: {
    description: "Report a technical issue or bug with the platform",
    parameters: z.object({
      issueType: z
        .enum(["technical", "content", "grading", "other"])
        .describe("The type of issue being reported"),
      description: z.string().describe("Detailed description of the issue"),
      assignmentId: z
        .number()
        .optional()
        .describe(
          "The ID of the assignment where the issue was encountered (if applicable)",
        ),
      severity: z
        .enum(["info", "warning", "error", "critical"])
        .optional()
        .describe("The severity of the issue"),
    }),
    execute: withErrorHandling(
      async ({ issueType, description, assignmentId, severity }) => {
        // use markChatService to report the issue
        return MarkChatService.reportIssue(issueType, description, {
          assignmentId,
          userRole: "author",
          severity,
          category: "Author Issue",
        });
      },
    ),
  },
};
export async function POST(req) {
  try {
    const body = await req.json();
    const { userRole, userText, conversation } = body;

    if (!userRole || !userText || !conversation) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Enhanced system prompts with role-specific instructions
    const systemPrompts = {
      author: `You are Mark, an AI assistant for assignment authors on an educational platform. Your primary purpose is to help instructors create high-quality educational content through direct action.

CAPABILITIES:
- Create new questions of any type (multiple choice, text response, true/false, etc.)
- Modify existing questions by updating text, points, or type
- Set up answer choices for multiple choice questions
- Add and modify rubrics for assessment
- Generate question variants to provide diversity
- Delete questions when needed
- Generate questions based on learning objectives
- Provide instructional design advice

ACTION GUIDELINES:
1. Be proactive - if a user mentions creating or changing content, offer to do it for them
2. When suggesting improvements, offer to implement them immediately
3. For question creation, provide complete specifications and execute the creation
4. Always use the appropriate tool for content operations
5. Explain your actions before and after using tools
6. For complex operations, break them down into multiple tool calls
7. Verify results after making changes

TOOL USAGE:
- Use createQuestion for adding new questions
- Use modifyQuestion for updating question content
- Use setQuestionChoices for multiple choice options
- Use addRubric for scoring criteria
- Use generateQuestionVariant for creating variations
- Use deleteQuestion for removing questions
- Use generateQuestionsFromObjectives for AI-generated content
- Use updateLearningObjectives for curriculum planning
- Use reportIssue to report any problems with the platform

RESPONSE STYLE:
- Be concise but informative
- Provide complete examples when making suggestions
- Confirm operations after they're completed
- Suggest follow-up actions after completing requests`,

      learner: `You are Mark, an AI assistant for learners on an educational platform. Follow these rules:
1. Your primary goal is to support the learner's understanding and academic progress
2. For practice assignments: provide detailed explanations, hints, and step-by-step guidance
4. When reviewing feedback: help students understand their assessment results and how to improve
5. Always be encouraging, supportive, and clear in your explanations
6. Answer ONLY questions related to the assignment context provided
7. If the learner asks about unrelated topics, politely redirect them to the assignment
8. Use tools ONLY when specifically needed for technical operations

IMPORTANT GUIDELINES FOR GRADED ASSIGNMENTS:
- If the assignment was not submitted yet, DO NOT PROVIDE DIRECT ANSWERS OR DETAILED EXPLANATIONS. INSTEAD, OFFER HIGH-LEVEL FEEDBACK. DONT PROVIDE ANY HINT OF THE ANSWER, OR WHETHER THE LEARNER ANSWERED CORRECTLY OR INCORRECTLY. 
- **Do NOT provide direct answers or detailed explanations of each option.**
- **Do NOT provide any breakdown that reveals how to reach a correct answer.**
- Instead, offer very brief, high-level feedback. For example, simply confirm whether the concept is correct or advise to review the rubric without detailing the pros and cons of individual choices.
- Keep your response minimal: a short statement such as "Based on the assignment rubric, your answer does not align with the requirements. Please review the concepts further." is sufficient.
- If assignment was submitted, provide detailed explanations and hints to help the learner understand the concepts better.

TOOL USAGE:
- Use searchKnowledgeBase to find information about the platform
- Use reportIssue to report technical issues or bugs
- Use getQuestionDetails to get more information about a specific question
- Use getAssignmentRubric to get the rubric for the current assignment
- Use submitFeedbackQuestion when the learner has a specific question about their feedback
- Use requestRegrading to submit a formal regrading request`,
    };

    // Extract any system context messages for additional information
    const systemContextMessages = conversation.filter(
      (msg) => msg.role === "system" && msg.id?.includes("context"),
    );

    // Regular conversation messages (exclude system context)
    const regularMessages = conversation.filter(
      (msg) => msg.role !== "system" || !msg.id?.includes("context"),
    );

    // Format messages for the AI SDK
    const formattedMessages = [
      ...regularMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: "user", content: userText },
    ];

    // Track client-side execution requests
    let trackedClientExecutions = [];

    try {
      // Use the streamText function from the AI SDK
      const result = await streamText({
        model: openai("gpt-4o-mini"),
        system:
          systemPrompts[userRole] +
          (systemContextMessages.length > 0
            ? "\n\n" +
              systemContextMessages.map((msg) => msg.content).join("\n\n")
            : ""),
        messages: formattedMessages,
        temperature: 0.7,
        tools: userRole === "learner" ? learnerTools : authorTools, // Use role-specific tools
        toolChoice: "auto",
        maxTokens: 1500,
        onStepFinish: (result) => {
          if (result.toolCalls && result.toolCalls.length > 0) {
            console.group(
              `Tool calls in this step: ${result.toolCalls.length}`,
            );

            // Track client-side execution requests
            const clientExecutionRequests = [];

            // Log each tool call for debugging
            result.toolCalls.forEach((call, index) => {
              // For author-specific actions, prepare client execution data
              if (
                userRole === "author" &&
                [
                  "createQuestion",
                  "modifyQuestion",
                  "setQuestionChoices",
                  "addRubric",
                  "generateQuestionVariant",
                  "deleteQuestion",
                  "generateQuestionsFromObjectives",
                  "updateLearningObjectives",
                  "setQuestionTitle",
                ].includes(call.toolName)
              ) {
                clientExecutionRequests.push({
                  function: call.toolName,
                  params: call.args,
                });
              }
            });

            console.groupEnd();

            // If client execution requests are needed, add them to tracking
            if (clientExecutionRequests.length > 0) {
              // Will be added to the stream at the end
              trackedClientExecutions.push(...clientExecutionRequests);
            }
          }
        },
      });

      if (!result || !result.textStream) {
        throw new Error("Failed to generate response from AI model");
      }

      // Create a transform stream to add client execution markers
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();

      // Process the stream and add markers
      (async () => {
        try {
          const reader = result.textStream.getReader();
          let fullContent = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            fullContent += value;
            await writer.write(new TextEncoder().encode(value));
          }

          // Add client execution markers at the end if needed
          if (trackedClientExecutions.length > 0 && userRole === "author") {
            const marker = `\n\n<!-- CLIENT_EXECUTION_MARKER
${JSON.stringify(trackedClientExecutions)}
-->`;
            await writer.write(new TextEncoder().encode(marker));
          }

          await writer.close();
        } catch (error) {
          console.error("Error processing stream:", error);
          await writer.abort(error);
        }
      })();

      // Return the transformed stream
      return new Response(readable, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (aiError) {
      console.error("AI streaming error:", aiError);
      // Return the standard error message for AI errors
      return new Response(STANDARD_ERROR_MESSAGE, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  } catch (error) {
    console.error("Mark Chat Stream error:", error);

    // Return the standard error message for any top-level errors
    return new Response(STANDARD_ERROR_MESSAGE, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
