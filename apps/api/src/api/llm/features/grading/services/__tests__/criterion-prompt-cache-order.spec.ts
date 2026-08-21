import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StructuredOutputParser } from "@langchain/classic/output_parsers";
import { getEncoding } from "js-tiktoken";
import {
  CriterionGradeSchema,
  EvidenceValidationSchema,
  JudgeCritiqueSchema,
} from "../../types/criterion-evidence.types";
import {
  MIN_CACHEABLE_PREFIX_TOKENS,
  renderCachePrefix,
} from "../../../../core/utils/prompt-cache.util";

/**
 * The evidence pipeline grades one submission criterion by criterion, so the
 * rules and format instructions are byte-identical across calls while the
 * criterion, evidence and grader outputs change. Each prompt therefore leads
 * with an invariant head that is marked as the cache breakpoint.
 *
 * Two ways that breaks, both silent at runtime — the request succeeds either
 * way and only the bill moves:
 *
 * - the head drops below the provider's minimum and nothing is stored;
 * - a varying block drifts above the breakpoint, so the "shared" prefix
 *   differs on every call.
 *
 * These assert on the source text because neither failure is observable from
 * the response.
 */

const SERVICES = join(__dirname, "..");
const encoding = getEncoding("o200k_base");

interface PromptUnderTest {
  file: string;
  headConstant: string;
  formatInstructions: string;
  /** Blocks that must never appear above the breakpoint. */
  varying: string[];
  placeholders: string[];
}

const PROMPTS: PromptUnderTest[] = [
  {
    file: "criterion-grading.service.ts",
    headConstant: "CRITERION_GRADING_HEAD",
    formatInstructions:
      StructuredOutputParser.fromZodSchema(
        CriterionGradeSchema,
      ).getFormatInstructions(),
    varying: [
      "QUESTION:",
      "CRITERION:",
      "ALLOWED POINTS:",
      "EVIDENCE CHUNKS:",
      "{question}",
      "{criterion}",
      "{evidence}",
    ],
    placeholders: [
      "{question}",
      "{criterion}",
      "{allowed_points}",
      "{evidence}",
      "{judge_feedback}",
      "{format_instructions}",
    ],
  },
  {
    file: "criterion-evidence-retrieval.service.ts",
    headConstant: "EVIDENCE_VALIDATION_HEAD",
    formatInstructions: StructuredOutputParser.fromZodSchema(
      EvidenceValidationSchema,
    ).getFormatInstructions(),
    varying: [
      "QUESTION CONTEXT:",
      "CRITERION:",
      "CANDIDATE CHUNKS",
      "{question}",
      "{criterion}",
      "{chunks}",
    ],
    placeholders: [
      "{criterion}",
      "{question}",
      "{chunks}",
      "{format_instructions}",
    ],
  },
  {
    file: "criterion-judge.service.ts",
    headConstant: "JUDGE_HEAD",
    formatInstructions:
      StructuredOutputParser.fromZodSchema(
        JudgeCritiqueSchema,
      ).getFormatInstructions(),
    varying: [
      "QUESTION:",
      "RUBRIC:",
      "CRITERION OUTPUTS:",
      "EVIDENCE SUMMARY:",
      "{question}",
      "{rubric}",
      "{outputs}",
    ],
    placeholders: [
      "{question}",
      "{rubric}",
      "{outputs}",
      "{evidence}",
      "{format_instructions}",
    ],
  },
];

function sourceOf(file: string): string {
  return readFileSync(join(SERVICES, file), "utf8");
}

function headOf(source: string, constant: string): string {
  const match = new RegExp(`const ${constant} = \`([\\s\\S]*?)\`;`).exec(
    source,
  );
  expect(match).not.toBeNull();
  return (match as RegExpExecArray)[1];
}

function templateOf(source: string): string {
  const start = source.indexOf("template: `");
  expect(start).toBeGreaterThan(-1);
  const from = start + "template: `".length;
  const end = source.indexOf("`,", from);
  expect(end).toBeGreaterThan(from);
  return source.slice(from, end);
}

describe("evidence-pipeline prompt cache prefixes", () => {
  it.each(PROMPTS.map((p) => [p.headConstant, p] as const))(
    "%s is long enough for the provider to cache it",
    (_name, prompt) => {
      const head = headOf(sourceOf(prompt.file), prompt.headConstant);
      const rendered = renderCachePrefix(head, prompt.formatInstructions);
      const tokens = encoding.encode(rendered).length;

      // Below the minimum the call still succeeds and caches nothing, so this
      // is the only place the regression can be caught.
      expect(tokens).toBeGreaterThanOrEqual(MIN_CACHEABLE_PREFIX_TOKENS);
    },
  );

  it.each(PROMPTS.map((p) => [p.headConstant, p] as const))(
    "%s contains no varying block",
    (_name, prompt) => {
      const head = headOf(sourceOf(prompt.file), prompt.headConstant);

      for (const marker of prompt.varying) {
        expect(head).not.toContain(marker);
      }

      // format_instructions is the only substitution allowed above the
      // breakpoint: it is fixed by the schema, not by the submission.
      const placeholders = [...head.matchAll(/\{([a-zA-Z_]+)\}/g)].map(
        (match) => match[1],
      );
      expect(placeholders).toEqual(
        placeholders.map(() => "format_instructions"),
      );
    },
  );

  it.each(PROMPTS.map((p) => [p.headConstant, p] as const))(
    "%s leads its template",
    (_name, prompt) => {
      const template = templateOf(sourceOf(prompt.file));
      expect(template.startsWith(`\${${prompt.headConstant}}`)).toBe(true);
    },
  );

  it("keeps every placeholder the prompt depends on", () => {
    for (const prompt of PROMPTS) {
      const source = sourceOf(prompt.file);
      const full = headOf(source, prompt.headConstant) + templateOf(source);
      for (const placeholder of prompt.placeholders) {
        expect(full).toContain(placeholder);
      }
    }
  });
});
