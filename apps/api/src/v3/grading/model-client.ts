import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";
import type {
  ResponseCreateParamsNonStreaming,
  ResponseInputContent,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { GradingUsage, ModelEffort } from "./contracts";

export type PromptContent =
  | { type: "text"; text: string }
  | { type: "file"; filename: string; mimeType: string; base64: string }
  | { type: "image"; mimeType: string; base64: string };

export interface PromptMessage {
  role: "developer" | "user" | "assistant";
  content: PromptContent[];
}

export interface GradingModelRequest {
  messages: PromptMessage[];
  effort: ModelEffort;
  /** Name and JSON schema for strict structured output. */
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** Cap on reasoning plus answer tokens. */
  maxOutputTokens: number;
  /** Ask for a detailed reasoning summary (debug runs only). */
  reasoningSummary?: boolean;
}

export interface GradingModelResponse {
  /** Raw JSON text the model returned; the caller parses and validates it. */
  outputText: string;
  usage: GradingUsage;
  model: string;
  /** Reasoning summary texts, when the request asked for them. */
  reasoningSummary?: string[];
}

/** The one call v3 grading makes to a model. Tests use a fake. */
export interface GradingModelClient {
  complete(request: GradingModelRequest): Promise<GradingModelResponse>;
  /** The least reasoning the model accepts; "low" when unset. */
  readonly lowestEffort?: ModelEffort;
}

/** The model could not be reached or refused for capacity; a retry may work. */
export class GradingModelUnavailableError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GradingModelUnavailableError";
  }
}

/** The model answered with something unusable (refusal, incomplete, no text). */
export class GradingModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradingModelOutputError";
  }
}

/** The answer was cut off at the output token cap, usually by long reasoning. */
export class GradingModelOutputLimitError extends GradingModelOutputError {
  constructor(readonly usage: GradingUsage) {
    super("response not completed: max_output_tokens");
    this.name = "GradingModelOutputLimitError";
  }
}

export const DEFAULT_GRADING_MODEL = "gpt-6-luna";

function toUsage(
  usage: OpenAI.Responses.ResponseUsage | undefined,
): GradingUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

function toInputContent(content: PromptContent): ResponseInputContent {
  switch (content.type) {
    case "text": {
      return { type: "input_text", text: content.text };
    }
    case "file": {
      return {
        type: "input_file",
        filename: content.filename,
        file_data: `data:${content.mimeType};base64,${content.base64}`,
      };
    }
    case "image": {
      return {
        type: "input_image",
        detail: "high",
        image_url: `data:${content.mimeType};base64,${content.base64}`,
      };
    }
  }
}

function toInputItem(message: PromptMessage): ResponseInputItem {
  if (message.role === "assistant") {
    // Prior model output goes back as plain text.
    return {
      role: "assistant",
      content: message.content
        .map((content) => (content.type === "text" ? content.text : ""))
        .join("\n"),
    };
  }
  return {
    role: message.role,
    content: message.content.map((content) => toInputContent(content)),
  };
}

export function toResponsesRequest(
  request: GradingModelRequest,
  model: string,
): ResponseCreateParamsNonStreaming {
  // The SDK's ReasoningEffort predates "none", which Luna accepts.
  const effort = request.effort as ReasoningEffort;
  return {
    model,
    input: request.messages.map((message) => toInputItem(message)),
    reasoning: request.reasoningSummary
      ? { effort, summary: "detailed" }
      : { effort },
    max_output_tokens: request.maxOutputTokens,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: request.schemaName,
        strict: true,
        schema: request.jsonSchema,
      },
    },
  };
}

function isUnavailable(
  error: unknown,
): error is InstanceType<typeof OpenAI.APIError> {
  if (error instanceof OpenAI.APIConnectionError) return true;
  if (error instanceof OpenAI.APIError) {
    const status: number = typeof error.status === "number" ? error.status : 0;
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  return false;
}

export interface OpenAiGradingModelClientOptions {
  /** Defaults to OPENAI_API_KEY, the same variable legacy grading uses. */
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  client?: OpenAI;
}

/** GradingModelClient over the OpenAI Responses API. */
export class OpenAiGradingModelClient implements GradingModelClient {
  private readonly client: OpenAI;
  readonly model: string;
  readonly lowestEffort: ModelEffort;

  constructor(options: OpenAiGradingModelClientOptions = {}) {
    this.model =
      options.model ?? process.env.GRADING_V3_MODEL ?? DEFAULT_GRADING_MODEL;
    // Only Luna takes reasoning effort "none"; Terra and Sol stop at "low".
    this.lowestEffort = this.model.startsWith("gpt-6-luna") ? "none" : "low";
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey ?? process.env.OPENAI_API_KEY, // pragma: allowlist secret
        timeout: options.timeoutMs ?? 300_000,
        maxRetries: options.maxRetries ?? 2,
      });
  }

  async complete(request: GradingModelRequest): Promise<GradingModelResponse> {
    let response: OpenAI.Responses.Response;
    try {
      response = await this.client.responses.create(
        toResponsesRequest(request, this.model),
      );
    } catch (error) {
      if (isUnavailable(error)) {
        throw new GradingModelUnavailableError(
          `model unavailable: ${error.message}`,
          error.status,
        );
      }
      throw error;
    }

    if (response.status && response.status !== "completed") {
      const reason = response.incomplete_details?.reason ?? response.status;
      if (reason === "max_output_tokens") {
        throw new GradingModelOutputLimitError(toUsage(response.usage));
      }
      throw new GradingModelOutputError(`response not completed: ${reason}`);
    }
    const refusal = response.output
      .flatMap((item) => (item.type === "message" ? item.content : []))
      .find((content) => content.type === "refusal");
    if (refusal) {
      throw new GradingModelOutputError("model refused to grade");
    }
    const outputText = response.output_text;
    if (!outputText) {
      throw new GradingModelOutputError("model returned no text");
    }
    const reasoningSummary = request.reasoningSummary
      ? response.output
          .flatMap((item) => (item.type === "reasoning" ? item.summary : []))
          .filter((summary) => summary.type === "summary_text")
          .map((summary) => summary.text)
      : undefined;
    return {
      outputText,
      ...(reasoningSummary ? { reasoningSummary } : {}),
      model: response.model ?? this.model,
      usage: toUsage(response.usage),
    };
  }
}
