import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import * as traceloop from "@traceloop/node-server-sdk";

/**
 * Verifies that the Gen AI observability helpers emit correctly-shaped
 * OpenTelemetry gen_ai.* spans. Runs fully in-process with an in-memory
 * exporter — no Instana agent, backend, database, or live LLM call required.
 *
 * The manual chat spans are routed through our own SimpleSpanProcessor (the
 * registered global provider) so exports are synchronous and deterministic.
 * Traceloop is initialized so withGenAILabels has a workflow context; its own
 * export path is async/batched, so we assert that helper behaviorally rather
 * than scraping its spans (that path is validated end-to-end via a real OTLP
 * collector, not this unit test).
 */

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => {
  traceloop.initialize({
    appName: "mark-api-test",
    disableBatch: true,
    traceContent: false,
    exporter,
    instrumentModules: {},
  });
  // Make our synchronous provider the global one for the manual gen_ai spans.
  trace.disable();
  provider.register();
});

afterEach(() => {
  exporter.reset();
});

type GenAiModule = typeof import("./gen-ai-observability");

function loadModule(enabled: boolean): GenAiModule {
  let loaded: GenAiModule | undefined;
  jest.isolateModules(() => {
    process.env.INSTANA_GENAI_ENABLED = enabled ? "true" : "false";
    loaded = require("./gen-ai-observability") as GenAiModule;
  });
  if (!loaded) {
    throw new Error("failed to load gen-ai-observability module");
  }
  return loaded;
}

function chatSpans() {
  return exporter
    .getFinishedSpans()
    .filter((span) => span.name.startsWith("chat "));
}

function requireChatSpan(name: string) {
  const span = chatSpans().find((candidate) => candidate.name === name);
  if (!span) {
    throw new Error(
      `span "${name}" not found; got: ${chatSpans()
        .map((s) => s.name)
        .join(", ")}`,
    );
  }
  return span;
}

describe("gen-ai-observability (enabled)", () => {
  const { traceChatLlmCall, startChatLlmSpan, withGenAILabels } =
    loadModule(true);

  it("traceChatLlmCall emits a gen_ai span with model + usage attributes", async () => {
    const returned = await traceChatLlmCall(
      { model: "gpt-4o-mini", labels: { usageType: "CHAT_ASSISTANT" } },
      async (span) => {
        span.setUsage(10, 20);
        return "reply";
      },
    );

    expect(returned).toBe("reply");
    const a = requireChatSpan("chat gpt-4o-mini").attributes;
    expect(a["gen_ai.operation.name"]).toBe("chat");
    expect(a["gen_ai.system"]).toBe("openai");
    expect(a["gen_ai.request.model"]).toBe("gpt-4o-mini");
    expect(a.usage_type).toBe("CHAT_ASSISTANT");
    expect(a["gen_ai.usage.input_tokens"]).toBe(10);
    expect(a["gen_ai.usage.output_tokens"]).toBe(20);
  });

  it("traceChatLlmCall records an error status and rethrows", async () => {
    const boom = new Error("provider exploded");
    await expect(
      traceChatLlmCall({ model: "gpt-4o-mini" }, async () => {
        throw boom;
      }),
    ).rejects.toThrow("provider exploded");

    const span = requireChatSpan("chat gpt-4o-mini");
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.some((event) => event.name === "exception")).toBe(true);
  });

  it("startChatLlmSpan lets a caller set usage + response model and end it", () => {
    const span = startChatLlmSpan({
      model: "gpt-4o",
      labels: { usageType: "CHAT_ASSISTANT" },
    });
    span.setResponseModel("gpt-4o-2024-08-06");
    span.setUsage(5, 7);
    span.end();

    const a = requireChatSpan("chat gpt-4o").attributes;
    expect(a["gen_ai.request.model"]).toBe("gpt-4o");
    expect(a["gen_ai.response.model"]).toBe("gpt-4o-2024-08-06");
    expect(a["gen_ai.usage.input_tokens"]).toBe(5);
    expect(a["gen_ai.usage.output_tokens"]).toBe(7);
  });

  it("withGenAILabels runs the call and returns its value", async () => {
    const calls: string[] = [];
    const value = await withGenAILabels(
      { usageType: "ASSIGNMENT_GRADING", assignmentId: 42, modelKey: "gpt-4o" },
      async () => {
        calls.push("invoked");
        return { ok: true };
      },
    );

    expect(value).toEqual({ ok: true });
    expect(calls).toEqual(["invoked"]);
  });
});

describe("gen-ai-observability (disabled)", () => {
  const { traceChatLlmCall, startChatLlmSpan, withGenAILabels } =
    loadModule(false);

  it("traceChatLlmCall runs the call but emits no gen_ai span", async () => {
    exporter.reset();
    const returned = await traceChatLlmCall(
      { model: "gpt-4o-mini", labels: { usageType: "CHAT_ASSISTANT" } },
      async (span) => {
        // no-op handle: these must not throw
        span.setUsage(1, 2);
        span.setResponseModel("x");
        return "reply";
      },
    );

    expect(returned).toBe("reply");
    expect(chatSpans()).toHaveLength(0);
  });

  it("startChatLlmSpan returns a safe no-op handle", () => {
    exporter.reset();
    const span = startChatLlmSpan({ model: "gpt-4o-mini" });
    expect(() => {
      span.setUsage(1, 2);
      span.recordError(new Error("ignored"));
      span.end();
    }).not.toThrow();
    expect(chatSpans()).toHaveLength(0);
  });

  it("withGenAILabels returns the call's value unchanged", async () => {
    const value = await withGenAILabels(
      { usageType: "TRANSLATION" },
      async () => Promise.resolve("done"),
    );
    expect(value).toBe("done");
  });
});
