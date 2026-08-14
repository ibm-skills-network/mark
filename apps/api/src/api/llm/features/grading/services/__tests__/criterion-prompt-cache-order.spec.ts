import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The evidence pipeline grades one submission criterion by criterion, so the
 * question, rules and format instructions are byte-identical across calls
 * while the criterion, evidence and grader outputs change. Prefix caching only
 * reaches the first differing byte, so every invariant block has to be emitted
 * before the first varying one. When the varying blocks led, the shared prefix
 * measured ~450 tokens -- under the 1024-token minimum for automatic prompt
 * caching -- and roughly 2B input tokens per cycle were billed uncached.
 *
 * These assert on template order rather than behaviour because the cost only
 * shows up at the provider, where no unit test can observe it.
 */

const SERVICES = join(__dirname, "..");

function templateOf(file: string): string {
  const source = readFileSync(join(SERVICES, file), "utf8");
  const start = source.indexOf("template: `");
  expect(start).toBeGreaterThan(-1);
  const from = start + "template: `".length;
  const end = source.indexOf("`,", from);
  expect(end).toBeGreaterThan(from);
  return source.slice(from, end);
}

function orderOf(template: string, markers: string[]): number[] {
  return markers.map((marker) => {
    const at = template.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    return at;
  });
}

/** Every invariant marker must appear before every varying marker. */
function expectInvariantsFirst(
  template: string,
  invariant: string[],
  varying: string[],
) {
  const lastInvariant = Math.max(...orderOf(template, invariant));
  const firstVarying = Math.min(...orderOf(template, varying));
  expect(lastInvariant).toBeLessThan(firstVarying);
}

describe("evidence-pipeline prompt ordering (prompt-cache prefix)", () => {
  it("criterion grading emits rules and question before the criterion", () => {
    const template = templateOf("criterion-grading.service.ts");
    expectInvariantsFirst(
      template,
      ["OUTPUT RULES:", "{format_instructions}", "QUESTION:"],
      ["CRITERION:", "EVIDENCE CHUNKS:", "{criterion}", "{evidence}"],
    );
  });

  it("evidence validation emits rules and question before the criterion", () => {
    const template = templateOf("criterion-evidence-retrieval.service.ts");
    expectInvariantsFirst(
      template,
      ["{format_instructions}", "QUESTION CONTEXT:"],
      ["CRITERION:", "CANDIDATE CHUNKS", "{criterion}", "{chunks}"],
    );
  });

  it("judge emits checks, question and rubric before the grader outputs", () => {
    const template = templateOf("criterion-judge.service.ts");
    expectInvariantsFirst(
      template,
      ["CHECKS:", "{format_instructions}", "QUESTION:", "RUBRIC:"],
      ["CRITERION OUTPUTS:", "EVIDENCE SUMMARY:", "{outputs}"],
    );
  });

  it("keeps every placeholder the reorder moved", () => {
    const expected: Record<string, string[]> = {
      "criterion-grading.service.ts": [
        "{question}",
        "{criterion}",
        "{allowed_points}",
        "{evidence}",
        "{judge_feedback}",
        "{format_instructions}",
      ],
      "criterion-evidence-retrieval.service.ts": [
        "{criterion}",
        "{question}",
        "{chunks}",
        "{format_instructions}",
      ],
      "criterion-judge.service.ts": [
        "{question}",
        "{rubric}",
        "{outputs}",
        "{evidence}",
        "{format_instructions}",
      ],
    };

    for (const [file, placeholders] of Object.entries(expected)) {
      const template = templateOf(file);
      for (const placeholder of placeholders) {
        expect(template).toContain(placeholder);
      }
    }
  });
});
