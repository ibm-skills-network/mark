/* eslint-disable */
import { authorTools, learnerTools } from "./stream/route";
import { searchKnowledgeBase } from "@/app/chatbot/lib/markChatFunctions";
import { getBaseApiPath } from "@/config/constants";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

const commonTools = {
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
        return "I couldn't search the knowledge base due to an error. Please try again.";
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
          "The ID of the assignment where the issue was encountered (if applicable)",
        ),
    }),
    execute: async ({ issueType, description, assignmentId }) => {
      try {
      } catch (error) {
        return "I couldn't report the issue due to an error. Please try again.";
      }
    },
  },
};

const FALLBACK_SOURCE_HEADER = "x-mark-chat-fallback";
const BACKEND_SOURCE_HEADER = "x-mark-chat-backend";
const USER_SESSION_CACHE_TTL_MS = 30_000;
const userSessionCache = new Map<
  string,
  {
    value: { userId: string; assignmentId?: number; cookie?: string };
    expiresAt: number;
  }
>();

function fallbackJson(
  data: Record<string, any>,
  init?: Parameters<typeof NextResponse.json>[1],
) {
  const headers = new Headers(init?.headers);
  headers.set(FALLBACK_SOURCE_HEADER, "web");
  return NextResponse.json({ ...data, fallback: "web" }, { ...init, headers });
}

function getUserSessionHeader(req: NextRequest): string | null {
  const directHeader = req.headers.get("user-session");
  if (directHeader) return directHeader;

  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;

  const sessionCookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("userSession="));

  if (!sessionCookie) return null;

  const value = sessionCookie.split("=").slice(1).join("=");
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseUserId(userSessionHeader: string | null): string | null {
  if (!userSessionHeader) return null;
  try {
    const parsed = JSON.parse(userSessionHeader) as { userId?: string };
    return parsed.userId || null;
  } catch {
    return null;
  }
}

function parseAssignmentId(userSessionHeader: string | null): number | null {
  if (!userSessionHeader) return null;
  try {
    const parsed = JSON.parse(userSessionHeader) as { assignmentId?: number };
    return typeof parsed.assignmentId === "number" ? parsed.assignmentId : null;
  } catch {
    return null;
  }
}

async function resolveUserSession(req: NextRequest): Promise<{
  userId: string;
  assignmentId?: number;
  header?: string;
  cookie?: string;
} | null> {
  const userSessionHeader = getUserSessionHeader(req);
  const cookieHeader = req.headers.get("cookie") || "";

  if (userSessionHeader) {
    const userId = parseUserId(userSessionHeader);
    if (!userId) return null;
    return {
      userId,
      assignmentId: parseAssignmentId(userSessionHeader) || undefined,
      header: userSessionHeader,
    };
  }

  const cacheKey = cookieHeader;
  const cached = cacheKey ? userSessionCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return {
      userId: cached.value.userId,
      assignmentId: cached.value.assignmentId,
      cookie: cached.value.cookie,
    };
  }

  try {
    const res = await fetch(`${getBaseApiPath("v1")}/user-session`, {
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
    });

    if (!res.ok) return null;
    const data = (await res.json()) as {
      userId?: string;
      assignmentId?: number;
    };
    if (!data.userId) return null;
    const resolved = {
      userId: data.userId,
      assignmentId: data.assignmentId,
      cookie: cookieHeader || undefined,
    };
    if (cacheKey) {
      userSessionCache.set(cacheKey, {
        value: resolved,
        expiresAt: Date.now() + USER_SESSION_CACHE_TTL_MS,
      });
    }
    return resolved;
  } catch {
    return null;
  }
}

async function callBackendChat(
  req: NextRequest,
  payload: { userRole: string; userText: string; conversation: any[] },
): Promise<{
  reply: string;
  chatId?: string;
  functionResults?: any[];
  functionCalled?: boolean;
} | null> {
  const session = await resolveUserSession(req);
  if (!session?.userId) return null;

  const assignmentId = session.assignmentId;
  const baseApiPath = getBaseApiPath("v1");
  const authHeaders = session.header
    ? { "user-session": session.header }
    : session.cookie
      ? { Cookie: session.cookie }
      : {};

  try {
    const chatRes = await fetch(`${baseApiPath}/chats/today`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ userId: session.userId, assignmentId }),
    });

    if (!chatRes.ok) {
      return null;
    }

    const chatData = (await chatRes.json()) as { id?: string };
    if (!chatData.id) return null;

    const respondRes = await fetch(
      `${baseApiPath}/chats/${chatData.id}/respond`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify(payload),
      },
    );

    if (!respondRes.ok) {
      return null;
    }

    const responseData = (await respondRes.json()) as {
      reply?: string;
      functionResults?: any[];
      functionCalled?: boolean;
    };
    if (!responseData.reply) return null;

    return {
      reply: responseData.reply,
      chatId: chatData.id,
      functionResults: responseData.functionResults,
      functionCalled: responseData.functionCalled,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userRole, userText, conversation } = body;

    if (!userRole || !userText || !conversation) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const backendResult = await callBackendChat(req, {
      userRole,
      userText,
      conversation,
    });

    if (backendResult) {
      return NextResponse.json(
        {
          reply: backendResult.reply,
          source: "backend",
          chatId: backendResult.chatId,
          functionResults: backendResult.functionResults,
          functionCalled: backendResult.functionCalled,
        },
        {
          headers: {
            [BACKEND_SOURCE_HEADER]: "true",
          },
        },
      );
    }

    const systemPrompts = {
      author: `You are Mark, an AI assistant for assignment authors on an educational platform. Follow these rules:
1. Focus on helping authors create high-quality educational content and assessments
2. Use tools ONLY for: generating/modifying questions, publishing, or data operations
3. For general questions about pedagogy or website features, answer directly
4. Provide guidance on instructional design best practices
5. Suggest ways to improve question clarity and effectiveness
6. Never use tools for casual conversation or general information requests`,

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

    const systemContextMessages = conversation.filter(
      (msg: any) => msg.role === "system" && msg.id?.includes("context"),
    );

    const regularMessages = conversation.filter(
      (msg: any) => msg.role !== "system" || !msg.id?.includes("context"),
    );

    const messages = [
      {
        role: "system",
        content:
          systemPrompts[userRole] +
          (systemContextMessages.length > 0
            ? "\n\n" +
              systemContextMessages.map((msg: any) => msg.content).join("\n\n")
            : ""),
      },
      ...regularMessages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: "user", content: userText },
    ];

    const tools =
      userRole === "learner"
        ? [
            {
              type: "function",
              function: {
                name: "getQuestionDetails",
                description:
                  "Get detailed information about a specific question in the assignment",
                parameters: {
                  type: "object",
                  properties: {
                    questionId: {
                      type: "number",
                      description:
                        "The ID of the question to retrieve details for",
                    },
                  },
                  required: ["questionId"],
                },
              },
            },
            {
              type: "function",
              function: {
                name: "getAssignmentRubric",
                description:
                  "Get the rubric or grading criteria for the assignment",
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
            },
            {
              type: "function",
              function: {
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
                      description:
                        "The specific question or concern about the feedback",
                    },
                  },
                  required: ["questionId", "feedbackQuery"],
                },
              },
            },
            {
              type: "function",
              function: {
                name: "requestRegrading",
                description:
                  "Submit a formal request for regrading an assignment",
                parameters: {
                  type: "object",
                  properties: {
                    assignmentId: {
                      type: "number",
                      description: "The ID of the assignment to be regraded",
                      optional: true,
                    },
                    attemptId: {
                      type: "number",
                      description: "The ID of the attempt to be regraded",
                      optional: true,
                    },
                    reason: {
                      type: "string",
                      description: "The reason for requesting regrading",
                    },
                  },
                  required: ["reason"],
                },
              },
            },
            {
              type: "function",
              function: {
                name: "reportIssue",
                description:
                  "Report a technical issue or bug with the platform",
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
                      optional: true,
                    },
                  },
                  required: ["issueType", "description"],
                },
              },
            },
          ]
        : [
            {
              type: "function",
              function: {
                name: "createQuestion",
                description: "Create a new question for an assignment",
                parameters: {
                  type: "object",
                  properties: {
                    assignmentId: {
                      type: "number",
                      description:
                        "The ID of the assignment to add the question to",
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
                      optional: true,
                    },
                  },
                  required: ["assignmentId", "questionType", "questionText"],
                },
              },
            },
            {
              type: "function",
              function: {
                name: "generateQuestionVariant",
                description: "Generate a variant of an existing question",
                parameters: {
                  type: "object",
                  properties: {
                    questionId: {
                      type: "number",
                      description:
                        "The ID of the question to create a variant for",
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
            },
            {
              type: "function",
              function: {
                name: "publishAssignment",
                description:
                  "Publish an assignment to make it available to learners",
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
            },
            {
              type: "function",
              function: {
                name: "generateQuestionsFromContent",
                description:
                  "Generate questions based on provided content or learning objectives",
                parameters: {
                  type: "object",
                  properties: {
                    assignmentId: {
                      type: "number",
                      description:
                        "The ID of the assignment to add questions to",
                    },
                    learningObjectives: {
                      type: "string",
                      description: "The learning objectives for the questions",
                    },
                    numberOfQuestions: {
                      type: "number",
                      description: "The number of questions to generate",
                      optional: true,
                    },
                    questionTypes: {
                      type: "array",
                      items: { type: "string" },
                      description: "The types of questions to generate",
                      optional: true,
                    },
                  },
                  required: ["assignmentId", "learningObjectives"],
                },
              },
            },
            {
              type: "function",
              function: {
                name: "reportIssue",
                description:
                  "Report a technical issue or bug with the platform",
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
                      optional: true,
                    },
                  },
                  required: ["issueType", "description"],
                },
              },
            },
          ];

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools: tools.map((tool) => tool.function),
      tool_choice: "auto",
      temperature: 0.7,
      max_tokens: 1500,
    });

    const choice = response.choices[0];
    if (!choice) {
      return fallbackJson({ reply: "No response from AI." });
    }

    if (choice.finish_reason === "tool_calls") {
      const toolCalls = choice.message.tool_calls;
      if (toolCalls) {
        const functionResults = await Promise.all(
          toolCalls.map(async (toolCall) => {
            const functionName = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments);
            try {
              const result =
                (await commonTools[functionName]?.execute(args)) ||
                (await (userRole === "learner"
                  ? learnerTools[functionName]?.execute(args)
                  : authorTools[functionName]?.execute(args)));

              return {
                tool_call_id: toolCall.id,
                function_name: functionName,
                result,
              };
            } catch (error) {
              return {
                tool_call_id: toolCall.id,
                function_name: functionName,
                result: "An error occurred while processing the function call.",
              };
            }
          }),
        );

        return fallbackJson({
          reply: choice.message.content || "Function call processed.",
          functionResults,
          functionCalled: true,
        });
      }
    }

    const reply = choice.message?.content || "No content.";
    return fallbackJson({ reply });
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
