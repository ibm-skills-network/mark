/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { openai } from "@ai-sdk/openai";
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  CoreMessage,
  generateText,
  stepCountIs,
  streamText,
  tool,
  ToolSet,
} from "ai";
import { Response } from "express";
import { AiFeatureComponent } from "src/api/ai-feature-flags/ai-feature-flags.constants";
import { AiFeatureFlagsService } from "src/api/ai-feature-flags/ai-feature-flags.service";
import { logAiInvocation } from "src/api/llm/core/utils/ai-invocation-log.util";
import { DEFAULT_LLM_MODEL } from "src/api/llm/llm.constants";
import {
  UserRole,
  UserSession,
} from "src/auth/interfaces/user.session.interface";
import { ChatRole, Prisma } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { z } from "zod";
import { ChatRepository } from "../repositories/chat.repository";
import {
  collectToolResultsAcrossSteps,
  partitionClientExecutions,
} from "./chat-tool-results";
import { LEARNER_HELP_GUIDE } from "./mark-chat-knowledge";

type MarkChatRole = "system" | "user" | "assistant";

interface MarkChatMessage {
  role: MarkChatRole;
  content: string;
  id?: string;
}

type MarkChatToolRole = "author" | "learner";

interface MarkChatRequest {
  /**
   * What the client believes its role is. Kept so existing clients keep
   * working, but it never decides anything: the tool set and the system
   * prompt follow the authenticated session.
   */
  userRole?: MarkChatToolRole;
  userText: string;
  conversation: MarkChatMessage[];
}

const STANDARD_ERROR_MESSAGE =
  "Sorry for the inconvenience, I am still new around here and this capability is not there yet, my developers are working on it!";
const CHAT_DISABLED_MESSAGE =
  "Mark's AI assistant is temporarily unavailable. Please try again later.";
// MARK_CHAT_MODEL overrides this; the chat does not go through AIFeature routing.
const DEFAULT_CHAT_MODEL = DEFAULT_LLM_MODEL;
// Reasoning off, matching the grading providers. The SDK drops it with a
// warning for non-reasoning overrides such as gpt-4o-mini.
const CHAT_PROVIDER_OPTIONS = {
  openai: { reasoningEffort: "none" },
} as const;
const DEFAULT_MODEL_CONTEXT_TOKENS = 128 * 1000;
const DEFAULT_RESPONSE_MAX_TOKENS = 15 * 100;
const DEFAULT_CONTEXT_RESERVE_TOKENS = 8 * 1000;
const TOOL_AND_SCHEMA_OVERHEAD_TOKENS = 3 * 1000;
const MESSAGE_TOKEN_OVERHEAD = 12;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const CONTEXT_WINDOW_WARNING =
  "⚠️ Some older chat context was trimmed to fit the model limit. If you need earlier details, start a new chat.";
const TOOL_ONLY_FALLBACK_MESSAGE =
  "I looked up the details. Tell me what you would like help with.";
const MIN_TRUNCATE_CHARS = 500;
const MAX_TOOL_STEPS = 5;

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
      if (error instanceof HttpException) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : STANDARD_ERROR_MESSAGE;
      return `Error in ${function_.name || "function"}: ${message}`;
    }
  };
}

@Injectable()
export class MarkChatService {
  private readonly logger: Logger;

  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly aiFlags: AiFeatureFlagsService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: MarkChatService.name });
  }

  private readIntFromEnv(
    key: string,
    fallback: number,
    min = 1,
    max?: number,
  ): number {
    const clamp = (value: number) => {
      const minApplied = Math.max(Math.floor(value), min);
      return typeof max === "number" ? Math.min(minApplied, max) : minApplied;
    };

    const safeFallback = clamp(fallback);
    const parsed = Number(process.env[key]);
    if (!Number.isFinite(parsed)) {
      return safeFallback;
    }

    return clamp(parsed);
  }

  private getChatModel(): string {
    return process.env.MARK_CHAT_MODEL || DEFAULT_CHAT_MODEL;
  }

  private getModelContextTokenLimit(): number {
    return this.readIntFromEnv(
      "MARK_CHAT_MODEL_CONTEXT_TOKENS",
      DEFAULT_MODEL_CONTEXT_TOKENS,
      8 * 1000,
      2000 * 1000,
    );
  }

  private getResponseTokenLimit(): number {
    return this.readIntFromEnv(
      "MARK_CHAT_MAX_OUTPUT_TOKENS",
      DEFAULT_RESPONSE_MAX_TOKENS,
      256,
      32 * 1000,
    );
  }

  private getReservedContextTokens(): number {
    return this.readIntFromEnv(
      "MARK_CHAT_CONTEXT_RESERVE_TOKENS",
      DEFAULT_CONTEXT_RESERVE_TOKENS,
      1 * 1000,
      64 * 1000,
    );
  }

  private estimateTokens(content: string): number {
    if (!content) return 0;
    return Math.ceil(content.length / CHARS_PER_TOKEN_ESTIMATE);
  }

  private getConversationHistoryBudgetTokens(parameters: {
    systemPrompt: string;
    systemContextMessages: MarkChatMessage[];
    userText: string;
  }): number {
    const systemContextText = parameters.systemContextMessages
      .map((message) => message.content)
      .join("\n");

    const reservedForNonHistory =
      this.estimateTokens(parameters.systemPrompt) +
      this.estimateTokens(systemContextText) +
      this.estimateTokens(parameters.userText) +
      TOOL_AND_SCHEMA_OVERHEAD_TOKENS;

    const budget =
      this.getModelContextTokenLimit() -
      this.getResponseTokenLimit() -
      this.getReservedContextTokens() -
      reservedForNonHistory;

    return Math.max(0, budget);
  }

  private truncateTextByTokenBudget(
    content: string,
    tokenBudget: number,
  ): string {
    if (!content) return "";
    const maxChars = Math.max(
      MIN_TRUNCATE_CHARS,
      tokenBudget * CHARS_PER_TOKEN_ESTIMATE,
    );
    if (content.length <= maxChars) {
      return content;
    }
    const tailContent = content.slice(content.length - maxChars);
    return `[...truncated to fit model context...]\n${tailContent}`;
  }

  private selectRecentMessagesWithinBudget(
    messages: MarkChatMessage[],
    tokenBudget: number,
  ): { messages: MarkChatMessage[]; contextTrimmed: boolean } {
    const safeBudget = Math.max(0, tokenBudget);
    if (safeBudget === 0) {
      return { messages: [], contextTrimmed: messages.length > 0 };
    }

    const selected: MarkChatMessage[] = [];
    let usedTokens = 0;
    let contextTrimmed = false;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const messageTokens =
        this.estimateTokens(message.content) + MESSAGE_TOKEN_OVERHEAD;

      if (usedTokens + messageTokens <= safeBudget) {
        selected.push(message);
        usedTokens += messageTokens;
        continue;
      }

      contextTrimmed = true;
      if (selected.length === 0) {
        const remainingTokens = Math.max(
          1,
          safeBudget - MESSAGE_TOKEN_OVERHEAD,
        );
        selected.push({
          ...message,
          content: this.truncateTextByTokenBudget(
            message.content,
            remainingTokens,
          ),
        });
      }
      break;
    }

    return { messages: selected.reverse(), contextTrimmed };
  }

  /**
   * The tool set and the system prompt follow the authenticated session, not
   * the request body: a learner who posts `userRole: "author"` must not be
   * handed the author tools. A body that disagrees is logged and discarded.
   */
  private resolveChatRole(
    userSession: UserSession,
    requestedRole: MarkChatToolRole | undefined,
    context: { chatId: string; mode: string },
  ): MarkChatToolRole {
    const role: MarkChatToolRole =
      userSession.role === UserRole.AUTHOR ? "author" : "learner";

    if (requestedRole && requestedRole !== role) {
      this.logger.warn("chat_role_from_session: request role ignored", {
        chat_id: context.chatId,
        mode: context.mode,
        session_role: userSession.role,
        requested_role: requestedRole,
        user_id: userSession.userId,
      });
    }

    return role;
  }

  /**
   * The assignment a chat is scoped to comes from the session too. The
   * conversation carries a client-written "Assignment ID: n" line; it is only
   * used to notice a disagreement.
   */
  private resolveAssignmentScope(
    userSession: UserSession,
    conversationAssignmentId: number | undefined,
    context: { chatId: string; mode: string },
  ): number | undefined {
    const assignmentId =
      Number.isInteger(userSession.assignmentId) && userSession.assignmentId > 0
        ? userSession.assignmentId
        : undefined;

    if (
      conversationAssignmentId !== undefined &&
      conversationAssignmentId !== assignmentId
    ) {
      this.logger.warn(
        "chat_assignment_from_session: conversation assignment ignored",
        {
          chat_id: context.chatId,
          mode: context.mode,
          assignment_id: assignmentId,
          requested_assignment_id: conversationAssignmentId,
          user_id: userSession.userId,
        },
      );
    }

    return assignmentId;
  }

  async respond(
    chatId: string,
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
    const { userText, conversation } = request;

    if (!userText || !conversation) {
      throw new BadRequestException("Missing required fields");
    }

    const userRole = this.resolveChatRole(userSession, request.userRole, {
      chatId,
      mode: "respond",
    });

    // Kill-switch: short-circuit with a polite message instead of calling the
    // provider when the AI chat component is disabled.
    if (this.aiFlags.isDisabled(AiFeatureComponent.CHAT)) {
      this.logger.info("ai.killswitch.chat.blocked", {
        chatId,
        userRole,
        mode: "respond",
      });
      return { reply: CHAT_DISABLED_MESSAGE, functionCalled: false };
    }

    const { systemPrompt, systemContextMessages, assignmentInfo } =
      this.getSystemPromptParts(userRole, conversation, userSession, {
        chatId,
        mode: "respond",
      });

    const conversationHistoryBudget = this.getConversationHistoryBudgetTokens({
      systemPrompt,
      systemContextMessages,
      userText,
    });
    const formattedConversation = this.formatMessages(
      conversation,
      userText,
      conversationHistoryBudget,
    );
    const formattedMessages = formattedConversation.messages;
    const chatModel = this.getChatModel();
    const maxOutputTokens = this.getResponseTokenLimit();
    const tools =
      userRole === "author"
        ? this.authorTools()
        : this.learnerTools(assignmentInfo);

    const result = await generateText({
      model: openai(chatModel),
      providerOptions: CHAT_PROVIDER_OPTIONS,
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
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      maxOutputTokens,
    });

    const functionResults = collectToolResultsAcrossSteps(result.steps).map(
      (toolResult) => ({
        tool_call_id: toolResult.toolCallId,
        function_name: toolResult.toolName,
        result: toolResult.output,
      }),
    );

    const replyText = result.text || "I'm not sure how to respond to that.";

    logAiInvocation(this.logger, {
      modelKey: chatModel,
      purpose: "chat_assistant",
      prompt: userText,
      response: replyText,
      context: { chat_id: chatId, user_role: userRole, mode: "respond" },
    });

    const reply = formattedConversation.contextTrimmed
      ? `${CONTEXT_WINDOW_WARNING}\n\n${replyText}`
      : replyText;

    return {
      reply,
      functionResults: functionResults.length > 0 ? functionResults : undefined,
      functionCalled: functionResults.length > 0,
    };
  }

  async respondStream(
    chatId: string,
    request: MarkChatRequest,
    userSession: UserSession,
    response: Response,
  ): Promise<void> {
    const { userText, conversation } = request;

    if (!userText || !conversation) {
      throw new BadRequestException("Missing required fields");
    }

    const userRole = this.resolveChatRole(userSession, request.userRole, {
      chatId,
      mode: "stream",
    });

    // Kill-switch: stream a single polite message and end the response without
    // touching the provider when the AI chat component is disabled.
    if (this.aiFlags.isDisabled(AiFeatureComponent.CHAT)) {
      this.logger.info("ai.killswitch.chat.blocked", {
        chatId,
        userRole,
        mode: "stream",
      });
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.flushHeaders();
      response.write(CHAT_DISABLED_MESSAGE);
      response.end();
      return;
    }

    const { systemPrompt, systemContextMessages, assignmentInfo } =
      this.getSystemPromptParts(userRole, conversation, userSession, {
        chatId,
        mode: "stream",
      });

    const conversationHistoryBudget = this.getConversationHistoryBudgetTokens({
      systemPrompt,
      systemContextMessages,
      userText,
    });
    const formattedConversation = this.formatMessages(
      conversation,
      userText,
      conversationHistoryBudget,
    );
    const formattedMessages = formattedConversation.messages;
    const chatModel = this.getChatModel();
    const maxOutputTokens = this.getResponseTokenLimit();
    const tools =
      userRole === "author"
        ? this.authorTools()
        : this.learnerTools(assignmentInfo);

    const result = streamText({
      model: openai(chatModel),
      providerOptions: CHAT_PROVIDER_OPTIONS,
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
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      maxOutputTokens,
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
      if (formattedConversation.contextTrimmed) {
        const warningChunk = `${CONTEXT_WINDOW_WARNING}\n\n`;
        fullContent += warningChunk;
        writeChunk(warningChunk);
      }

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

      // Do not stream raw tool output to users.
      // The model should synthesize tool results into natural language.
      const steps = await result.steps;
      const { trackedClientExecutions, nonClientToolOutputs } =
        partitionClientExecutions(collectToolResultsAcrossSteps(steps));

      if (!fullContent.trim() && nonClientToolOutputs.length > 0) {
        const fallback = TOOL_ONLY_FALLBACK_MESSAGE;
        fullContent += fallback;
        writeChunk(fallback);
      }

      if (trackedClientExecutions.length > 0) {
        const marker = `\n\n<!-- CLIENT_EXECUTION_MARKER\n${JSON.stringify(trackedClientExecutions)}\n-->`;
        writeChunk(marker);
      }

      logAiInvocation(this.logger, {
        modelKey: chatModel,
        purpose: "chat_assistant",
        prompt: userText,
        response: fullContent,
        context: { chat_id: chatId, user_role: userRole, mode: "stream" },
      });

      const hasContent = fullContent.trim().length > 0;
      const hasToolCalls = trackedClientExecutions.length > 0;
      if (hasContent || hasToolCalls) {
        try {
          const contentForDatabase = hasToolCalls
            ? `${fullContent}\n\n<!-- CLIENT_EXECUTION_MARKER\n${JSON.stringify(trackedClientExecutions)}\n-->`
            : fullContent;
          const toolCallsForDatabase = hasToolCalls
            ? (trackedClientExecutions as unknown as Prisma.JsonValue)
            : undefined;
          await this.chatRepository.addMessage(
            chatId,
            ChatRole.ASSISTANT,
            contentForDatabase,
            toolCallsForDatabase,
          );
        } catch (persistError) {
          console.error(
            "MarkChatService.respondStream: failed to persist assistant message",
            persistError,
          );
        }
      }
    } finally {
      response.end();
    }
  }

  private formatMessages(
    conversation: MarkChatMessage[],
    userText: string,
    historyTokenBudget: number,
  ): { messages: CoreMessage[]; contextTrimmed: boolean } {
    const regularMessages = conversation.filter(
      (message) =>
        message.role !== "system" || !message.id?.includes("context"),
    );
    const budgetSelection = this.selectRecentMessagesWithinBudget(
      regularMessages,
      historyTokenBudget,
    );
    const budgetedMessages = budgetSelection.messages;

    const mapped: CoreMessage[] = budgetedMessages.map((message) =>
      this.toCoreMessage(message),
    );

    return {
      messages: [...mapped, { role: "user", content: userText }],
      contextTrimmed: budgetSelection.contextTrimmed,
    };
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
    userRole: MarkChatToolRole,
    conversation: MarkChatMessage[],
    userSession: UserSession,
    context: { chatId: string; mode: string },
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

    const assignmentId = this.resolveAssignmentScope(
      userSession,
      this.extractAssignmentIdFromContext(assignmentInfo?.content),
      context,
    );

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
    userRole: MarkChatToolRole,
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
- reportIssue, provideFeedback, submitSuggestion, and submitInquiry only OPEN a pre-filled form — nothing is submitted until the user submits the form. After calling one, ask the user to review and submit the form. NEVER claim the report, feedback, suggestion, or inquiry was already submitted.

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
`
    : ""
}

TOOL USAGE:
- Use the PLATFORM HELP guide below for questions about uploads, grading, results and attempts
- Use reportIssue ONLY for technical issues after troubleshooting
- Use getQuestionDetails for question information
- Use getAssignmentRubric for grading criteria
- Use provideFeedback for sharing general feedback about learning experience
- Use submitSuggestion for platform improvement ideas
- Use submitInquiry for general questions or inquiries
- reportIssue, provideFeedback, submitSuggestion, and submitInquiry only OPEN a pre-filled form — nothing is submitted until the user submits the form. After calling one, ask the user to review and submit the form. NEVER claim the report, feedback, suggestion, or inquiry was already submitted.

IMPORTANT: ${assignmentId ? `When calling tools that require assignmentId, always use ${assignmentId}` : "Assignment ID information is not available in the current context"}

RESPONSE STYLE:
- Warm, encouraging, and patient
- Use clear, simple language
- Break down complex explanations
- Use emojis sparingly to add warmth
- Always end with a question or next step to keep engagement

${LEARNER_HELP_GUIDE}`,
    };

    const prefillGuidance = `

For report/feedback/suggestion/inquiry form prefills, use only the user’s latest request.`;

    return (systemPrompts[userRole] || "") + prefillGuidance;
  }

  /**
   * Report/feedback/suggestion/inquiry tools only open a pre-filled form on
   * the client — nothing is filed until the user submits it. The note rides
   * along in the tool result so the model doesn't tell the user the report
   * was already submitted.
   */
  private showReportPreviewResult(
    formParameters: Record<string, unknown>,
  ): string {
    return JSON.stringify({
      clientExecution: true,
      function: "showReportPreview",
      params: formParameters,
      note: "A pre-filled form was opened in the chat window, but NOTHING has been submitted yet. Ask the user to review the form and press Submit to file it. Do not claim the report, feedback, suggestion, or inquiry was already submitted.",
    });
  }

  private toToolSet(
    definitions: Record<
      string,
      {
        description: string;
        inputSchema: z.ZodTypeAny;
        execute: (input: any) => Promise<unknown> | unknown;
      }
    >,
  ): ToolSet {
    return Object.fromEntries(
      Object.entries(definitions).map(([name, definition]) => [
        name,
        tool({
          description: definition.description,
          // These are Zod schemas, which the SDK accepts at runtime. Avoid
          // recursively comparing Zod 3 against the SDK's Zod 3/4 union.
          inputSchema:
            definition.inputSchema as unknown as ToolSet[string]["inputSchema"],
          execute: definition.execute,
        }),
      ]),
    ) as ToolSet;
  }

  private authorTools(): ToolSet {
    return this.toToolSet({
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
      reportIssue: {
        description:
          "Open a pre-filled issue-report form for a technical issue or bug with the platform. The issue is only reported once the user reviews and submits the form. Extract the user's issue description and use it to prefill the form.",
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
        }) => {
          return this.showReportPreviewResult({
            issueType,
            description: description.trim(),
            assignmentId,
            severity: severity || "info",
            userRole: "author",
            category: "Author Issue",
          });
        },
      },
      provideFeedback: {
        description:
          "Open a pre-filled feedback form about the teaching experience or platform. The feedback is only sent once the user reviews and submits the form. Extract the user's feedback text and use it as the description to prefill the form.",
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
        }) => {
          return this.showReportPreviewResult({
            type: "feedback",
            issueType: "FEEDBACK",
            description: description.trim(),
            assignmentId,
            rating,
            userRole: "author",
            category: "Author Feedback",
          });
        },
      },
      submitSuggestion: {
        description:
          "Open a pre-filled suggestion form for improving the platform or teaching tools. The suggestion is only sent once the user reviews and submits the form. Extract the user's suggestion text and use it as the description to prefill the form.",
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
        }) => {
          return this.showReportPreviewResult({
            type: "suggestion",
            issueType: "SUGGESTION",
            description: description.trim(),
            assignmentId,
            userRole: "author",
            category: "Author Suggestion",
          });
        },
      },
      submitInquiry: {
        description:
          "Open a pre-filled inquiry form for general questions about the platform or assignments. The inquiry is only sent once the user reviews and submits the form. Extract the user's question text and use it as the description to prefill the form.",
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
        }) => {
          return this.showReportPreviewResult({
            type: "inquiry",
            issueType: "OTHER",
            description: description.trim(),
            assignmentId,
            userRole: "author",
            category: "Author Inquiry",
          });
        },
      },
    });
  }

  private learnerTools(assignmentInfo?: MarkChatMessage): ToolSet {
    return this.toToolSet({
      reportIssue: {
        description:
          "Open a pre-filled issue-report form for a technical issue or bug with the platform. The issue is only reported once the user reviews and submits the form. Extract the user's issue description and use it to prefill the form.",
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
        }) => {
          return this.showReportPreviewResult({
            type: "report",
            issueType,
            description: description.trim(),
            assignmentId,
            severity: severity || "info",
            userRole: "learner",
            category: "Learner Issue",
          });
        },
      },
      provideFeedback: {
        description:
          "Open a pre-filled feedback form about the learning experience or platform. The feedback is only sent once the user reviews and submits the form. Extract the user's feedback text and use it as the description to prefill the form.",
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
        }) => {
          return this.showReportPreviewResult({
            type: "feedback",
            issueType: "FEEDBACK",
            description: description.trim(),
            assignmentId,
            rating,
            userRole: "learner",
            category: "Learner Feedback",
          });
        },
      },
      submitSuggestion: {
        description:
          "Open a pre-filled suggestion form for improving the platform or assignments. The suggestion is only sent once the user reviews and submits the form. Extract the user's suggestion text and use it as the description to prefill the form.",
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
        }) => {
          return this.showReportPreviewResult({
            type: "suggestion",
            issueType: "SUGGESTION",
            description: description.trim(),
            assignmentId,
            userRole: "learner",
            category: "Learner Suggestion",
          });
        },
      },
      submitInquiry: {
        description:
          "Open a pre-filled inquiry form for general questions about the platform or assignments. The inquiry is only sent once the user reviews and submits the form. Extract the user's question text and use it as the description to prefill the form.",
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
        }) => {
          return this.showReportPreviewResult({
            type: "inquiry",
            issueType: "OTHER",
            description: description.trim(),
            assignmentId,
            userRole: "learner",
            category: "Learner Inquiry",
          });
        },
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
    });
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
