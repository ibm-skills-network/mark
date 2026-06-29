import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Logger } from "winston";
import type { ZodTypeAny } from "zod";
import { LlmStructuredResponse } from "../interfaces/llm-provider.interface";
import { ITokenCounter } from "../interfaces/token-counter.interface";

/**
 * Shared native-structured-output invocation for every ChatOpenAI-based
 * provider. The model fills the schema fields and the SDK serializes the JSON,
 * so the output cannot be syntactically invalid JSON — eliminating the
 * unescaped-quote / control-character parse failures that free-form "respond
 * with JSON" generation produces on code-heavy submissions.
 *
 * Single-sourced so a provider gains structured output with a 3-line delegation
 * and the behaviour cannot drift between providers.
 */
export async function invokeStructuredChatModel<T>(
  model: ChatOpenAI,
  messages: HumanMessage[],
  schema: ZodTypeAny,
  tokenCounter: ITokenCounter,
  logger: Logger,
  modelName: string,
): Promise<LlmStructuredResponse<T>> {
  const structuredModel = model.withStructuredOutput(schema, {
    name: "structured_response",
    includeRaw: true,
  });

  const inputText = messages
    .map((m) =>
      typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    )
    .join("\n");
  const inputTokens = tokenCounter.countTokens(inputText);

  logger.info("openai.invokeStructured.start", {
    model_name: modelName,
    input_tokens: inputTokens,
    input_full_length: inputText.length,
    input_snippet: inputText.slice(0, 400),
    message_count: messages.length,
  });

  const start = Date.now();
  try {
    const result = (await structuredModel.invoke(messages)) as {
      raw: {
        usage_metadata?: { input_tokens?: number; output_tokens?: number };
      };
      parsed: T;
    };

    const usage = result.raw?.usage_metadata;
    const inputUsed = usage?.input_tokens ?? inputTokens;
    const outputUsed =
      usage?.output_tokens ??
      tokenCounter.countTokens(JSON.stringify(result.parsed));

    logger.info("openai.invokeStructured.complete", {
      model_name: modelName,
      input_tokens: inputUsed,
      output_tokens: outputUsed,
      duration_ms: Date.now() - start,
    });

    return {
      parsed: result.parsed,
      tokenUsage: { input: inputUsed, output: outputUsed },
    };
  } catch (error) {
    logger.error("openai.invokeStructured.failed", {
      model_name: modelName,
      input_tokens: inputTokens,
      duration_ms: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
