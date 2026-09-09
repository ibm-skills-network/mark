import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { Logger } from "winston";
import {
  ZodArray,
  ZodDefault,
  ZodEffects,
  ZodNullable,
  ZodObject,
  ZodOptional,
  ZodRawShape,
  ZodRecord,
  ZodTypeAny,
  ZodUnion,
} from "zod";
import { LlmStructuredResponse } from "../interfaces/llm-provider.interface";
import { ITokenCounter } from "../interfaces/token-counter.interface";

/**
 * OpenAI strict structured outputs require every schema field to be present
 * in `required`, so the SDK rejects any Zod schema that uses `.optional()`
 * without `.nullable()` before a request is even sent. Widen each optional
 * field to also accept null for the API call; `normalizeWidenedOutput` maps
 * the nulls the model emits for those fields back to undefined so callers
 * keep the original schema's types. Subtrees that need no widening are
 * returned as-is, so already-compatible schemas pass through unchanged.
 */
export function widenOptionalsForStrictOutput(schema: ZodTypeAny): ZodTypeAny {
  if (schema instanceof ZodOptional) {
    const inner = schema.unwrap() as ZodTypeAny;
    const widenedInner = widenOptionalsForStrictOutput(inner);
    if (widenedInner === inner && inner.isNullable()) {
      return schema;
    }
    return new ZodOptional({
      ...schema._def,
      innerType: widenedInner.isNullable()
        ? widenedInner
        : ZodNullable.create(widenedInner),
    });
  }
  if (schema instanceof ZodNullable) {
    const inner = schema.unwrap() as ZodTypeAny;
    const widenedInner = widenOptionalsForStrictOutput(inner);
    return widenedInner === inner
      ? schema
      : new ZodNullable({ ...schema._def, innerType: widenedInner });
  }
  if (schema instanceof ZodDefault) {
    const inner = schema.removeDefault() as ZodTypeAny;
    const widenedInner = widenOptionalsForStrictOutput(inner);
    return widenedInner === inner
      ? schema
      : new ZodDefault({ ...schema._def, innerType: widenedInner });
  }
  if (schema instanceof ZodEffects) {
    const inner = schema.innerType() as ZodTypeAny;
    const widenedInner = widenOptionalsForStrictOutput(inner);
    return widenedInner === inner
      ? schema
      : new ZodEffects({ ...schema._def, schema: widenedInner });
  }
  if (schema instanceof ZodObject) {
    const shape = schema.shape as ZodRawShape;
    let changed = false;
    const widenedShape: ZodRawShape = {};
    for (const [key, value] of Object.entries(shape)) {
      const widened = widenOptionalsForStrictOutput(value);
      widenedShape[key] = widened;
      changed = changed || widened !== value;
    }
    return changed
      ? new ZodObject({ ...schema._def, shape: () => widenedShape })
      : schema;
  }
  if (schema instanceof ZodArray) {
    const element = schema.element as ZodTypeAny;
    const widened = widenOptionalsForStrictOutput(element);
    return widened === element
      ? schema
      : new ZodArray({ ...schema._def, type: widened });
  }
  if (schema instanceof ZodRecord) {
    const value = schema.valueSchema as ZodTypeAny;
    const widened = widenOptionalsForStrictOutput(value);
    return widened === value
      ? schema
      : new ZodRecord({ ...schema._def, valueType: widened });
  }
  if (schema instanceof ZodUnion) {
    const options = schema.options as ZodTypeAny[];
    const widenedOptions = options.map((option) =>
      widenOptionalsForStrictOutput(option),
    );
    return widenedOptions.every((option, index) => option === options[index])
      ? schema
      : new ZodUnion({
          ...schema._def,
          options: widenedOptions as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]],
        });
  }
  return schema;
}

/**
 * Walk `value` alongside the ORIGINAL (pre-widening) schema and turn the
 * nulls that only exist because of widening back into undefined. Fields the
 * original schema already declared `.nullable()` keep their nulls.
 */
export function normalizeWidenedOutput(
  schema: ZodTypeAny,
  value: unknown,
): unknown {
  if (schema instanceof ZodOptional) {
    const inner = schema.unwrap() as ZodTypeAny;
    if (value === null && !inner.isNullable()) {
      return undefined;
    }
    return normalizeWidenedOutput(inner, value);
  }
  if (schema instanceof ZodNullable) {
    return value === null
      ? null
      : normalizeWidenedOutput(schema.unwrap() as ZodTypeAny, value);
  }
  if (schema instanceof ZodDefault) {
    return normalizeWidenedOutput(schema.removeDefault() as ZodTypeAny, value);
  }
  if (schema instanceof ZodEffects) {
    return normalizeWidenedOutput(schema.innerType() as ZodTypeAny, value);
  }
  if (schema instanceof ZodObject && isPlainObject(value)) {
    const shape = schema.shape as ZodRawShape;
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const fieldSchema = shape[key];
      if (!fieldSchema) {
        normalized[key] = entry;
        continue;
      }
      const normalizedEntry = normalizeWidenedOutput(fieldSchema, entry);
      if (normalizedEntry !== undefined) {
        normalized[key] = normalizedEntry;
      }
    }
    return normalized;
  }
  if (schema instanceof ZodArray && Array.isArray(value)) {
    const element = schema.element as ZodTypeAny;
    return value.map((entry) => normalizeWidenedOutput(element, entry));
  }
  if (schema instanceof ZodRecord && isPlainObject(value)) {
    const valueSchema = schema.valueSchema as ZodTypeAny;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        normalizeWidenedOutput(valueSchema, entry),
      ]),
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const widenedSchemaCache = new WeakMap<ZodTypeAny, ZodTypeAny>();

function getWidenedSchema(schema: ZodTypeAny): ZodTypeAny {
  const cached = widenedSchemaCache.get(schema);
  if (cached) {
    return cached;
  }
  const widened = widenOptionalsForStrictOutput(schema);
  widenedSchemaCache.set(schema, widened);
  return widened;
}

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
  const structuredModel = model.withStructuredOutput(getWidenedSchema(schema), {
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
        usage_metadata?: {
          input_tokens?: number;
          output_tokens?: number;
          input_token_details?: { cache_read?: number };
        };
      };
      parsed: T | null | undefined;
    };

    // With includeRaw, LangChain reports schema-parse failures as
    // parsed=null instead of throwing. Surface that as an error so callers
    // hit their retry/fallback paths instead of crashing on a null grade.
    if (result.parsed === null || result.parsed === undefined) {
      throw new Error(
        "Structured output parsing produced no result (model output did not match the schema)",
      );
    }

    const parsed = normalizeWidenedOutput(schema, result.parsed) as T;

    const usage = result.raw?.usage_metadata;
    const inputUsed = usage?.input_tokens ?? inputTokens;
    const outputUsed =
      usage?.output_tokens ?? tokenCounter.countTokens(JSON.stringify(parsed));
    // `usage_metadata.input_token_details.cache_read` is the only field this
    // value appears on for structured invocations; `response_metadata.
    // tokenUsage.prompt_tokens_details` is undefined on this path.
    const cachedInput = usage?.input_token_details?.cache_read;

    logger.info("openai.invokeStructured.complete", {
      model_name: modelName,
      input_tokens: inputUsed,
      output_tokens: outputUsed,
      cached_input_tokens: cachedInput,
      duration_ms: Date.now() - start,
    });

    return {
      parsed,
      tokenUsage: { input: inputUsed, output: outputUsed, cachedInput },
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
