/**
 * Gen AI observability helpers (Instana / OpenLLMetry).
 *
 * Two concerns:
 *  - withGenAILabels: tag an auto-instrumented LLM call with a named workflow
 *    and association properties so cost can be broken down per feature.
 *  - startChatLlmSpan / traceChatLlmCall: emit a manual gen_ai.* span for the
 *    chat path, which uses an SDK that OpenLLMetry does not auto-instrument.
 *
 * Everything is a no-op unless GEN_AI_ENABLED. A telemetry error must never
 * break a grading, chat, or boot path.
 */
import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";

export const GEN_AI_ENABLED = process.env.INSTANA_GENAI_ENABLED === "true";

const TRACER_NAME = "mark-genai";

export interface GenAILabels {
  usageType?: string;
  featureKey?: string;
  assignmentId?: number;
  modelKey?: string;
}

/**
 * Wraps an auto-instrumented LLM call so its span is named and tagged for
 * per-feature cost attribution. When disabled, runs the call unchanged.
 */
export async function withGenAILabels<T>(
  labels: GenAILabels,
  function_: () => Promise<T>,
): Promise<T> {
  if (!GEN_AI_ENABLED) {
    return function_();
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires, unicorn/prefer-module
  const traceloop =
    require("@traceloop/node-server-sdk") as typeof import("@traceloop/node-server-sdk");

  const properties: Record<string, string> = {};
  if (labels.usageType !== undefined) {
    properties.usage_type = labels.usageType;
  }
  if (labels.featureKey !== undefined) {
    properties.feature_key = labels.featureKey;
  }
  if (labels.assignmentId !== undefined) {
    properties.assignment_id = String(labels.assignmentId);
  }
  if (labels.modelKey !== undefined) {
    properties.model_key = labels.modelKey;
  }

  return traceloop.withWorkflow({ name: labels.usageType ?? "llm_call" }, () =>
    traceloop.withAssociationProperties(properties, function_),
  ) as Promise<T>;
}

/** Manual span handle for the chat path (not auto-instrumented). */
export interface ChatLlmSpan {
  setUsage(inputTokens?: number, outputTokens?: number): void;
  setResponseModel(model: string): void;
  recordError(error: unknown): void;
  end(): void;
}

const NO_OP_SPAN: ChatLlmSpan = {
  setUsage() {
    /* no-op when disabled */
  },
  setResponseModel() {
    /* no-op when disabled */
  },
  recordError() {
    /* no-op when disabled */
  },
  end() {
    /* no-op when disabled */
  },
};

function toException(error: unknown): { exception: Error; message: string } {
  const exception = error instanceof Error ? error : new Error(String(error));
  return { exception, message: exception.message };
}

function makeChatLlmSpan(span: Span, usageType?: string): ChatLlmSpan {
  if (usageType !== undefined) {
    span.setAttribute("usage_type", usageType);
  }
  return {
    setUsage(inputTokens?: number, outputTokens?: number) {
      if (inputTokens !== undefined) {
        span.setAttribute("gen_ai.usage.input_tokens", inputTokens);
      }
      if (outputTokens !== undefined) {
        span.setAttribute("gen_ai.usage.output_tokens", outputTokens);
      }
    },
    setResponseModel(model: string) {
      span.setAttribute("gen_ai.response.model", model);
    },
    recordError(error: unknown) {
      const { exception, message } = toException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.recordException(exception);
    },
    end() {
      span.end();
    },
  };
}

/**
 * Starts a gen_ai.* span for a chat completion. Returns a no-op handle when
 * disabled. The caller is responsible for calling end().
 */
export function startChatLlmSpan(parameters: {
  model: string;
  operationName?: string;
  labels?: GenAILabels;
}): ChatLlmSpan {
  if (!GEN_AI_ENABLED) {
    return NO_OP_SPAN;
  }

  const operationName = parameters.operationName ?? "chat";
  const span = trace
    .getTracer(TRACER_NAME)
    .startSpan(`${operationName} ${parameters.model}`);
  span.setAttribute("gen_ai.operation.name", operationName);
  span.setAttribute("gen_ai.system", "openai");
  span.setAttribute("gen_ai.request.model", parameters.model);

  return makeChatLlmSpan(span, parameters.labels?.usageType);
}

/**
 * Runs the call with a gen_ai.* span, recording errors and always ending the
 * span. When disabled, runs the call with a no-op handle.
 */
export async function traceChatLlmCall<T>(
  parameters: { model: string; operationName?: string; labels?: GenAILabels },
  function_: (span: ChatLlmSpan) => Promise<T>,
): Promise<T> {
  const span = startChatLlmSpan(parameters);
  try {
    return await function_(span);
  } catch (error) {
    span.recordError(error);
    throw error;
  } finally {
    span.end();
  }
}
