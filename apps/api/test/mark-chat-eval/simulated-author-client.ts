/**
 * Stands in for the author's browser in Mark chat evals: the author store, the
 * context message, the conversation the client sends, and the client-side
 * execution of the operations the server hands back.
 *
 * It mirrors the current web client so a replay sees what production sees.
 * When the client changes, change this to match:
 * - context message      apps/web/app/chatbot/store/useAuthorContext.ts (getContextMessage)
 * - conversation sent    apps/web/app/chatbot/components/MarkChat.tsx + store/useMarkChatStore.ts (sendMessage)
 * - marker parsing       apps/web/app/chatbot/store/useMarkChatStore.ts (CLIENT_EXECUTION_MARKER)
 * - operation results    apps/web/app/chatbot/store/AuthorStoreBridge.ts + authorStoreUtil.ts
 * - result message       apps/web/app/chatbot/store/useMarkChatStore.ts (processOperationResults)
 * - generation counts    apps/web/lib/question-generation/client.ts
 * - publish ID remap     apps/web/app/author/(components)/Header/index.tsx
 *
 * Generated questions are stubs: the eval measures what the agent does, not
 * the quality of the generation job.
 */

export type QuestionOrigin = "author" | "mark";

export interface SimulatedChoice {
  choice: string;
  isCorrect: boolean;
  points: number;
}

export interface SimulatedQuestion {
  id: number;
  type: string;
  question: string;
  totalPoints: number;
  choices?: SimulatedChoice[];
  /** Harness-only bookkeeping; never shown to the model. */
  origin: QuestionOrigin;
  /** As in the author store: false until publish gives it a database ID. */
  alreadyInBackend?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ClientOperation {
  function: string;
  params: any;
}

export interface OperationResult {
  function: string;
  params: any;
  success: boolean;
  message: string;
}

const GREETING =
  "Hello, I'm Mark! How can I help you with your assignment today?";
const CLIENT_EXECUTION_MARKER = /<!-- CLIENT_EXECUTION_MARKER\n([\S\s]*?)\n-->/;
const CLIENT_EXECUTION_MARKER_GLOBAL =
  /<!-- CLIENT_EXECUTION_MARKER\n[\S\s]*?\n-->/g;

const DEFAULT_CHAT_COUNT = 5;
const DEFAULT_CHAT_QUESTION_TYPES = [
  "SINGLE_CORRECT",
  "MULTIPLE_CORRECT",
  "TEXT",
  "TRUE_FALSE",
];
const GENERATABLE_TYPES = new Set([
  "SINGLE_CORRECT",
  "MULTIPLE_CORRECT",
  "TEXT",
  "TRUE_FALSE",
  "URL",
  "UPLOAD",
  "LINK_FILE",
]);
const QUESTION_TYPE_ALIASES: Record<string, string> = {
  MULTIPLE_CHOICE: "SINGLE_CORRECT",
  MULTIPLE_SELECT: "MULTIPLE_CORRECT",
  TEXT_RESPONSE: "TEXT",
  TRUEFALSE: "TRUE_FALSE",
  LINK_OR_FILE: "LINK_FILE",
};
const CREATABLE_TYPES = new Set([
  "SINGLE_CORRECT",
  "MULTIPLE_CORRECT",
  "TEXT",
  "TRUE_FALSE",
  "URL",
  "UPLOAD",
]);

/**
 * Stub text for generated questions. It reads like real output so the model
 * cannot pick Mark's questions out of the list by wording alone.
 */
const GENERATED_STEMS = [
  "Which organ is primarily responsible for filtering blood?",
  "Which bone protects the brain?",
  "What is the largest organ of the human body?",
  "Which body system transports oxygen to the tissues?",
  "What does the term 'anterior' describe?",
  "Which muscle separates the chest from the abdomen?",
  "Which bones make up the forearm?",
  "Where is the small intestine located relative to the stomach?",
  "Which organ produces insulin?",
  "What is the function of the ribcage?",
  "Which chamber of the heart pumps blood to the body?",
  "What does the term 'proximal' mean?",
  "Which organs belong to the respiratory system?",
  "What connects muscle to bone?",
  "Which part of the skeleton protects the spinal cord?",
  "Which organ stores bile?",
  "What is the anatomical position?",
  "Which bones form the pelvic girdle?",
  "Which organ system removes waste from the blood?",
  "What does the term 'lateral' describe?",
];

/** Same range as generateTempQuestionId in apps/web/lib/utils.ts. */
function temporaryQuestionId(): number {
  return Math.floor(Math.random() * 2e9);
}

export interface SimulatedAuthorClientOptions {
  assignmentId: number;
  name: string;
  learningObjectives?: string;
  questions: SimulatedQuestion[];
}

export class SimulatedAuthorClient {
  readonly assignmentId: number;
  readonly name: string;
  learningObjectives: string;
  questions: SimulatedQuestion[];
  messages: ChatMessage[] = [
    { id: "assistant-initial", role: "assistant", content: GREETING },
  ];

  private generatedCount = 0;
  private nextMessageId = 1;

  constructor(options: SimulatedAuthorClientOptions) {
    this.assignmentId = options.assignmentId;
    this.name = options.name;
    this.learningObjectives = options.learningObjectives ?? "";
    // Seeded questions were loaded from the backend.
    this.questions = options.questions.map((question) => ({
      ...question,
      alreadyInBackend: question.alreadyInBackend ?? true,
    }));
  }

  /** Questions Mark has added that are still in the draft. */
  get markQuestions(): SimulatedQuestion[] {
    return this.questions.filter((question) => question.origin === "mark");
  }

  get authorQuestions(): SimulatedQuestion[] {
    return this.questions.filter((question) => question.origin === "author");
  }

  snapshot(): SimulatedQuestion[] {
    return this.questions.map((question) => ({
      ...question,
      choices: question.choices?.map((choice) => ({ ...choice })),
    }));
  }

  /**
   * The conversation the client posts for the next user turn: history with
   * any old context dropped, plus a freshly built context message. The new
   * user text travels separately as `userText`.
   */
  conversationForSend(): ChatMessage[] {
    const history = this.messages.filter(
      (message) => message.role !== "system" || !message.id.includes("context"),
    );
    const context = this.buildContextMessage();
    const lastUserIndex = history
      .map((message, index) => (message.role === "user" ? index : -1))
      .filter((index) => index !== -1)
      .pop();
    const withContext = [...history];
    withContext.splice(lastUserIndex ?? 0, 0, context);
    return withContext;
  }

  addUserMessage(content: string): void {
    this.messages.push({ id: this.messageId("user"), role: "user", content });
  }

  /**
   * Stores the streamed reply the way the client does (marker stripped) and
   * returns the operations the marker carried.
   */
  receiveAssistantReply(streamed: string): {
    reply: string;
    operations: ClientOperation[];
  } {
    const markerMatch = streamed.match(CLIENT_EXECUTION_MARKER);
    const reply = streamed.replace(CLIENT_EXECUTION_MARKER_GLOBAL, "");
    this.messages.push({
      id: this.messageId("assistant"),
      role: "assistant",
      content: reply,
    });
    const operations = markerMatch
      ? (JSON.parse(markerMatch[1]) as ClientOperation[])
      : [];
    return { reply, operations };
  }

  /** Runs the operations and appends the ✅ result message, like executeOperations. */
  executeOperations(operations: ClientOperation[]): OperationResult[] {
    if (operations.length === 0) return [];

    const results = operations.map((operation) => this.runOperation(operation));
    this.messages.push({
      id: this.messageId("assistant-operations"),
      role: "assistant",
      content: processOperationResults(results),
    });
    return results;
  }

  /**
   * Publish reloads every question from the backend: questions that only had
   * a temporary client ID come back with the next database IDs.
   */
  publish(): void {
    let nextDatabaseId =
      Math.max(
        0,
        ...this.questions
          .filter((question) => question.alreadyInBackend)
          .map((question) => question.id),
      ) + 1;
    this.questions = this.questions.map((question) =>
      question.alreadyInBackend
        ? question
        : { ...question, id: nextDatabaseId++, alreadyInBackend: true },
    );
  }

  buildContextMessage(): ChatMessage {
    let content = "MARK ASSISTANT CONTEXT (AUTHOR MODE):\n\n";
    content += `Assignment: ${this.name || "Untitled Assignment"}\n`;
    content += `Assignment ID: ${this.assignmentId || "Not saved yet"}\n`;
    content += `Number of Questions: ${this.questions.length}\n`;

    if (this.learningObjectives) {
      content += `\nLEARNING OBJECTIVES:\n${this.learningObjectives}\n\n`;
    }

    content += `\nASSIGNMENT STRUCTURE:\n`;
    content += `- Introduction: Not defined\n`;
    content += `- Instructions: Not defined\n`;
    content += `- Grading Criteria: Not defined\n`;

    if (this.questions.length > 0) {
      content += "\nQUESTIONS OVERVIEW:\n";
      content += "Question List:\n";
      for (const [index, question] of this.questions.entries()) {
        content += `${index + 1}. [ID: ${question.id}] ${
          question.question
            ? question.question.slice(0, 50) + "..."
            : "Untitled Question"
        } (${question.type || "Unknown"})\n`;
      }

      // With nothing focused the client treats the first question as current.
      const current = this.questions[0];
      content += `\nCURRENT FOCUSED QUESTION:\n`;
      content += `Question ID: ${current.id}\n`;
      content += `Type: ${current.type}\n`;
      content += `Points: ${current.totalPoints || 0}\n`;
      content += `Question Text: ${current.question || "No question text"}\n`;
      if (
        (current.type === "SINGLE_CORRECT" ||
          current.type === "MULTIPLE_CORRECT") &&
        Array.isArray(current.choices)
      ) {
        content += "\nAnswer Choices:\n";
        for (const [index, choice] of current.choices.entries()) {
          content += `${index + 1}. ${choice.isCorrect ? "✓" : "✗"} ${
            choice.choice || "Empty choice"
          } (${choice.points || 0} points)\n`;
        }
      }
    }

    content += "\nAUTHOR CAPABILITIES:\n";
    content +=
      "- Create new questions (multiple choice, text response, true/false, etc.)\n";
    content += "- Modify existing questions\n";
    content += "- Generate question variants\n";
    content += "- Create or modify scoring rubrics\n";
    content += "- Generate questions based on learning objectives\n";

    content += "\nREQUIRED BEHAVIOR:\n";
    content +=
      "1. Follow instructional design best practices when helping with assignment creation\n";
    content += "2. Focus on creating clear, pedagogically sound questions\n";
    content +=
      "3. Suggest improvements to question wording, answer choices, and rubrics\n";
    content += "4. Provide detailed explanations when generating content\n";
    content +=
      "5. When suggesting questions, provide complete question text and answer options\n";
    content +=
      "6. Use tools to implement changes when the author approves your suggestions\n";

    return {
      id: `system-context-${this.nextMessageId++}`,
      role: "system",
      content,
    };
  }

  private messageId(prefix: string): string {
    return `${prefix}-${this.nextMessageId++}`;
  }

  private find(questionId: unknown): SimulatedQuestion {
    const id = Number.parseInt(String(questionId), 10);
    if (Number.isNaN(id)) throw new Error("Invalid question ID format");
    const question = this.questions.find((candidate) => candidate.id === id);
    if (!question) throw new Error(`Question with ID ${id} not found`);
    return question;
  }

  private runOperation(operation: ClientOperation): OperationResult {
    const parameters = operation.params ?? {};
    const outcome = (success: boolean, message: string): OperationResult => ({
      function: operation.function,
      params: parameters,
      success,
      message,
    });

    switch (operation.function) {
      case "showReportPreview": {
        return outcome(true, "Report preview form will be displayed");
      }

      case "generateQuestionsFromObjectives": {
        try {
          const added = this.generate(parameters);
          return outcome(
            true,
            `Successfully generated ${added.length} questions based on your learning objectives.`,
          );
        } catch (error) {
          return outcome(
            false,
            `Failed to generate questions: ${(error as Error).message}`,
          );
        }
      }

      case "createQuestion": {
        const type = String(parameters.questionType ?? "");
        if (!type || !parameters.questionText) {
          return outcome(
            false,
            "Error creating question: Question type and text are required",
          );
        }
        if (!CREATABLE_TYPES.has(type)) {
          return outcome(
            false,
            `Error creating question: Unsupported question type: ${type}`,
          );
        }
        const [question] = this.addGenerated([type]);
        return outcome(
          true,
          `Successfully created a new ${type} question with ID ${question.id}.`,
        );
      }

      case "modifyQuestion": {
        try {
          const question = this.find(parameters.questionId);
          if (parameters.questionText != undefined) {
            question.question = String(parameters.questionText);
          }
          if (parameters.totalPoints != undefined) {
            question.totalPoints = Number(parameters.totalPoints);
          }
          // The bridge writes the type through unvalidated; so does this.
          if (parameters.questionType != undefined) {
            question.type = String(parameters.questionType);
          }
          return outcome(
            true,
            `Successfully modified question ${question.id}.`,
          );
        } catch (error) {
          return outcome(
            false,
            `Error modifying question: ${(error as Error).message}`,
          );
        }
      }

      case "setQuestionChoices": {
        try {
          const question = this.find(parameters.questionId);
          const choices = parameters.choices as
            | Array<{ text?: string; isCorrect?: boolean; points?: number }>
            | undefined;
          if (!Array.isArray(choices) || choices.length === 0) {
            throw new Error("Choices must be a non-empty array");
          }
          if (!["SINGLE_CORRECT", "MULTIPLE_CORRECT"].includes(question.type)) {
            question.type = "SINGLE_CORRECT";
          }
          question.choices = choices.map((choice) => ({
            choice: choice.text || "",
            isCorrect: choice.isCorrect || false,
            points:
              choice.points === undefined
                ? question.type === "MULTIPLE_CORRECT"
                  ? choice.isCorrect
                    ? 1
                    : -1
                  : 0
                : choice.points,
          }));
          return outcome(
            true,
            `Successfully updated choices for question ${question.id}${
              parameters.variantId ? ` variant ${parameters.variantId}` : ""
            }.`,
          );
        } catch (error) {
          return outcome(
            false,
            `Error setting question choices: ${(error as Error).message}`,
          );
        }
      }

      case "addRubric": {
        try {
          const question = this.find(parameters.questionId);
          return outcome(
            true,
            `Successfully added rubric to question ${question.id}.`,
          );
        } catch (error) {
          return outcome(
            false,
            `Failed to add rubric: ${(error as Error).message}`,
          );
        }
      }

      case "generateQuestionVariant": {
        try {
          const question = this.find(parameters.questionId);
          const variantType = String(parameters.variantType ?? "");
          return outcome(
            true,
            `Successfully created ${variantType.toLowerCase()} variant for question ${question.id}.`,
          );
        } catch (error) {
          return outcome(
            false,
            `Failed to generate variant: ${(error as Error).message}`,
          );
        }
      }

      case "deleteQuestion": {
        try {
          const question = this.find(parameters.questionId);
          this.questions = this.questions.filter(
            (candidate) => candidate !== question,
          );
          return outcome(true, `Successfully deleted question ${question.id}.`);
        } catch (error) {
          return outcome(
            false,
            `Failed to delete question: ${(error as Error).message}`,
          );
        }
      }

      case "updateLearningObjectives": {
        this.learningObjectives = String(parameters.learningObjectives ?? "");
        return outcome(true, "Successfully updated learning objectives.");
      }

      case "setQuestionTitle": {
        try {
          const question = this.find(parameters.questionId);
          return outcome(
            true,
            `Successfully updated title for question ${question.id}.`,
          );
        } catch (error) {
          return outcome(
            false,
            `Failed to update title: ${(error as Error).message}`,
          );
        }
      }

      default: {
        return outcome(
          false,
          `Operation ${operation.function} not found in bridge`,
        );
      }
    }
  }

  /** Same count and type rules as buildQuestionGenerationPayloadFromObjectives. */
  private generate(parameters: any): SimulatedQuestion[] {
    const learningObjectives = String(parameters.learningObjectives ?? "");
    if (!learningObjectives.trim()) {
      throw new Error("No learning objectives provided");
    }

    const subtypeTotal = Object.values(
      (parameters.multipleChoiceSubtypes ?? {}) as Record<string, unknown>,
    ).reduce<number>(
      (total, count) => total + Math.max(0, Math.floor(Number(count) || 0)),
      0,
    );
    const hasSubtypes = parameters.multipleChoiceSubtypes !== undefined;
    const rawCount = Number(parameters.count);
    const regularCount =
      Number.isFinite(rawCount) && rawCount > 0
        ? Math.max(1, Math.floor(rawCount))
        : hasSubtypes
          ? 0
          : DEFAULT_CHAT_COUNT;

    const requestedTypes = Array.isArray(parameters.questionTypes)
      ? (parameters.questionTypes as unknown[])
          .map((type) => {
            const normalized = String(type).trim().toUpperCase();
            return QUESTION_TYPE_ALIASES[normalized] ?? normalized;
          })
          .filter((type) => GENERATABLE_TYPES.has(type))
      : [];
    const types =
      requestedTypes.length > 0
        ? [...new Set(requestedTypes)]
        : DEFAULT_CHAT_QUESTION_TYPES;

    const plan: string[] = [];
    for (let index = 0; index < regularCount; index++) {
      plan.push(types[index % types.length]);
    }
    for (let index = 0; index < subtypeTotal; index++) {
      plan.push("SINGLE_CORRECT");
    }

    return this.addGenerated(plan);
  }

  private addGenerated(types: string[]): SimulatedQuestion[] {
    const added = types.map((type) => {
      const question: SimulatedQuestion = {
        id: temporaryQuestionId(),
        type,
        question:
          GENERATED_STEMS[this.generatedCount++ % GENERATED_STEMS.length],
        totalPoints: 10,
        origin: "mark",
        alreadyInBackend: false,
      };
      if (type === "SINGLE_CORRECT" || type === "MULTIPLE_CORRECT") {
        const correctCount = type === "MULTIPLE_CORRECT" ? 2 : 1;
        question.choices = ["A", "B", "C", "D"].map((label, choiceIndex) => ({
          choice: `Option ${label}`,
          isCorrect: choiceIndex < correctCount,
          points: choiceIndex < correctCount ? 1 : 0,
        }));
      }
      return question;
    });
    this.questions.push(...added);
    return added;
  }
}

/** Verbatim port of processOperationResults in useMarkChatStore.ts. */
export function processOperationResults(results: OperationResult[]): string {
  if (results.length === 0) {
    return "No operations were executed.";
  }

  const successes = results.filter((result) => result.success).length;
  const failures = results.filter((result) => !result.success).length;

  let message = `✅ I've completed ${successes} operation${successes === 1 ? "" : "s"}`;
  if (failures > 0) {
    message += ` with ${failures} error${failures === 1 ? "" : "s"}`;
  }
  message += ".\n\n";

  for (const [index, result] of results.entries()) {
    const functionName =
      result.function.charAt(0).toUpperCase() + result.function.slice(1);
    message += result.success
      ? `${index + 1}. ${functionName}: Successfully completed - ${result.message}`
      : `${index + 1}. ${functionName}: Failed - ${result.message}`;
    message += "\n";
  }

  return message;
}
