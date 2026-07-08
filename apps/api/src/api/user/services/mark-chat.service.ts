/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { openai } from "@ai-sdk/openai";
import {
  BadRequestException,
  ForbiddenException,
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
import { FileContentExtractionService } from "src/api/attempt/services/file-content-extraction";
import { FileProcessingBudgetService } from "src/api/files/services/file-processing-budget.service";
import { S3Service } from "src/api/files/services/s3.service";
import { UserSession } from "src/auth/interfaces/user.session.interface";
import { ChatRole, Prisma } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { z } from "zod";
import { ChatRepository } from "../repositories/chat.repository";
import {
  collectToolResultsAcrossSteps,
  partitionClientExecutions,
} from "./chat-tool-results";
import { ChatService } from "./chat.service";

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
const CHAT_DISABLED_MESSAGE =
  "Mark's AI assistant is temporarily unavailable. Please try again later.";
const DEFAULT_CHAT_MODEL = "gpt-4o-mini";
const DEFAULT_MODEL_CONTEXT_TOKENS = 128 * 1000;
const DEFAULT_RESPONSE_MAX_TOKENS = 15 * 100;
const DEFAULT_CONTEXT_RESERVE_TOKENS = 8 * 1000;
const TOOL_AND_SCHEMA_OVERHEAD_TOKENS = 3 * 1000;
const MESSAGE_TOKEN_OVERHEAD = 12;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const CONTEXT_WINDOW_WARNING =
  "⚠️ Some older chat context was trimmed to fit the model limit. If you need earlier details, start a new chat.";
const MIN_FILE_EXTRACT_CHARS = 500;
const DEFAULT_FILE_EXTRACT_CHARS = 20 * 1000;
const MAX_FILE_EXTRACT_CHARS_HARD_CAP = 500 * 1000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOOL_STEPS = 5;
const FILE_SECTION_HEADERS = [
  "files already available in this chat session:",
  "files available in this chat:",
  "new files attached for this message:",
  "full content for selected files:",
];

function startsFileSection(line: string): boolean {
  const lower = line.toLowerCase();
  return FILE_SECTION_HEADERS.some((header) => lower.startsWith(header));
}

function isFileMetadataLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    /^\d+\.\s+.+\((\d+(\.\d+)?)\s*(b|kb|mb|gb|bytes?)\)$/i.test(line) ||
    lower.startsWith("type:") ||
    lower.startsWith("s3 link:") ||
    lower.startsWith("bucket:") ||
    lower.startsWith("key:") ||
    lower.startsWith("summary:") ||
    lower.startsWith("<file_summary>") ||
    lower.startsWith("</file_summary>")
  );
}

function isFileHintLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.startsWith("when the user asks about these files") ||
    lower.includes("extractfilefromlink") ||
    lower.includes("summarizefilefromlink")
  );
}

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
    private readonly s3Service: S3Service,
    private readonly fileContentExtractionService: FileContentExtractionService,
    private readonly chatService: ChatService,
    private readonly chatRepository: ChatRepository,
    private readonly processingBudget: FileProcessingBudgetService,
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
      MIN_FILE_EXTRACT_CHARS,
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

  private getMaxFileExtractChars(): number {
    const modelBasedFallback = Math.max(
      DEFAULT_FILE_EXTRACT_CHARS,
      Math.floor(
        (this.getModelContextTokenLimit() - this.getResponseTokenLimit()) *
          CHARS_PER_TOKEN_ESTIMATE *
          0.75,
      ),
    );

    return this.readIntFromEnv(
      "MARK_CHAT_MAX_FILE_EXTRACT_CHARS",
      modelBasedFallback,
      MIN_FILE_EXTRACT_CHARS,
      MAX_FILE_EXTRACT_CHARS_HARD_CAP,
    );
  }

  private getDefaultFileExtractChars(maxAllowedChars: number): number {
    return this.readIntFromEnv(
      "MARK_CHAT_DEFAULT_FILE_EXTRACT_CHARS",
      Math.min(DEFAULT_FILE_EXTRACT_CHARS, maxAllowedChars),
      MIN_FILE_EXTRACT_CHARS,
      maxAllowedChars,
    );
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
    const { userRole, userText, conversation } = request;

    if (!userRole || !userText || !conversation) {
      throw new BadRequestException("Missing required fields");
    }

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
      this.getSystemPromptParts(userRole, conversation);

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
    const allowedLinks = await this.chatService.getAuthorizedChatFileLinks(
      chatId,
      userSession,
    );
    const roleTools =
      userRole === "author"
        ? this.authorTools()
        : this.learnerTools(userSession, assignmentInfo);
    const tools: ToolSet = {
      ...roleTools,
      ...this.fileTools(allowedLinks),
    };

    const result = await generateText({
      model: openai(chatModel),
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
    const { userRole, userText, conversation } = request;

    if (!userRole || !userText || !conversation) {
      throw new BadRequestException("Missing required fields");
    }

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
      this.getSystemPromptParts(userRole, conversation);

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
    const allowedLinks = await this.chatService.getAuthorizedChatFileLinks(
      chatId,
      userSession,
    );
    const roleTools =
      userRole === "author"
        ? this.authorTools()
        : this.learnerTools(userSession, assignmentInfo);
    const tools: ToolSet = {
      ...roleTools,
      ...this.fileTools(allowedLinks),
    };

    const result = streamText({
      model: openai(chatModel),
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
        const fallback = this.buildToolOnlyFallback(nonClientToolOutputs);
        fullContent += fallback;
        writeChunk(fallback);
      }

      if (trackedClientExecutions.length > 0) {
        const marker = `\n\n<!-- CLIENT_EXECUTION_MARKER\n${JSON.stringify(trackedClientExecutions)}\n-->`;
        writeChunk(marker);
      }

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

  private buildToolOnlyFallback(
    toolOutputs: Array<{ toolName?: string; rawResult: string }>,
  ): string {
    const rows: string[] = [];

    for (const output of toolOutputs) {
      if (output.toolName === "summarizeFileFromLink") {
        const withoutLinks = output.rawResult
          .split("\n")
          .filter((line) => !line.trim().toLowerCase().startsWith("link:"))
          .join("\n")
          .trim();

        const fileMatch = withoutLinks.match(/file summary:\s*(.+)/i);
        const fileName = fileMatch?.[1]?.trim();
        const shortBody = withoutLinks
          .replace(/file summary:\s*.+/i, "")
          .replace(/summary:\s*/i, "")
          .trim()
          .slice(0, 260)
          .trim();

        if (fileName && shortBody) {
          rows.push(
            `- ${fileName}: ${shortBody}${shortBody.endsWith("...") ? "" : "..."}`,
          );
          continue;
        }
      }

      if (output.toolName === "extractFileFromLink") {
        const fileMatch = output.rawResult.match(/file:\s*(.+)/i);
        const fileName = fileMatch?.[1]?.trim() || "file";
        const contentMatch = output.rawResult.match(
          /<file_content>\s*([\S\s]*?)\s*<\/file_content>/i,
        );
        const content = contentMatch?.[1]
          ?.replace(/\s+/g, " ")
          .trim()
          .slice(0, 220);

        if (content) {
          rows.push(
            `- ${fileName}: ${content}${content.endsWith("...") ? "" : "..."}`,
          );
          continue;
        }
      }
    }

    if (rows.length > 0) {
      return `Here’s what I found:\n${rows.join("\n")}`;
    }

    return "I checked the attached files. Ask me for a summary, comparison, or specific file details.";
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
- reportIssue, provideFeedback, submitSuggestion, and submitInquiry only OPEN a pre-filled form — nothing is submitted until the user submits the form. After calling one, ask the user to review and submit the form. NEVER claim the report, feedback, suggestion, or inquiry was already submitted.

IMPORTANT: ${assignmentId ? `When calling tools that require assignmentId, always use ${assignmentId}` : "Assignment ID information is not available in the current context"}

RESPONSE STYLE:
- Warm, encouraging, and patient
- Use clear, simple language
- Break down complex explanations
- Use emojis sparingly to add warmth
- Always end with a question or next step to keep engagement`,
    };

    const fileToolGuidance = `

FILE LINK WORKFLOW:
- When chat context includes S3 links (format: s3://bucket/key), use tools to inspect files.
- Use \`extractFileFromLink\` when you need exact file content before answering.
- Use \`summarizeFileFromLink\` when the user asks for a quick overview.
- Never claim file details unless they came from a tool result in this chat.
- Keep file answers concise and user-friendly (no raw dumps).
- Do not expose S3 links, bucket names, or keys.
- For multi-file summaries, use this format: \`- <file name>: <one short sentence>\`.
- Prefer the user-facing file names from chat context and avoid internal storage names.
- For report/feedback/suggestion/inquiry form prefills, use only the user’s latest request. Do not include unrelated file lists.`;

    return (systemPrompts[userRole] || "") + fileToolGuidance;
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

  private sanitizePrefillDescription(description: string): string {
    const normalized = (description || "").trim();
    if (!normalized) return "";

    const lines = normalized.split(/\r?\n/);
    const cleanedLines: string[] = [];
    let skippingFileSection = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (startsFileSection(line)) {
        skippingFileSection = true;
        continue;
      }

      if (skippingFileSection) {
        if (!line || isFileMetadataLine(line) || isFileHintLine(line)) {
          continue;
        }
        if (/^\d+\.\s+/.test(line)) {
          continue;
        }
        skippingFileSection = false;
      }

      if (
        cleanedLines.length === 0 &&
        (isFileMetadataLine(line) || isFileHintLine(line))
      ) {
        continue;
      }

      const lastLine = cleanedLines.at(-1);
      if (line || (cleanedLines.length > 0 && lastLine !== "")) {
        cleanedLines.push(line);
      }
    }

    const cleaned = cleanedLines.join("\n").trim();
    return cleaned || normalized;
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
          inputSchema: definition.inputSchema,
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
          const sanitizedDescription =
            this.sanitizePrefillDescription(description);
          return this.showReportPreviewResult({
            issueType,
            description: sanitizedDescription,
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
          const sanitizedDescription =
            this.sanitizePrefillDescription(description);
          return this.showReportPreviewResult({
            type: "feedback",
            issueType: "FEEDBACK",
            description: sanitizedDescription,
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
          const sanitizedDescription =
            this.sanitizePrefillDescription(description);
          return this.showReportPreviewResult({
            type: "suggestion",
            issueType: "SUGGESTION",
            description: sanitizedDescription,
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
          const sanitizedDescription =
            this.sanitizePrefillDescription(description);
          return this.showReportPreviewResult({
            type: "inquiry",
            issueType: "OTHER",
            description: sanitizedDescription,
            assignmentId,
            userRole: "author",
            category: "Author Inquiry",
          });
        },
      },
    });
  }

  private learnerTools(
    userSession: UserSession,
    assignmentInfo?: MarkChatMessage,
  ): ToolSet {
    const assignmentIdFromContext = this.extractAssignmentIdFromContext(
      assignmentInfo?.content,
    );

    return this.toToolSet({
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
          const sanitizedDescription =
            this.sanitizePrefillDescription(description);
          return this.showReportPreviewResult({
            type: "report",
            issueType,
            description: sanitizedDescription,
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
          const sanitizedDescription =
            this.sanitizePrefillDescription(description);
          return this.showReportPreviewResult({
            type: "feedback",
            issueType: "FEEDBACK",
            description: sanitizedDescription,
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
          const sanitizedDescription =
            this.sanitizePrefillDescription(description);
          return this.showReportPreviewResult({
            type: "suggestion",
            issueType: "SUGGESTION",
            description: sanitizedDescription,
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
          const sanitizedDescription =
            this.sanitizePrefillDescription(description);
          return this.showReportPreviewResult({
            type: "inquiry",
            issueType: "OTHER",
            description: sanitizedDescription,
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
    });
  }

  private fileTools(allowedLinks: Set<string>): ToolSet {
    const maxFileExtractChars = this.getMaxFileExtractChars();

    return this.toToolSet({
      extractFileFromLink: {
        description:
          "Extract readable text from an S3 link in the format s3://bucket/key. Use this when the user asks about file details.",
        inputSchema: z.object({
          link: z
            .string()
            .describe("S3 link from chat context, e.g. s3://bucket/key"),
          maxChars: z
            .number()
            .min(MIN_FILE_EXTRACT_CHARS)
            .max(maxFileExtractChars)
            .optional()
            .describe("Maximum characters to return"),
        }),
        execute: withErrorHandling(
          async ({ link, maxChars }: { link: string; maxChars?: number }) => {
            if (!allowedLinks.has(link)) {
              throw new ForbiddenException("File not attached to this chat.");
            }
            const safeMaxChars = this.normalizeMaxChars(
              maxChars,
              maxFileExtractChars,
            );
            const extracted = await this.extractFileTextFromLink(
              link,
              safeMaxChars,
            );
            return [
              `File: ${extracted.filename}`,
              `Link: ${link}`,
              `Characters returned: ${extracted.content.length}`,
              "",
              "<file_content>",
              extracted.content,
              "</file_content>",
            ].join("\n");
          },
        ),
      },
      summarizeFileFromLink: {
        description:
          "Summarize a file from an S3 link in the format s3://bucket/key.",
        inputSchema: z.object({
          link: z
            .string()
            .describe("S3 link from chat context, e.g. s3://bucket/key"),
          maxChars: z
            .number()
            .min(MIN_FILE_EXTRACT_CHARS)
            .max(maxFileExtractChars)
            .optional()
            .describe("Maximum characters to read before summarizing"),
        }),
        execute: withErrorHandling(
          async ({ link, maxChars }: { link: string; maxChars?: number }) => {
            if (!allowedLinks.has(link)) {
              throw new ForbiddenException("File not attached to this chat.");
            }
            const safeMaxChars = this.normalizeMaxChars(
              maxChars,
              maxFileExtractChars,
            );
            const extracted = await this.extractFileTextFromLink(
              link,
              safeMaxChars,
            );
            const summary = this.buildContentSummary(extracted.content);
            return [
              `File summary: ${extracted.filename}`,
              `Link: ${link}`,
              summary,
            ].join("\n");
          },
        ),
      },
    });
  }

  private normalizeMaxChars(
    maxChars: number | undefined,
    maxAllowedChars: number,
  ): number {
    const defaultChars = this.getDefaultFileExtractChars(maxAllowedChars);

    if (!maxChars || !Number.isFinite(maxChars)) {
      return defaultChars;
    }
    return Math.min(
      maxAllowedChars,
      Math.max(MIN_FILE_EXTRACT_CHARS, Math.floor(maxChars)),
    );
  }

  private parseS3Link(link: string): { bucket: string; key: string } {
    if (!link || !link.startsWith("s3://")) {
      throw new BadRequestException("Only s3:// links are supported.");
    }

    const withoutScheme = link.slice("s3://".length);
    const firstSlashIndex = withoutScheme.indexOf("/");
    if (firstSlashIndex <= 0 || firstSlashIndex === withoutScheme.length - 1) {
      throw new BadRequestException("Invalid S3 link format.");
    }

    const bucket = withoutScheme.slice(0, firstSlashIndex).trim();
    const rawKey = withoutScheme.slice(firstSlashIndex + 1);
    let key: string;
    try {
      key = decodeURIComponent(rawKey);
    } catch {
      key = rawKey;
    }

    if (!bucket || !key) {
      throw new BadRequestException("Invalid S3 link format.");
    }

    return { bucket, key };
  }

  private async extractFileTextFromLink(
    link: string,
    maxChars: number,
  ): Promise<{ filename: string; content: string }> {
    const { bucket, key } = this.parseS3Link(link);
    const filename = this.toDisplayFileName(key);

    const response = await this.s3Service.getObject({
      Bucket: bucket,
      Key: key,
    });

    const fileSize = Number(response.ContentLength ?? 0);
    if (fileSize > MAX_FILE_BYTES) {
      if (
        response.Body &&
        typeof (response.Body as { destroy?: () => void }).destroy ===
          "function"
      ) {
        (response.Body as { destroy: () => void }).destroy();
      }
      throw new BadRequestException(
        `File is too large to extract (${fileSize} bytes). Max allowed is ${MAX_FILE_BYTES} bytes.`,
      );
    }

    const reservation = Math.max(fileSize, 1);
    await this.processingBudget.acquire(reservation);
    try {
      const contentType =
        typeof response.ContentType === "string"
          ? response.ContentType
          : undefined;

      let fileBuffer: Buffer;
      if (response.Body instanceof Buffer) {
        fileBuffer = response.Body;
      } else if (response.Body) {
        const chunks: Uint8Array[] = [];
        const stream = response.Body as NodeJS.ReadableStream;
        fileBuffer = await new Promise<Buffer>((resolve, reject) => {
          stream.on("data", (chunk) =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
          );
          stream.on("end", () => resolve(Buffer.concat(chunks)));
          stream.on("error", reject);
        });
      } else {
        throw new BadRequestException(`Could not retrieve file: ${key}`);
      }

      const [extractedFile] =
        await this.fileContentExtractionService.extractContentFromFiles(
          [
            {
              filename,
              content: "",
              fileType: contentType,
              bucket,
              key,
              buffer: fileBuffer,
            },
          ],
          {
            useStructuredExtraction: false,
            useVisionForPDFs: false,
          },
        );

      const normalized = (
        extractedFile?.extractedText ||
        extractedFile?.content ||
        ""
      )
        .replaceAll("\0", "")
        .trim();
      if (!normalized) {
        return { filename, content: "No readable text content found." };
      }

      return {
        filename,
        content:
          normalized.length > maxChars
            ? normalized.slice(0, maxChars) + "\n...[truncated]"
            : normalized,
      };
    } finally {
      this.processingBudget.release(reservation);
    }
  }

  private toDisplayFileName(key: string): string {
    const keyTail = key.split("/").pop() || key;
    let decodedTail: string;
    try {
      decodedTail = decodeURIComponent(keyTail);
    } catch {
      decodedTail = keyTail;
    }
    const randomPrefixMatch = decodedTail.match(
      /^[\da-z]{10,}-(.+\.[\da-z]{1,10})$/i,
    );

    if (randomPrefixMatch?.[1]) {
      return randomPrefixMatch[1];
    }

    return decodedTail;
  }

  private buildContentSummary(content: string): string {
    const normalized = content.split(/\s+/).join(" ").trim();
    if (!normalized) return "Summary: No readable text found.";

    const words = normalized.split(" ").filter(Boolean);
    const sentenceCandidates = content
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 8);
    const highlights = sentenceCandidates
      .map((line, index) => `${index + 1}. ${line}`)
      .join("\n");

    const shortSummary =
      normalized.length > 1000 ? normalized.slice(0, 1000) + "..." : normalized;

    return [
      `Summary:`,
      `- Approx words: ${words.length}`,
      `- Key excerpts:`,
      highlights || "1. (No clear excerpts found)",
      "",
      `Short overview:`,
      shortSummary,
    ].join("\n");
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
