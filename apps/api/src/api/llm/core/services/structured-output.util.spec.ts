import { HumanMessage } from "@langchain/core/messages";
import { createRequire } from "node:module";
import { z } from "zod";
import {
  CriterionGradeSchema,
  EvidenceValidationSchema,
  GradeSummarySchema,
  JudgeCritiqueSchema,
} from "../../features/grading/types/criterion-evidence.types";
import {
  invokeStructuredChatModel,
  normalizeWidenedOutput,
  widenOptionalsForStrictOutput,
} from "./structured-output.util";

// LangChain serializes schemas with its own nested copy of the openai SDK,
// whose strict-mode serializer is the one that rejects bare `.optional()` in
// production — the workspace-root openai is older and silently permissive, so
// resolve the copy LangChain actually uses.
const langchainRequire = createRequire(require.resolve("@langchain/openai"));
const { zodResponseFormat } = langchainRequire("openai/helpers/zod") as {
  zodResponseFormat: (schema: z.ZodTypeAny, name: string) => unknown;
};

describe("invokeStructuredChatModel", () => {
  const schema = z.object({ grade: z.number() });
  const makeLogger = () => ({ info: jest.fn(), error: jest.fn() });

  it("binds the schema and returns parsed + usage from raw.usage_metadata", async () => {
    const structuredInvoke = jest.fn().mockResolvedValue({
      raw: { usage_metadata: { input_tokens: 11, output_tokens: 6 } },
      parsed: { grade: 7 },
    });
    const withStructuredOutput = jest
      .fn()
      .mockReturnValue({ invoke: structuredInvoke });
    const model = { withStructuredOutput } as never;
    const tokenCounter = { countTokens: jest.fn().mockReturnValue(3) };
    const logger = makeLogger();

    const result = await invokeStructuredChatModel(
      model,
      [new HumanMessage("grade this")],
      schema,
      tokenCounter as never,
      logger as never,
      "gpt-5-mini",
    );

    expect(withStructuredOutput).toHaveBeenCalledWith(
      schema,
      expect.objectContaining({ includeRaw: true }),
    );
    expect(result).toEqual({
      parsed: { grade: 7 },
      tokenUsage: { input: 11, output: 6 },
    });
  });

  it("surfaces the provider's cache_read count as cachedInput", async () => {
    const structuredInvoke = jest.fn().mockResolvedValue({
      raw: {
        usage_metadata: {
          input_tokens: 1083,
          output_tokens: 40,
          input_token_details: { cache_read: 1063 },
        },
      },
      parsed: { grade: 7 },
    });
    const model = {
      withStructuredOutput: jest
        .fn()
        .mockReturnValue({ invoke: structuredInvoke }),
    } as never;
    const logger = makeLogger();

    const result = await invokeStructuredChatModel(
      model,
      [new HumanMessage("grade this")],
      schema,
      { countTokens: jest.fn().mockReturnValue(3) } as never,
      logger as never,
      "gpt-5.6-luna",
    );

    // A silently-dead cache is indistinguishable from a working one at the
    // API level; this number reaching the logs is the only way a deploy can
    // verify caching actually engaged.
    expect(result.tokenUsage).toEqual({
      input: 1083,
      output: 40,
      cachedInput: 1063,
    });
    expect(logger.info).toHaveBeenCalledWith(
      "openai.invokeStructured.complete",
      expect.objectContaining({ cached_input_tokens: 1063 }),
    );
  });

  it("falls back to counting tokens when usage metadata is absent", async () => {
    const structuredInvoke = jest
      .fn()
      .mockResolvedValue({ raw: {}, parsed: { grade: 1 } });
    const model = {
      withStructuredOutput: jest
        .fn()
        .mockReturnValue({ invoke: structuredInvoke }),
    } as never;
    const tokenCounter = { countTokens: jest.fn().mockReturnValue(5) };

    const result = await invokeStructuredChatModel(
      model,
      [new HumanMessage("x")],
      schema,
      tokenCounter as never,
      makeLogger() as never,
      "gpt-5-mini",
    );

    expect(result.tokenUsage).toEqual({ input: 5, output: 5 });
  });

  it("logs and rethrows provider errors", async () => {
    const model = {
      withStructuredOutput: jest.fn().mockReturnValue({
        invoke: jest.fn().mockRejectedValue(new Error("boom")),
      }),
    } as never;
    const logger = makeLogger();

    await expect(
      invokeStructuredChatModel(
        model,
        [new HumanMessage("x")],
        schema,
        { countTokens: () => 1 } as never,
        logger as never,
        "gpt-5-mini",
      ),
    ).rejects.toThrow("boom");
    expect(logger.error).toHaveBeenCalled();
  });

  it("throws instead of returning null when the model output fails schema parsing", async () => {
    const model = {
      withStructuredOutput: jest.fn().mockReturnValue({
        invoke: jest.fn().mockResolvedValue({ raw: {}, parsed: null }),
      }),
    } as never;
    const logger = makeLogger();

    await expect(
      invokeStructuredChatModel(
        model,
        [new HumanMessage("x")],
        schema,
        { countTokens: () => 1 } as never,
        logger as never,
        "gpt-5-mini",
      ),
    ).rejects.toThrow("produced no result");
    expect(logger.error).toHaveBeenCalled();
  });

  it("widens bare-optional fields before binding and maps model nulls back to undefined", async () => {
    const optionalSchema = z.object({
      rationale: z.string(),
      nextStep: z.string().optional(),
      evidence: z.string().nullable(),
      criteria: z.array(z.object({ note: z.string().optional() })),
    });
    const structuredInvoke = jest.fn().mockResolvedValue({
      raw: { usage_metadata: { input_tokens: 2, output_tokens: 2 } },
      parsed: {
        rationale: "ok",
        nextStep: null,
        evidence: null,
        criteria: [{ note: null }, { note: "kept" }],
      },
    });
    const withStructuredOutput = jest
      .fn()
      .mockReturnValue({ invoke: structuredInvoke });
    const model = { withStructuredOutput } as never;

    const result = await invokeStructuredChatModel(
      model,
      [new HumanMessage("grade this")],
      optionalSchema,
      { countTokens: jest.fn().mockReturnValue(3) } as never,
      makeLogger() as never,
      "gpt-5.4-mini-2026-03-17",
    );

    const boundSchema = withStructuredOutput.mock.calls[0][0] as z.ZodTypeAny;
    expect(() =>
      zodResponseFormat(boundSchema, "structured_response"),
    ).not.toThrow();

    expect(result.parsed).toEqual({
      rationale: "ok",
      // Widened optional: model null becomes undefined (key dropped).
      evidence: null,
      criteria: [{}, { note: "kept" }],
    });
    expect("nextStep" in (result.parsed as Record<string, unknown>)).toBe(
      false,
    );
  });
});

describe("widenOptionalsForStrictOutput", () => {
  it("returns the same schema instance when nothing needs widening", () => {
    const clean = z.object({
      grade: z.number(),
      evidence: z.string().nullable(),
      items: z.array(z.object({ label: z.string() })),
    });
    expect(widenOptionalsForStrictOutput(clean)).toBe(clean);
  });

  it("is rejected by the OpenAI strict serializer before widening and accepted after", () => {
    const bare = z.object({ nextStep: z.string().min(10).optional() });
    expect(() => zodResponseFormat(bare, "structured_response")).toThrow(
      /optional\(\)/,
    );
    expect(() =>
      zodResponseFormat(
        widenOptionalsForStrictOutput(bare),
        "structured_response",
      ),
    ).not.toThrow();
  });

  it.each([
    ["CriterionGradeSchema", CriterionGradeSchema],
    ["EvidenceValidationSchema", EvidenceValidationSchema],
    ["JudgeCritiqueSchema", JudgeCritiqueSchema],
    ["GradeSummarySchema", GradeSummarySchema],
  ])(
    "makes the production grading schema %s strict-serializable",
    (_name, gradingSchema) => {
      expect(() =>
        zodResponseFormat(
          widenOptionalsForStrictOutput(gradingSchema),
          "structured_response",
        ),
      ).not.toThrow();
    },
  );

  it("round-trips widened output back to the original schema's types", () => {
    const widened = widenOptionalsForStrictOutput(CriterionGradeSchema);
    const modelOutput = widened.parse({
      score: 2,
      rationale: "Meets the criterion with clear supporting evidence shown.",
      citations: ["chunk-1"],
      confidence: "high",
      nextStep: null,
    });
    const normalized = normalizeWidenedOutput(
      CriterionGradeSchema,
      modelOutput,
    );
    expect(CriterionGradeSchema.parse(normalized)).toEqual({
      score: 2,
      rationale: "Meets the criterion with clear supporting evidence shown.",
      citations: ["chunk-1"],
      confidence: "high",
    });
  });
});
