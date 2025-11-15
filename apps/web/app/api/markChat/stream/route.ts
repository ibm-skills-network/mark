/* eslint-disable */
import { MarkChatService } from "../services/markChatService";
import {
  getAssignmentRubric,
  getQuestionDetails,
  requestRegrading,
  searchKnowledgeBase,
  submitFeedbackQuestion,
} from "@/app/chatbot/lib/markChatFunctions";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { z } from "zod";

const STANDARD_ERROR_MESSAGE =
  "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!";

function withErrorHandling(fn) {
  return async (...args) => {
    try {
      console.group(`Tool Execution: ${fn.name || "unknown"}`);
      const params = args[0] || {};
      const result = await fn(...args);
      console.groupEnd();

      if (!result || result === "" || result === undefined) {
        return STANDARD_ERROR_MESSAGE;
      }

      return result;
    } catch (error) {
      console.groupEnd();
      return `Error in ${fn.name || "function"}: ${error.message || STANDARD_ERROR_MESSAGE}`;
    }
  };
}

export function learnerTools(cookieHeader: string) {
  return {
    searchKnowledgeBase: {
      description: "Search knowledge base for platform info.",
      parameters: z.object({
        query: z.string().describe("Search query"),
      }),
      execute: withErrorHandling(async ({ query }) => {
        return await searchKnowledgeBase(query);
      }),
    },
    reportIssue: {
      description: "Report technical issue/bug. Extract from user message.",
      parameters: z.object({
        issueType: z.enum(["technical", "content", "grading", "other"]),
        description: z.string().describe("Issue details from user"),
        assignmentId: z.number().optional(),
        severity: z.enum(["info", "warning", "error", "critical"]).optional(),
      }),
      execute: async ({ issueType, description, assignmentId, severity }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            type: "report",
            issueType,
            description,
            assignmentId,
            severity: severity || "info",
            userRole: "learner",
            category: "Learner Issue",
          },
        });
      },
    },
    provideFeedback: {
      description: "Submit general feedback. Extract from user message.",
      parameters: z.object({
        feedbackType: z.enum([
          "general",
          "assignment",
          "grading",
          "experience",
        ]),
        description: z.string().describe("Feedback from user"),
        assignmentId: z.number().optional(),
        rating: z.number().min(1).max(5).optional().describe("1-5 stars"),
      }),
      execute: async ({ feedbackType, description, assignmentId, rating }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            type: "feedback",
            issueType: "FEEDBACK",
            description,
            assignmentId,
            rating,
            userRole: "learner",
            category: "Learner Feedback",
          },
        });
      },
    },
    submitSuggestion: {
      description: "Submit improvement suggestion. Extract from user message.",
      parameters: z.object({
        suggestionType: z.enum(["feature", "content", "ui", "general"]),
        description: z.string().describe("Suggestion from user"),
        assignmentId: z.number().optional(),
      }),
      execute: async ({ suggestionType, description, assignmentId }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            type: "suggestion",
            issueType: "SUGGESTION",
            description,
            assignmentId,
            userRole: "learner",
            category: "Learner Suggestion",
          },
        });
      },
    },
    submitInquiry: {
      description:
        "Submit general question/inquiry. Extract from user message.",
      parameters: z.object({
        inquiryType: z.enum(["general", "technical", "academic", "other"]),
        description: z.string().describe("Question from user"),
        assignmentId: z.number().optional(),
      }),
      execute: async ({ inquiryType, description, assignmentId }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            type: "inquiry",
            issueType: "OTHER",
            description,
            assignmentId,
            userRole: "learner",
            category: "Learner Inquiry",
          },
        });
      },
    },
    getQuestionDetails: {
      description:
        "ONLY use if question details are NOT in the context. Check FEEDBACK SUMMARY first - if question info is already there, DO NOT call this. Use this ONLY when you need additional details not available in the current context.",
      parameters: z.object({
        questionId: z.number().describe("Question ID"),
      }),
      execute: withErrorHandling(async ({ questionId }) => {
        return await getQuestionDetails(questionId);
      }),
    },
    getAssignmentRubric: {
      description: "Get rubric/grading criteria",
      parameters: z.object({
        assignmentId: z.number().describe("Assignment ID"),
      }),
      execute: withErrorHandling(async ({ assignmentId }) => {
        return await getAssignmentRubric(assignmentId);
      }),
    },
    submitFeedbackQuestion: {
      description: "Ask instructor about feedback",
      parameters: z.object({
        questionId: z.number().describe("Question ID"),
        feedbackQuery: z.string().describe("Question about feedback"),
      }),
      execute: withErrorHandling(async ({ questionId, feedbackQuery }) => {
        return await submitFeedbackQuestion(questionId, feedbackQuery);
      }),
    },
    requestRegrading: {
      description:
        "🚨 SINGLE CALL ONLY 🚨 This function must be called EXACTLY ONE TIME per learner request, even when multiple questions are mentioned. Submit regrading request with ALL question IDs in a single array parameter. If learner mentions 2 questions, extract both IDs and call ONCE with both. If learner mentions 5 questions, extract all 5 IDs and call ONCE with all 5. Example: Learner says 'questions 4 and 5' → Extract from FEEDBACK SUMMARY: 'Question #4 (ID:6827)' and 'Question #5 (ID:6828)' → Call requestRegrading ONCE with questionIds: [6827, 6828]. ❌ NEVER call this function multiple times (once per question). ❌ NEVER call with [6827] then call again with [6828]. ✅ ALWAYS call once with [6827, 6828]. This is a database operation that expects ONE request with multiple IDs, not multiple requests.",
      parameters: z.object({
        assignmentId: z.number().optional().describe("Assignment ID"),
        attemptId: z.number().optional().describe("Attempt ID"),
        reason: z
          .string()
          .describe(
            "Specific reason: facts, sources, rubric criteria. NOT vague.",
          ),
        questionIds: z
          .array(z.number())
          .optional()
          .describe(
            "🚨 CRITICAL: Array containing ALL question database IDs to regrade in this SINGLE call. If learner complains about N questions, this array must have N IDs. Examples: Learner mentions 1 question → [6827]. Learner mentions 2 questions → [6827, 6828]. Learner mentions 3 questions → [6827, 6828, 6829]. You will call requestRegrading function ONLY ONCE with this complete array. DO NOT call this function multiple times with single IDs. The backend expects ONE regrading request with multiple question IDs, not multiple requests with single IDs.",
          ),
      }),
      execute: withErrorHandling(
        async ({ assignmentId, attemptId, reason, questionIds }) => {
          return await requestRegrading(
            assignmentId,
            attemptId,
            reason,
            questionIds,
          );
        },
      ),
    },
  };
}

export function authorTools(cookieHeader: string) {
  return {
    createQuestion: {
      description:
        "Create a new question for the assignment with complete specifications",
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
      description:
        "Add a scoring rubric to a question (REQUIRED for text response questions)",
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
        "Report a technical issue or bug with the platform. Extract the user's issue description and use it to prefill the form.",
      parameters: z.object({
        issueType: z
          .enum(["technical", "content", "grading", "other"])
          .describe("The type of issue being reported"),
        description: z
          .string()
          .describe(
            "Detailed description of the issue - extract this from the user's message to prefill the form",
          ),
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
      execute: async ({ issueType, description, assignmentId, severity }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            issueType,
            description,
            assignmentId,
            severity: severity || "info",
            userRole: "author",
            category: "Author Issue",
          },
        });
      },
    },
    provideFeedback: {
      description:
        "Provide general feedback about the teaching experience or platform. Extract the user's feedback text and use it as the description to prefill the form.",
      parameters: z.object({
        feedbackType: z
          .enum(["general", "assignment", "grading", "experience"])
          .describe("The type of feedback being provided"),
        description: z
          .string()
          .describe(
            "Detailed feedback comments - extract this from the user's message to prefill the form",
          ),
        assignmentId: z
          .number()
          .optional()
          .describe(
            "The ID of the assignment (if feedback is assignment-specific)",
          ),
        rating: z
          .number()
          .min(1)
          .max(5)
          .optional()
          .describe("Optional rating from 1-5 stars"),
      }),
      execute: async ({ feedbackType, description, assignmentId, rating }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            type: "feedback",
            issueType: "FEEDBACK",
            description,
            assignmentId,
            rating,
            userRole: "author",
            category: "Author Feedback",
          },
        });
      },
    },
    submitSuggestion: {
      description:
        "Submit suggestions for improving the platform or teaching tools. Extract the user's suggestion text and use it as the description to prefill the form.",
      parameters: z.object({
        suggestionType: z
          .enum(["feature", "content", "ui", "general"])
          .describe("The type of suggestion being made"),
        description: z
          .string()
          .describe(
            "Detailed suggestion or improvement idea - extract this from the user's message to prefill the form",
          ),
        assignmentId: z
          .number()
          .optional()
          .describe(
            "The ID of the assignment (if suggestion is assignment-specific)",
          ),
      }),
      execute: async ({ suggestionType, description, assignmentId }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            type: "suggestion",
            issueType: "SUGGESTION",
            description,
            assignmentId,
            userRole: "author",
            category: "Author Suggestion",
          },
        });
      },
    },
    submitInquiry: {
      description:
        "Submit general question/inquiry. Extract from user message.",
      parameters: z.object({
        inquiryType: z.enum(["general", "technical", "academic", "other"]),
        description: z.string().describe("Question from user"),
        assignmentId: z.number().optional(),
      }),
      execute: async ({ inquiryType, description, assignmentId }) => {
        return JSON.stringify({
          clientExecution: true,
          function: "showReportPreview",
          params: {
            type: "inquiry",
            issueType: "OTHER",
            description,
            assignmentId,
            userRole: "author",
            category: "Author Inquiry",
          },
        });
      },
    },
  };
}

function generateSystemPrompt(userRole, assignmentInfo) {
  const assignmentMode = assignmentInfo?.mode || "unknown";
  const isSubmitted = assignmentInfo?.submitted === true;
  const assignmentId = assignmentInfo?.assignmentId;

  const systemPrompts = {
    author: `You are Mark, an AI helping instructors create educational content.

ACTIONS: Create/modify questions, set choices, add rubrics, generate variants, delete questions, update objectives.

PROACTIVE BEHAVIOR:
- Spot & fix: missing rubrics, incomplete questions, unclear instructions
- Suggest improvements when questions are focused
- Monitor for: text questions without rubrics (REQUIRED), MC with <4 options, ambiguous T/F, missing points

QUESTION CREATION RULES:
- Text questions: MUST add rubric (3-4 criteria minimum)
- MC: 4-5 options, clear correct/incorrect
- Always include: clear text, points (default 10), complete specs
- For multiple questions: offer to create as set

TOOL PRIORITY: createQuestion → addRubric (for text) → verify result → suggest next steps
${assignmentId ? `\nAlways use assignmentId: ${assignmentId}` : ""}

STYLE: Conversational, proactive, confirm actions, celebrate progress.`,

    learner: `You are Mark, an AI tutor. Educator first, assistant second.

${
  assignmentMode === "practice"
    ? `PRACTICE MODE - Full Help:
✅ Provide direct answers + thorough explanations
✅ Step-by-step solutions with WHY
✅ Analogies, examples, alternative approaches
✅ Explain incorrect options (MC)
✅ Follow-up questions to verify understanding

Flow: Concept → Steps → Answer → Reasoning → Check understanding`
    : assignmentMode === "graded"
      ? `GRADED MODE - ${isSubmitted ? "SUBMITTED" : "NOT SUBMITTED"}

${
  !isSubmitted
    ? `❌ CANNOT: Give answers, hints, step-by-step, evaluate solutions, parallel examples
✅ CAN: Clarify wording, define terms, point to materials, explain format, help with tech

Template: "I'm here to clarify questions or help with tech, but can't solve graded work. What needs clarification?"`
    : `✅ NOW I CAN: Full explanations, show alternatives, explain your approach, help learn from mistakes

REGRADING:
You have access to ALL questions in the FEEDBACK SUMMARY above. Use Question IDs from context.

Require specific reasoning before submitting. Push back on vague complaints.

❌ Reject: "I think it's right", "seems wrong", "unfair"
✅ Accept: Facts/sources cited, rubric references, logical arguments with specifics

QUESTION IDENTIFICATION:
⚠️ CRITICAL: When learner says "Question 5", they mean Question #5 in the list, NOT database ID 5!
- Context shows: "Question #5 (ID:123)" - USE 123 as the questionId, NOT 5
- "Question 5" → Find "Question #5 (ID:xxx)" in FEEDBACK SUMMARY → use xxx
- "Questions 5 and 7" → Find "#5 (ID:a)" and "#7 (ID:b)" → use [a, b]
- Content reference → Match question text → extract that question's ID from (ID:xxx)
- DON'T ask for confirmation - auto-extract from FEEDBACK SUMMARY's (ID:xxx) format

Process:
1. Vague complaint → Ask: "Explain specifically why you should get more credit. Cite facts, sources, or rubric criteria."
2. Still vague → Push back: "Need concrete reasoning: facts from material, rubric criteria, or specific grading errors."
3. Clear reasoning → Extract IDs from FEEDBACK SUMMARY → Submit & ALWAYS share result

Example:
"I think it's right" → Ask for specifics
"My SQL answer was correct" → Find SQL in FEEDBACK SUMMARY → Extract its ID
"Questions 5 and 7 wrong per ch3" → Find #5 (ID:a) and #7 (ID:b) → Call requestRegrading ONCE with questionIds: [a, b]

⚠️ NEVER CALL requestRegrading MULTIPLE TIMES! If learner mentions N questions, call ONCE with array of N IDs.`
}`
      : `UNKNOWN MODE: General concepts only, no specific answers.`
}

TOOLS:
- requestRegrading: ⚠️ CRITICAL - CALL EXACTLY ONCE with ALL question IDs in a single array
  * Learner mentions multiple questions → Extract ALL IDs from FEEDBACK SUMMARY → Call ONCE with [id1, id2, ...]
  * ❌ WRONG: Call twice with [id1], then [id2]
  * ✅ RIGHT: Call once with [id1, id2]
  * After clear reasoning only, share result
- getQuestionDetails, getAssignmentRubric, searchKnowledgeBase
- submitFeedbackQuestion (no regrade), reportIssue (tech), provideFeedback, submitSuggestion, submitInquiry
${assignmentId ? `\nAlways use assignmentId: ${assignmentId}` : ""}

STYLE: Warm, clear, encouraging. End with question/next step. Sparse emojis (🌟✨💡).`,
  };

  return systemPrompts[userRole] || "";
}

export async function POST(req) {
  try {
    const body = await req.json();
    const cookieHeader = req.headers.get("cookie") || "";
    const { userRole, userText, conversation, userId, chatId } = body;

    if (!userRole || !userText || !conversation) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    let currentChatId = chatId;
    let newChatCreated = false;

    const systemContextMessages = conversation.filter(
      (msg) => msg.role === "system" && msg.id?.includes("context"),
    );

    const assignmentInfo = systemContextMessages.find(
      (msg) => msg.role === "system" && msg.id?.includes("context"),
    );

    let assignmentMode = "unknown";
    let isSubmitted = false;

    if (assignmentInfo?.content) {
      if (assignmentInfo.content.includes("Type: Graded assignment")) {
        assignmentMode = "graded";
        isSubmitted =
          assignmentInfo.content.includes("Student Status: PASSED") ||
          assignmentInfo.content.includes("MODE: FEEDBACK ANALYSIS");
      } else if (assignmentInfo.content.includes("Type: Practice assignment")) {
        assignmentMode = "practice";
      }
    }

    if (!currentChatId && userId) {
      try {
        const { getOrCreateTodayChat } = await import(
          "../services/markChatService"
        );

        const assignmentId =
          userRole === "learner"
            ? parseInt(assignmentInfo?.assignmentId || "0")
            : undefined;

        const chat = await getOrCreateTodayChat(userId, assignmentId);
        currentChatId = chat.id;
        newChatCreated = !chat.messages || chat.messages.length === 0;

        if (currentChatId) {
          const { addMessageToChat } = await import(
            "../services/markChatService"
          );
          await addMessageToChat(currentChatId, "USER", userText, undefined);
        }
      } catch (error) {}
    }

    const regularMessages = conversation.filter(
      (msg) => msg.role !== "system" || !msg.id?.includes("context"),
    );

    const formattedMessages = [
      ...regularMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: "user", content: userText },
    ];

    let trackedClientExecutions = [];
    const tools =
      userRole === "author"
        ? authorTools(cookieHeader)
        : learnerTools(cookieHeader);

    try {
      const systemPrompt = generateSystemPrompt(userRole, {
        mode: assignmentMode,
        submitted: isSubmitted,
        assignmentId:
          userRole === "learner"
            ? parseInt(assignmentInfo?.assignmentId || "0")
            : undefined,
      });

      const result = await streamText({
        model: openai("gpt-4o-mini"),
        system:
          systemPrompt +
          (systemContextMessages.length > 0
            ? "\n\n" +
              systemContextMessages.map((msg) => msg.content).join("\n\n")
            : ""),
        messages: formattedMessages,
        temperature: 0.7,
        tools: tools,
        toolChoice: "auto",
        maxSteps: 5,
        maxTokens: 1500,
        onStepFinish: (result) => {
          if (result.toolCalls && result.toolCalls.length > 0) {
            console.group(
              `Tool calls in this step: ${result.toolCalls.length}`,
            );

            const clientExecutionRequests = [];

            result.toolCalls.forEach((call) => {
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

            if (clientExecutionRequests.length > 0) {
              trackedClientExecutions.push(...clientExecutionRequests);
            }
          }
        },
      });

      if (!result || !result.textStream) {
        throw new Error("Failed to generate response from AI model");
      }

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();

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

          const toolResults = (await result.toolResults) || [];

          for (const toolResult of toolResults) {
            if (toolResult && toolResult.result) {
              try {
                const parsedResult = JSON.parse(toolResult.result);
                if (
                  parsedResult.clientExecution &&
                  parsedResult.function === "showReportPreview"
                ) {
                  trackedClientExecutions.push({
                    function: parsedResult.function,
                    params: parsedResult.params,
                  });
                } else {
                  if (!fullContent.includes(toolResult.result)) {
                    const toolResponse = `\n\n${toolResult.result}`;
                    fullContent += toolResponse;
                    await writer.write(new TextEncoder().encode(toolResponse));
                  }
                }
              } catch (e) {
                if (!fullContent.includes(toolResult.result)) {
                  const toolResponse = `\n\n${toolResult.result}`;
                  fullContent += toolResponse;
                  await writer.write(new TextEncoder().encode(toolResponse));
                }
              }
            }
          }

          if (trackedClientExecutions.length > 0) {
            const marker = `\n\n<!-- CLIENT_EXECUTION_MARKER
${JSON.stringify(trackedClientExecutions)}
-->`;
            fullContent += marker;
            await writer.write(new TextEncoder().encode(marker));
          }

          if (currentChatId && userId) {
            try {
              const { addMessageToChat } = await import(
                "../services/markChatService"
              );
              await addMessageToChat(
                currentChatId,
                "ASSISTANT",
                fullContent,
                trackedClientExecutions.length > 0
                  ? trackedClientExecutions
                  : undefined,
              );
            } catch (error) {}
          }

          await writer.close();
        } catch (error) {
          await writer.abort(error);
        }
      })();

      return new Response(readable, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Content-Type-Options": "nosniff",
          "X-Chat-ID": currentChatId || "",
          "X-Chat-Created": newChatCreated ? "true" : "false",
          "X-Assignment-Mode": assignmentMode,
          "X-Assignment-Submitted": isSubmitted ? "true" : "false",
        },
      });
    } catch (aiError) {
      return new Response(STANDARD_ERROR_MESSAGE, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  } catch (error) {
    return new Response(STANDARD_ERROR_MESSAGE, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
