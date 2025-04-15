import {
  addRubric,
  createQuestion,
  deleteQuestion,
  generateQuestionsFromObjectives,
  generateQuestionVariant,
  modifyQuestion,
  setQuestionChoices,
  setQuestionTitle,
  updateLearningObjectives,
} from "@/app/chatbot/lib/authorFunctions";
import {
  getAssignmentRubric,
  getQuestionDetails,
  reportIssue,
  requestRegrading,
  searchKnowledgeBase,
  submitFeedbackQuestion,
} from "@/app/chatbot/lib/markChatFunctions";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
/* eslint-disable */ import { NextRequest } from "next/server";
import { z } from "zod";

// Standard error message
const STANDARD_ERROR_MESSAGE =
  "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!";

// Higher-order function to wrap all function executions with error handling
function withErrorHandling(fn) {
  return async (...args) => {
    try {
      const result = await fn(...args);
      return result;
    } catch (error) {
      console.error(`Error in function ${fn.name || "unknown"}:`, error);
      return new Response(
        "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
        {
          status: 200, // Using 200 status is important so frontend displays it
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        }
      );
    }
  };
}

// Define tools with error handling
export const commonTools = {
  searchKnowledgeBase: {
    description:
      "Search the knowledge base for information about the platform or features",
    parameters: z.object({
      query: z
        .string()
        .describe("The search query to find relevant information"),
    }),
    execute: async ({ query }) => {
      try {
        return await searchKnowledgeBase(query);
      } catch (error) {
        console.error("Error searching knowledge base:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
    },
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
          "The ID of the assignment where the issue was encountered (if applicable)"
        ),
    }),
    execute: async ({ issueType, description, assignmentId }) => {
      try {
        return await reportIssue(issueType, description, assignmentId);
      } catch (error) {
        console.error("Error reporting issue:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
    },
  },
};

// Set up author-specific tools with error handling
export const authorTools = {
  ...commonTools,
  createQuestion: {
    description: "Create a new question for an assignment",
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
      options: z
        .array(
          z.object({
            text: z.string().describe("The text of the option"),
            isCorrect: z.boolean().describe("Whether this option is correct"),
            points: z.number().optional().describe("Points for this option"),
          })
        )
        .optional()
        .describe("For multiple choice questions, the answer options"),
    }),
    execute: async ({ questionType, questionText, totalPoints, options }) => {
      try {
        return await createQuestion(
          questionType,
          questionText,
          totalPoints || 10,
          options
        );
      } catch (error) {
        console.error("Error creating question:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
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
    }),
    execute: async ({
      questionId,
      questionText,
      totalPoints,
      questionType,
    }) => {
      try {
        return await modifyQuestion(
          questionId,
          questionText,
          totalPoints,
          questionType
        );
      } catch (error) {
        console.error("Error modifying question:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
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
          })
        )
        .describe("The choices for the question"),
      variantId: z
        .number()
        .optional()
        .describe("The ID of the variant if applicable"),
    }),
    execute: async ({ questionId, choices, variantId }) => {
      try {
        return await setQuestionChoices(questionId, choices, variantId);
      } catch (error) {
        console.error("Error setting question choices:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
    },
  },
  addRubric: {
    description: "Add a rubric to a question",
    parameters: z.object({
      questionId: z.number().describe("The ID of the question"),
      rubricQuestion: z.string().describe("The text of the rubric question"),
      criteria: z
        .array(
          z.object({
            description: z.string().describe("Description of the criterion"),
            points: z.number().describe("Points for this criterion"),
          })
        )
        .describe("The criteria for the rubric"),
    }),
    execute: async ({ questionId, rubricQuestion, criteria }) => {
      try {
        return await addRubric(questionId, rubricQuestion, criteria);
      } catch (error) {
        console.error("Error adding rubric:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
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
    execute: async ({ questionId, variantType }) => {
      try {
        return await generateQuestionVariant(questionId, variantType);
      } catch (error) {
        console.error("Error generating question variant:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
    },
  },
  deleteQuestion: {
    description: "Delete a question from the assignment",
    parameters: z.object({
      questionId: z.number().describe("The ID of the question to delete"),
    }),
    execute: async ({ questionId }) => {
      try {
        return await deleteQuestion(questionId);
      } catch (error) {
        console.error("Error deleting question:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
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
        .describe("The types of questions to generate"),
      count: z.number().describe("The number of questions to generate"),
    }),
    execute: async ({ learningObjectives, questionTypes, count }) => {
      try {
        return await generateQuestionsFromObjectives(
          learningObjectives,
          questionTypes,
          count
        );
      } catch (error) {
        console.error("Error generating questions from objectives:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
    },
  },
  updateLearningObjectives: {
    description: "Update the learning objectives for the assignment",
    parameters: z.object({
      learningObjectives: z
        .string()
        .describe("The updated learning objectives"),
    }),
    execute: async ({ learningObjectives }) => {
      try {
        return await updateLearningObjectives(learningObjectives);
      } catch (error) {
        console.error("Error updating learning objectives:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
    },
  },
  setQuestionTitle: {
    description: "Set the title (question text) for a question",
    parameters: z.object({
      questionId: z.number().describe("The ID of the question"),
      title: z.string().describe("The title/text of the question"),
    }),
    execute: async ({ questionId, title }) => {
      try {
        return await setQuestionTitle(questionId, title);
      } catch (error) {
        console.error("Error setting question title:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
    },
  },
};
export // Set up learner-specific tools with error handling
const learnerTools = {
  ...commonTools,
  getQuestionDetails: {
    description:
      "Get detailed information about a specific question in the assignment",
    parameters: z.object({
      questionId: z
        .number()
        .describe("The ID of the question to retrieve details for"),
    }),
    execute: async ({ questionId }) => {
      try {
        return await getQuestionDetails(questionId);
      } catch (error) {
        console.error("Error getting question details:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
    },
  },
  getAssignmentRubric: {
    description: "Get the rubric or grading criteria for the assignment",
    parameters: z.object({
      assignmentId: z.number().describe("The ID of the assignment"),
    }),
    execute: async ({ assignmentId }) => {
      try {
        return await getAssignmentRubric(assignmentId);
      } catch (error) {
        console.error("Error getting assignment rubric:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
    },
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
    execute: async ({ questionId, feedbackQuery }) => {
      try {
        return await submitFeedbackQuestion(questionId, feedbackQuery);
      } catch (error) {
        console.error("Error submitting feedback question:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
    },
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
    execute: async ({ assignmentId, attemptId, reason }) => {
      try {
        return await requestRegrading(assignmentId, attemptId, reason);
      } catch (error) {
        console.error("Error requesting regrading:", error);
        return new Response(
          "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!",
          {
            status: 200, // Using 200 status is important so frontend displays it
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          }
        );
      }
    },
  },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userRole, userText, conversation } = body;

    if (!userRole || !userText || !conversation) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Extract system context messages
    const systemContextMessages = conversation.filter(
      (msg: any) => msg.role === "system" && msg.id?.includes("context")
    );

    // Regular conversation messages
    const regularMessages = conversation.filter(
      (msg: any) => msg.role !== "system" || !msg.id?.includes("context")
    );

    // Format messages for the AI API
    const formattedMessages = [
      ...regularMessages.map((msg: any) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content,
      })),
      { role: "user" as const, content: userText },
    ];

    // System prompts
    const systemPrompts = {
      author: `You are Mark, an AI assistant for assignment authors on an educational platform. Follow these rules:
1. Focus on helping authors create high-quality educational content and assessments
2. Use tools ONLY for: generating/modifying questions, publishing, or data operations
3. For general questions about pedagogy or website features, answer directly
4. Provide guidance on instructional design best practices
5. Suggest ways to improve question clarity and effectiveness
6. Never use tools for casual conversation or general information requests

IMPORTANT CAPABILITIES:
- You can help authors create new questions of various types
- You can modify existing questions or generate variants
- You can create and edit rubrics for assessment
- You can generate questions based on learning objectives
- You can help authors improve their assessment designs`,

      learner: `You are Mark, an AI assistant for learners on an educational platform. Follow these rules:
1. Your primary goal is to support the learner's understanding and academic progress
2. For practice assignments: provide detailed explanations, hints, and step-by-step guidance
3. For graded assignments: offer conceptual guidance without giving direct answers
4. When reviewing feedback: help students understand their assessment results and how to improve
5. Always be encouraging, supportive, and clear in your explanations
6. Answer ONLY questions related to the assignment context provided
7. If the learner asks about unrelated topics, politely redirect them to the assignment
8. Use tools ONLY when specifically needed for technical operations

IMPORTANT CAPABILITIES:
- You can help learners request regrading if they believe their assessment was scored incorrectly
- You can help learners report technical issues or concerns with the platform
- You have access to the current assignment context including questions, responses, and feedback`,
    };

    // Error tracking
    let hasToolsError = false;

    // Try to execute the AI response
    try {
      const result = streamText({
        model: openai("gpt-4o-mini"),
        system:
          systemPrompts[userRole] +
          (systemContextMessages.length > 0
            ? "\n\n" +
              systemContextMessages.map((msg: any) => msg.content).join("\n\n")
            : ""),
        messages: formattedMessages,
        temperature: 0.7,
        tools: userRole === "learner" ? learnerTools : authorTools,
        toolChoice: "auto",
        maxTokens: 1500,
        onError: (event) => {
          console.error("AI stream error:", event.error);
          hasToolsError = true;
        },
        onStepFinish: (result) => {
          if (result.toolCalls.length > 0) {
            console.log(`Tool calls in this step: ${result.toolCalls.length}`);
            result.toolCalls.forEach((call) => {
              console.log(
                `Tool called: ${call.toolName}, Args: ${JSON.stringify(
                  call.args
                )}`
              );
            });
          }
        },
      });

      // Check if there was an error during tool execution
      if (hasToolsError) {
        // Return the predefined error message for consistency
        return new Response(STANDARD_ERROR_MESSAGE, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        });
      }

      // No errors, return the normal stream
      return result.toTextStreamResponse({
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      // Handle AI stream errors by returning the error message
      console.error("AI streaming error:", error);
      return new Response(STANDARD_ERROR_MESSAGE, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }
  } catch (error) {
    // Handle general request errors
    console.error("API route error:", error);
    return new Response(STANDARD_ERROR_MESSAGE, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
