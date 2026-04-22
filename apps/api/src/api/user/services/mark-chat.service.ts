/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { openai } from "@ai-sdk/openai";
import { BadRequestException, Injectable } from "@nestjs/common";
import { CoreMessage, generateText, streamText } from "ai";
import { Response } from "express";
import { UserSession } from "src/auth/interfaces/user.session.interface";
import { z } from "zod";

type MarkChatRole = "system" | "user" | "assistant";

interface MarkChatMessage {
  role: MarkChatRole;
  content: string;
  id?: string;
}

interface MarkChatRequest {
  userRole: "author" | "learner";
  userText: string;
  conversation: MarkChatMessage[];
}

const STANDARD_ERROR_MESSAGE =
  "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!";

function withErrorHandling<TArguments extends any[], TResult>(
  function_: (...arguments_: TArguments) => Promise<TResult>,
) {
  return async (...arguments_: TArguments) => {
    try {
      const result = await function_(...arguments_);
      if (!result || result === "" || result === undefined) {
        return STANDARD_ERROR_MESSAGE;
      }
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : STANDARD_ERROR_MESSAGE;
      return `Error in ${function_.name || "function"}: ${message}`;
    }
  };
}

@Injectable()
export class MarkChatService {
  async respond(
    _chatId: string,
    request: MarkChatRequest,
    userSession: UserSession,
  ): Promise<{
    reply: string;
    functionResults?: {
      tool_call_id: string;
      function_name: string;
      result: any;
    }[];
    functionCalled?: boolean;
  }> {
    const { userRole, userText, conversation } = request;

    if (!userRole || !userText || !conversation) {
      throw new BadRequestException("Missing required fields");
    }

    const { systemPrompt, systemContextMessages, assignmentInfo } =
      this.getSystemPromptParts(userRole, conversation);

    const formattedMessages = this.formatMessages(conversation, userText);
    const tools =
      userRole === "author"
        ? this.authorTools()
        : this.learnerTools(userSession, assignmentInfo);

    const result = await generateText({
      model: openai("gpt-4o-mini"),
      system:
        systemPrompt +
        (systemContextMessages.length > 0
          ? "\n\n" +
            systemContextMessages.map((message) => message.content).join("\n\n")
          : ""),
      messages: formattedMessages,
      temperature: 0.7,
      tools,
      toolChoice: "auto",
      maxOutputTokens: 1500,
    });

    const functionResults =
      result.toolResults?.map((toolResult) => ({
        tool_call_id: toolResult.toolCallId,
        function_name: toolResult.toolName,
        result: toolResult.output,
      })) || [];

    return {
      reply: result.text || "I'm not sure how to respond to that.",
      functionResults: functionResults.length > 0 ? functionResults : undefined,
      functionCalled: functionResults.length > 0,
    };
  }

  async respondStream(
    _chatId: string,
    request: MarkChatRequest,
    userSession: UserSession,
    response: Response,
  ): Promise<void> {
    const { userRole, userText, conversation } = request;

    if (!userRole || !userText || !conversation) {
      throw new BadRequestException("Missing required fields");
    }

    const { systemPrompt, systemContextMessages, assignmentInfo } =
      this.getSystemPromptParts(userRole, conversation);

    const formattedMessages = this.formatMessages(conversation, userText);
    const tools =
      userRole === "author"
        ? this.authorTools()
        : this.learnerTools(userSession, assignmentInfo);

    const result = streamText({
      model: openai("gpt-4o-mini"),
      system:
        systemPrompt +
        (systemContextMessages.length > 0
          ? "\n\n" +
            systemContextMessages.map((message) => message.content).join("\n\n")
          : ""),
      messages: formattedMessages,
      temperature: 0.7,
      tools,
      toolChoice: "auto",
      maxOutputTokens: 1500,
      onStepFinish: undefined,
    });

    if (!result || !result.textStream) {
      response.status(500).send(STANDARD_ERROR_MESSAGE);
      return;
    }

    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.flushHeaders();

    const reader = result.textStream.getReader();
    let fullContent = "";

    const writeChunk = (chunk: string) => {
      response.write(chunk);
    };

    try {
      let done = false;
      while (!done) {
        const readResult = await reader.read();
        done = readResult.done;
        if (!done) {
          const value = readResult.value;
          fullContent += value;
          writeChunk(value);
        }
      }

      const trackedClientExecutions: { function: string; params: any }[] = [];
      const toolResults = await result.toolResults;
      const resolvedToolResults = Array.isArray(toolResults) ? toolResults : [];
      for (const toolResult of resolvedToolResults) {
        if (!toolResult || toolResult.output === undefined) continue;

        const rawResult =
          typeof toolResult.output === "string"
            ? toolResult.output
            : JSON.stringify(toolResult.output);

        if (!rawResult) continue;

        try {
          const parsedResult = JSON.parse(rawResult);
          if (parsedResult?.clientExecution && parsedResult.function) {
            trackedClientExecutions.push({
              function: parsedResult.function,
              params: parsedResult.params,
            });
            continue;
          }
        } catch {
          // Not JSON, proceed to append if missing
        }

        if (!fullContent.includes(rawResult)) {
          const toolResponse = `\n\n${rawResult}`;
          fullContent += toolResponse;
          writeChunk(toolResponse);
        }
      }

      if (trackedClientExecutions.length > 0) {
        const marker = `\n\n<!-- CLIENT_EXECUTION_MARKER\n${JSON.stringify(trackedClientExecutions)}\n-->`;
        writeChunk(marker);
      }
    } finally {
      response.end();
    }
  }

  private formatMessages(
    conversation: MarkChatMessage[],
    userText: string,
  ): CoreMessage[] {
    const regularMessages = conversation.filter(
      (message) =>
        message.role !== "system" || !message.id?.includes("context"),
    );

    const mapped: CoreMessage[] = regularMessages.map((message) =>
      this.toCoreMessage(message),
    );

    return [...mapped, { role: "user", content: userText }];
  }

  private toCoreMessage(message: MarkChatMessage): CoreMessage {
    switch (message.role) {
      case "system": {
        return { role: "system", content: message.content };
      }
      case "assistant": {
        return { role: "assistant", content: message.content };
      }
      default: {
        return { role: "user", content: message.content };
      }
    }
  }

  private getSystemPromptParts(
    userRole: MarkChatRequest["userRole"],
    conversation: MarkChatMessage[],
  ) {
    const systemContextMessages = conversation.filter(
      (message) => message.role === "system" && message.id?.includes("context"),
    );

    const assignmentInfo = systemContextMessages.find(
      (message) => message.role === "system" && message.id?.includes("context"),
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

    const assignmentId =
      userRole === "learner"
        ? this.extractAssignmentIdFromContext(assignmentInfo?.content)
        : undefined;

    const systemPrompt = this.generateSystemPrompt(userRole, {
      mode: assignmentMode,
      submitted: isSubmitted,
      assignmentId,
    });

    return { systemPrompt, systemContextMessages, assignmentInfo };
  }

  private extractAssignmentIdFromContext(content?: string): number | undefined {
    if (!content) return undefined;
    const match = content.match(/Assignment ID:\s*(\d+)/);
    if (!match) return undefined;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private generateSystemPrompt(
    userRole: MarkChatRequest["userRole"],
    assignmentInfo: {
      mode?: string;
      submitted?: boolean;
      assignmentId?: number;
    },
  ) {
    const assignmentMode = assignmentInfo?.mode || "unknown";
    const isSubmitted = assignmentInfo?.submitted === true;
    const assignmentId = assignmentInfo?.assignmentId;

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
- Monitor assignment state and proactively offer help

PROACTIVE MONITORING:
1. Watch for context changes and offer relevant assistance
2. If you notice missing rubrics, incomplete questions, or errors, proactively offer to fix them
3. When a question is focused, analyze it and suggest improvements
4. If the assignment has no questions, guide the author through creating their first question
5. Monitor for common issues like:
   - Questions without rubrics (for text/essay questions)
   - Multiple choice questions without enough options
   - True/false questions that could be ambiguous
   - Missing point values or unclear instructions

QUESTION GENERATION BEST PRACTICES:
1. Always create complete questions with all required fields:
   - Clear, unambiguous question text
   - Appropriate point values (default 10 if not specified)
   - For text questions: ALWAYS include detailed rubrics with at least 3-4 criteria
   - For multiple choice: Include 4-5 options with clear correct/incorrect distinctions
   - For true/false: Ensure statements are factual and verifiable
2. Be interactive during generation:
   - Ask for clarification on learning objectives if vague
   - Suggest question types based on the content
   - Offer to create multiple related questions as a set
3. Quality checks:
   - Verify all generated questions have complete rubrics
   - Ensure point distributions make sense
   - Check for clarity and educational value

ACTION GUIDELINES:
1. Be proactive - monitor the context and offer help before being asked
2. When you see errors or issues, immediately offer solutions
3. For question creation, ALWAYS provide complete specifications including rubrics
4. Use multiple tool calls to ensure completeness (create question, then add rubric)
5. After any operation, verify the result and offer next steps
6. If something seems wrong, investigate and offer to fix it

TOOL USAGE:
- Use createQuestion to AI-generate exactly one question from a prompt
- Use modifyQuestion for updating question content
- Use setQuestionChoices for multiple choice options
- Use addRubric for scoring criteria (MANDATORY for text response questions)
- Use generateQuestionVariant for creating variations
- Use deleteQuestion for removing questions
- Use generateQuestionsFromObjectives for AI-generated content
  and provide multipleChoiceSubtypes when the author asks for short,
  quantitative, long, or scenario multiple-choice questions
- Use updateLearningObjectives for curriculum planning
- Use reportIssue only for technical issues after exhausting troubleshooting options
- Use provideFeedback for sharing general feedback about teaching experience
- Use submitSuggestion for platform or teaching tool improvement ideas
- Use submitInquiry for general questions or inquiries

IMPORTANT: ${assignmentId ? `When calling tools that require assignmentId, always use ${assignmentId}` : "Assignment ID information is not available in the current context"}

RESPONSE STYLE:
- Be conversational and encouraging
- Provide visual feedback about what you're doing (use emojis sparingly but effectively)
- Show the current state of questions you're working on
- Celebrate successes and guide through challenges
- Always confirm what you've done and suggest logical next steps`,
      learner: `You are Mark, an AI tutor and assistant for learners on an educational platform. Your approach varies based on the assignment type and status.

CORE PRINCIPLE: You are an educator first, assistant second. Your goal is to help learners understand concepts deeply.

${
  assignmentMode === "practice"
    ? `PRACTICE ASSIGNMENT MODE - FULL TUTORING:
You are a comprehensive tutor who helps learners master concepts through detailed explanations.

TUTORING APPROACH:
1. Concept Explanation:
   - Start with the fundamental concept behind the question
   - Use analogies and real-world examples
   - Break down complex ideas into digestible parts
   - Connect new concepts to what they might already know

2. Problem-Solving Guidance:
   - Walk through the solution step-by-step
   - Explain WHY each step is important
   - Show alternative approaches when applicable
   - Highlight common mistakes and how to avoid them

3. Direct Answer Policy:
   - YES, provide direct answers in practice mode
   - BUT always explain the reasoning thoroughly
   - Show the complete solution process
   - Explain why other options are incorrect (for multiple choice)
`
    : `GRADED ASSIGNMENT MODE - GUIDED SUPPORT:
This is a graded assignment. You must help learners without giving direct answers.

GUIDANCE APPROACH:
1. Concept Support:
   - Explain underlying concepts
   - Provide hints and guidance
   - Ask leading questions
   - Suggest strategies and approaches
   - NEVER provide direct answers

2. Response Evaluation:
   - If they share their answer, give feedback on their approach
   - Point out potential issues without giving the correct solution
   - Encourage them to review specific parts of the material
`
}

${
  isSubmitted
    ? `SUBMITTED ASSIGNMENT MODE:
The assignment has been submitted. You can:
1. Help explain feedback and grades
2. Clarify why answers were marked wrong
3. Provide learning guidance for improvement
4. Support regrading requests if appropriate
`
    : ""
}

TOOL USAGE:
- Use searchKnowledgeBase for platform help
- Use reportIssue ONLY for technical issues after troubleshooting
- Use getQuestionDetails for question information
- Use getAssignmentRubric for grading criteria
- Use submitFeedbackQuestion for feedback concerns
- Use requestRegrading for regrade requests
- Use provideFeedback for sharing general feedback about learning experience
- Use submitSuggestion for platform improvement ideas
- Use submitInquiry for general questions or inquiries

IMPORTANT: ${assignmentId ? `When calling tools that require assignmentId, always use ${assignmentId}` : "Assignment ID information is not available in the current context"}

RESPONSE STYLE:
- Warm, encouraging, and patient
- Use clear, simple language
- Break down complex explanations
- Use emojis sparingly to add warmth
- Always end with a question or next step to keep engagement`,
    };

    return systemPrompts[userRole] || "";
  }

  private authorTools() {
    return {
      createQuestion: {
        description:
          "Generate exactly one AI question for the assignment from the provided prompt and question type",
        inputSchema: z.object({
          questionType: z
            .enum([
              "TEXT",
              "SINGLE_CORRECT",
              "MULTIPLE_CORRECT",
              "TRUE_FALSE",
              "URL",
              "UPLOAD",
            ])
            .describe("The type of question to generate"),
          questionText: z
            .string()
            .describe("Prompt/objective for generating one question"),
        }),
        execute: async (parameters: any) =>
          JSON.stringify({
            clientExecution: true,
            function: "createQuestion",
            params: parameters,
          }),
      },
      modifyQuestion: {
        description: "Modify an existing question",
        inputSchema: z.object({
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
        execute: async (parameters: any) =>
          JSON.stringify({
            clientExecution: true,
            function: "modifyQuestion",
            params: parameters,
          }),
      },
      setQuestionChoices: {
        description: "Set the choices for a multiple choice question",
        inputSchema: z.object({
          questionId: z.number().describe("The ID of the question"),
          choices: z
            .array(
              z.object({
                text: z.string().describe("The text of the choice"),
                isCorrect: z
                  .boolean()
                  .describe("Whether this choice is correct"),
                points: z
                  .number()
                  .optional()
                  .describe("Points for this choice"),
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
        execute: async (parameters: any) =>
          JSON.stringify({
            clientExecution: true,
            function: "setQuestionChoices",
            params: parameters,
          }),
      },
      addRubric: {
        description:
          "Add a scoring rubric to a question (REQUIRED for text response questions)",
        inputSchema: z.object({
          questionId: z.number().describe("The ID of the question"),
          rubricQuestion: z
            .string()
            .describe("The text of the rubric question"),
          criteria: z
            .array(
              z.object({
                description: z
                  .string()
                  .describe("Description of the criterion"),
                points: z.number().describe("Points for this criterion"),
              }),
            )
            .describe("The criteria for the rubric"),
        }),
        execute: async (parameters: any) =>
          JSON.stringify({
            clientExecution: true,
            function: "addRubric",
            params: parameters,
          }),
      },
      generateQuestionVariant: {
        description: "Generate a variant of an existing question",
        inputSchema: z.object({
          questionId: z
            .number()
            .describe("The ID of the question to create a variant for"),
          variantType: z
            .enum(["REWORDED", "REPHRASED"])
            .describe("The type of variant to create"),
        }),
        execute: async (parameters: any) =>
          JSON.stringify({
            clientExecution: true,
            function: "generateQuestionVariant",
            params: parameters,
          }),
      },
      deleteQuestion: {
        description: "Delete a question from the assignment",
        inputSchema: z.object({
          questionId: z.number().describe("The ID of the question to delete"),
        }),
        execute: async (parameters: any) =>
          JSON.stringify({
            clientExecution: true,
            function: "deleteQuestion",
            params: parameters,
          }),
      },
      generateQuestionsFromObjectives: {
        description: "Generate questions based on learning objectives",
        inputSchema: z.object({
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
            .describe(
              "The number of regular non-subtype questions to generate across questionTypes",
            ),
          multipleChoiceSubtypes: z
            .object({
              short: z
                .number()
                .int()
                .nonnegative()
                .optional()
                .describe("Number of short multiple-choice questions"),
              quantitative: z
                .number()
                .int()
                .nonnegative()
                .optional()
                .describe("Number of quantitative multiple-choice questions"),
              long: z
                .number()
                .int()
                .nonnegative()
                .optional()
                .describe("Number of long multiple-choice questions"),
              scenario: z
                .number()
                .int()
                .nonnegative()
                .optional()
                .describe("Number of scenario multiple-choice questions"),
            })
            .refine(
              (value) =>
                Object.values(value).some(
                  (subtypeCount) =>
                    typeof subtypeCount === "number" && subtypeCount > 0,
                ),
              {
                message:
                  "At least one multiple-choice subtype count must be greater than 0",
              },
            )
            .optional()
            .describe(
              "Optional Mark-owned multiple-choice subtype counts. Use these when the author asks for short, quantitative, long, or scenario multiple-choice questions.",
            ),
        }),
        execute: async (parameters: any) =>
          JSON.stringify({
            clientExecution: true,
            function: "generateQuestionsFromObjectives",
            params: parameters,
          }),
      },
      updateLearningObjectives: {
        description: "Update the learning objectives for the assignment",
        inputSchema: z.object({
          learningObjectives: z
            .string()
            .describe("The updated learning objectives"),
        }),
        execute: async (parameters: any) =>
          JSON.stringify({
            clientExecution: true,
            function: "updateLearningObjectives",
            params: parameters,
          }),
      },
      setQuestionTitle: {
        description: "Set the title for a question",
        inputSchema: z.object({
          questionId: z.number().describe("The ID of the question"),
          title: z.string().describe("The title of the question"),
        }),
        execute: async (parameters: any) =>
          JSON.stringify({
            clientExecution: true,
            function: "setQuestionTitle",
            params: parameters,
          }),
      },
      searchKnowledgeBase: {
        description:
          "Search the knowledge base for information about the platform or features",
        inputSchema: z.object({
          query: z
            .string()
            .describe("The search query to find relevant information"),
        }),
        execute: withErrorHandling(async ({ query }: { query: string }) => {
          return this.searchKnowledgeBase(query);
        }),
      },
      reportIssue: {
        description:
          "Report a technical issue or bug with the platform. Extract the user's issue description and use it to prefill the form.",
        inputSchema: z.object({
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
        execute: async ({
          issueType,
          description,
          assignmentId,
          severity,
        }: {
          issueType: string;
          description: string;
          assignmentId?: number;
          severity?: string;
        }) =>
          JSON.stringify({
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
          }),
      },
      provideFeedback: {
        description:
          "Provide general feedback about the teaching experience or platform. Extract the user's feedback text and use it as the description to prefill the form.",
        inputSchema: z.object({
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
        execute: async ({
          description,
          assignmentId,
          rating,
        }: {
          description: string;
          assignmentId?: number;
          rating?: number;
        }) =>
          JSON.stringify({
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
          }),
      },
      submitSuggestion: {
        description:
          "Submit suggestions for improving the platform or teaching tools. Extract the user's suggestion text and use it as the description to prefill the form.",
        inputSchema: z.object({
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
        execute: async ({
          description,
          assignmentId,
        }: {
          description: string;
          assignmentId?: number;
        }) =>
          JSON.stringify({
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
          }),
      },
      submitInquiry: {
        description:
          "Submit general questions or inquiries about the platform or assignments. Extract the user's question text and use it as the description to prefill the form.",
        inputSchema: z.object({
          inquiryType: z
            .enum(["general", "technical", "academic", "other"])
            .describe("The type of inquiry being made"),
          description: z
            .string()
            .describe(
              "The question or inquiry details - extract this from the user's message to prefill the form",
            ),
          assignmentId: z
            .number()
            .optional()
            .describe(
              "The ID of the assignment (if inquiry is assignment-specific)",
            ),
        }),
        execute: async ({
          description,
          assignmentId,
        }: {
          description: string;
          assignmentId?: number;
        }) =>
          JSON.stringify({
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
          }),
      },
    };
  }

  private learnerTools(
    userSession: UserSession,
    assignmentInfo?: MarkChatMessage,
  ) {
    const assignmentIdFromContext = this.extractAssignmentIdFromContext(
      assignmentInfo?.content,
    );

    return {
      searchKnowledgeBase: {
        description:
          "Search the knowledge base for information about the platform or features",
        inputSchema: z.object({
          query: z
            .string()
            .describe("The search query to find relevant information"),
        }),
        execute: withErrorHandling(async ({ query }: { query: string }) => {
          return this.searchKnowledgeBase(query);
        }),
      },
      reportIssue: {
        description:
          "Report a technical issue or bug with the platform. Extract the user's issue description and use it to prefill the form.",
        inputSchema: z.object({
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
        execute: async ({
          issueType,
          description,
          assignmentId,
          severity,
        }: {
          issueType: string;
          description: string;
          assignmentId?: number;
          severity?: string;
        }) =>
          JSON.stringify({
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
          }),
      },
      provideFeedback: {
        description:
          "Provide general feedback about the learning experience or platform. Extract the user's feedback text and use it as the description to prefill the form.",
        inputSchema: z.object({
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
        execute: async ({
          description,
          assignmentId,
          rating,
        }: {
          description: string;
          assignmentId?: number;
          rating?: number;
        }) =>
          JSON.stringify({
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
          }),
      },
      submitSuggestion: {
        description:
          "Submit suggestions for improving the platform or assignments. Extract the user's suggestion text and use it as the description to prefill the form.",
        inputSchema: z.object({
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
        execute: async ({
          description,
          assignmentId,
        }: {
          description: string;
          assignmentId?: number;
        }) =>
          JSON.stringify({
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
          }),
      },
      submitInquiry: {
        description:
          "Submit general questions or inquiries about the platform or assignments. Extract the user's question text and use it as the description to prefill the form.",
        inputSchema: z.object({
          inquiryType: z
            .enum(["general", "technical", "academic", "other"])
            .describe("The type of inquiry being made"),
          description: z
            .string()
            .describe(
              "The question or inquiry details - extract this from the user's message to prefill the form",
            ),
          assignmentId: z
            .number()
            .optional()
            .describe(
              "The ID of the assignment (if inquiry is assignment-specific)",
            ),
        }),
        execute: async ({
          description,
          assignmentId,
        }: {
          description: string;
          assignmentId?: number;
        }) =>
          JSON.stringify({
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
          }),
      },
      getQuestionDetails: {
        description:
          "Get detailed information about a specific question in the assignment",
        inputSchema: z.object({
          questionId: z
            .number()
            .describe("The ID of the question to retrieve details for"),
        }),
        execute: withErrorHandling(
          async ({ questionId }: { questionId: number }) => {
            return this.getQuestionDetailsFromContext(
              questionId,
              assignmentInfo?.content,
            );
          },
        ),
      },
      getAssignmentRubric: {
        description: "Get the rubric or grading criteria for the assignment",
        inputSchema: z.object({
          assignmentId: z.number().describe("The ID of the assignment"),
        }),
        execute: withErrorHandling(
          async ({ assignmentId }: { assignmentId: number }) => {
            return this.getAssignmentRubricFromContext(
              assignmentId,
              assignmentInfo?.content,
            );
          },
        ),
      },
      submitFeedbackQuestion: {
        description:
          "Submit a question about feedback that requires instructor attention",
        inputSchema: z.object({
          questionId: z
            .number()
            .describe("The ID of the question being asked about"),
          feedbackQuery: z
            .string()
            .describe("The specific question or concern about the feedback"),
        }),
        execute: withErrorHandling(
          async ({
            questionId,
            feedbackQuery,
          }: {
            questionId: number;
            feedbackQuery: string;
          }) => {
            return `Your feedback question for question ${questionId} has been recorded: "${feedbackQuery}". An instructor will review it soon.`;
          },
        ),
      },
      requestRegrading: {
        description: "Submit a formal request for regrading an assignment",
        inputSchema: z.object({
          assignmentId: z
            .number()
            .describe("The ID of the assignment to be regraded")
            .optional(),
          attemptId: z
            .number()
            .describe("The ID of the attempt to be regraded")
            .optional(),
          reason: z.string().describe("The reason for requesting regrading"),
        }),
        execute: withErrorHandling(
          async ({
            assignmentId,
            reason,
          }: {
            assignmentId?: number;
            reason: string;
          }) => {
            const resolvedAssignmentId =
              assignmentId ||
              assignmentIdFromContext ||
              userSession.assignmentId ||
              0;
            const requestId = `RG-${Date.now().toString(36).toUpperCase()}`;
            return `Your request for regrading of assignment ${resolvedAssignmentId} has been submitted with the following reason: "${reason}". The instructor will review your request and respond as soon as possible. For reference, your request ID is ${requestId}.`;
          },
        ),
      },
    };
  }

  private searchKnowledgeBase(query: string): string {
    const knowledgeItems = [
      {
        id: "kb-1",
        title: "Multiple Choice Questions",
        description:
          "Multiple choice questions allow learners to select one correct answer from several options. They're great for testing recall and recognition.",
      },
      {
        id: "kb-2",
        title: "Assignment Feedback",
        description:
          "Feedback is provided automatically for assignments based on the rubric and AI evaluation of the learner's responses.",
      },
      {
        id: "kb-3",
        title: "Practice vs. Graded Assignments",
        description:
          "Practice assignments allow unlimited attempts and provide detailed feedback. Graded assignments may have limited attempts and contribute to a final grade.",
      },
      {
        id: "kb-4",
        title: "Regrading Process",
        description:
          "You can request regrading if you believe your submission was incorrectly assessed. Instructors will review your request and adjust scores if appropriate.",
      },
      {
        id: "kb-5",
        title: "Technical Issues",
        description:
          "If you encounter technical issues with the platform, you can report them through Mark. Include the specific steps to reproduce the issue and any error messages you see.",
      },
    ];

    const results = knowledgeItems.filter(
      (item) =>
        item.title.toLowerCase().includes(query.toLowerCase()) ||
        item.description.toLowerCase().includes(query.toLowerCase()),
    );

    if (results.length === 0) {
      return "I couldn't find specific information about that in our knowledge base, but I'll try to help based on my general knowledge.";
    }

    return results
      .map((item) => `**${item.title}**\n${item.description}`)
      .join("\n\n");
  }

  private getQuestionDetailsFromContext(
    questionId: number,
    context?: string,
  ): string {
    if (!context) {
      return "Question details are unavailable right now. Please refresh the page and try again.";
    }

    const questionBlockMatch = context.match(
      /CURRENT QUESTION:[\S\s]*?ISSUE REPORTING:/,
    );
    const questionBlock = questionBlockMatch ? questionBlockMatch[0] : context;

    const idMatch = questionBlock.match(/Question ID:\s*(\d+)/);
    if (idMatch && Number(idMatch[1]) !== questionId) {
      return "Question not found in the current context. Please check the question ID.";
    }

    return `**Question Details**\n\n${questionBlock
      .replace("CURRENT QUESTION:", "")
      .replace("ISSUE REPORTING:", "")
      .trim()}`;
  }

  private getAssignmentRubricFromContext(
    assignmentId: number,
    context?: string,
  ): string {
    if (!context) {
      return "Assignment rubric not found. Please check the assignment ID or try refreshing the page.";
    }

    if (!context.includes(`Assignment ID: ${assignmentId}`)) {
      return "Assignment rubric not found. Please check the assignment ID or try refreshing the page.";
    }

    const rubricOverviewMatch = context.match(
      /Grading Criteria Overview:[\S\s]*?(?:\n\n|$)/,
    );

    if (rubricOverviewMatch) {
      return `**Assignment Rubric**\n\n${rubricOverviewMatch[0].trim()}`;
    }

    return `**Assignment Rubric**\n\nThis assignment doesn't have detailed grading criteria specified.`;
  }
}
