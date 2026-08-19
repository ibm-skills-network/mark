/* eslint-disable */
import { Logger } from "@nestjs/common";

import { CODE_SEGMENT_MAX_CHARS } from "./source-code.utils";
import { FileGradingService } from "./file-grading.service";

/**
 * Notebook evidence segmentation.
 *
 * A rubric criterion's wording matches the markdown task cell ("Create a bar
 * chart to compare..."), but the work that satisfies it lives in the code
 * cells that follow. Evidence retrieval selects whole chunks, so a task's
 * description and its answer code must share a chunk — otherwise lexical
 * retrieval hands the grader the rubric-parroting template cell and the
 * learner's code never reaches the prompt (observed in production as
 * "submission shows only the solution template" false zeros).
 */

function makeService(): FileGradingService {
  const service = Object.create(FileGradingService.prototype);
  (service as any).logger = {
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  return service as FileGradingService;
}

function mdCell(n: number, text: string): string {
  return `=== CELL ${n} [MARKDOWN] ===\n${text}`;
}

function codeCell(n: number, text: string): string {
  return `=== CELL ${n} [CODE] [${n}] ===\n${text}`;
}

const HEADER = "=== JUPYTER NOTEBOOK: test.ipynb ===\nFormat: v4.5";

describe("FileGradingService notebook section segmentation", () => {
  let service: FileGradingService;

  beforeEach(() => {
    service = makeService();
  });

  function split(text: string): string[] {
    return (service as any).splitCodeIntoSegments(text);
  }

  it("attaches a task's code cells to the preceding markdown run", () => {
    const text = [
      HEADER,
      mdCell(
        1,
        "TASK 1.3: Create a bar chart to compare Vehicle-Wise Sales During Recession and Non-Recession Periods.\nHint: use the groupby method on the Vehicle_Type column and plot the result.\nTemplate: # df_grouped = df.groupby(...)... " +
          "x".repeat(120),
      ),
      codeCell(
        2,
        "df_grouped = df.groupby(['Recession', 'Vehicle_Type'])['Automobile_Sales'].mean().reset_index()\nsns.barplot(x='Recession', y='Automobile_Sales', hue='Vehicle_Type', data=df_grouped)\nplt.title('Vehicle-Wise Sales')\nplt.show()" +
          "\n# " +
          "y".repeat(120),
      ),
      mdCell(
        3,
        "TASK 1.4: Create a pie chart to display advertising expenditure during recession periods.\nHint: use plt.pie with the two expenditure totals. " +
          "z".repeat(120),
      ),
      codeCell(
        4,
        "totals = [rec_exp, non_rec_exp]\nplt.pie(totals, labels=['Recession', 'Non-Recession'])\nplt.show()" +
          "\n# " +
          "w".repeat(120),
      ),
    ].join("\n");

    const segments = split(text);

    const barChartSegment = segments.find((s) => s.includes("TASK 1.3"));
    expect(barChartSegment).toBeDefined();
    expect(barChartSegment).toContain("sns.barplot");

    const pieSegment = segments.find((s) => s.includes("TASK 1.4"));
    expect(pieSegment).toBeDefined();
    expect(pieSegment).toContain("plt.pie");
  });

  it("starts a new section at each markdown run so tasks stay separate", () => {
    const text = [
      HEADER,
      mdCell(1, "TASK A: first task description " + "a".repeat(200)),
      codeCell(2, "first_task_code()\n# " + "b".repeat(200)),
      mdCell(3, "TASK B: second task description " + "c".repeat(200)),
      codeCell(4, "second_task_code()\n# " + "d".repeat(200)),
    ].join("\n");

    const segments = split(text);

    const first = segments.find((s) => s.includes("TASK A"));
    expect(first).toBeDefined();
    expect(first).not.toContain("second_task_code");

    const second = segments.find((s) => s.includes("TASK B"));
    expect(second).toBeDefined();
    expect(second).not.toContain("first_task_code");
  });

  it("groups consecutive markdown cells (heading + hint) with the answer code", () => {
    const text = [
      HEADER,
      mdCell(
        1,
        "TASK 2.1: Compare GDP variations during recession periods. " +
          "e".repeat(160),
      ),
      mdCell(
        2,
        "Hint: use pandas groupby on the GDP column and add_subplot. " +
          "f".repeat(160),
      ),
      codeCell(
        3,
        "gdp = df.groupby('Year')['GDP'].mean()\nfig.add_subplot(1, 2, 1)\n# " +
          "g".repeat(160),
      ),
    ].join("\n");

    const segments = split(text);

    const section = segments.find((s) => s.includes("TASK 2.1"));
    expect(section).toBeDefined();
    expect(section).toContain("Hint: use pandas groupby");
    expect(section).toContain("fig.add_subplot");
  });

  it("keeps every segment within CODE_SEGMENT_MAX_CHARS and loses no content", () => {
    const bigCode = "data_row = [1, 2, 3]\n".repeat(400); // ~8.4K chars
    const text = [
      HEADER,
      mdCell(1, "TASK 3: Load and describe the dataset. " + "h".repeat(200)),
      codeCell(2, bigCode + "unique_final_marker = True"),
    ].join("\n");

    const segments = split(text);

    for (const segment of segments) {
      expect(segment.length).toBeLessThanOrEqual(CODE_SEGMENT_MAX_CHARS);
    }
    const joined = segments.join("\n");
    expect(joined).toContain("TASK 3");
    expect(joined).toContain("unique_final_marker = True");
  });

  it("leaves non-notebook source code on the definition-split path", () => {
    const text =
      "def first_function():\n    return 1\n\n\ndef second_function():\n    return 2\n";

    const segments = split(text);

    expect(segments.join("\n")).toContain("first_function");
    expect(segments.join("\n")).toContain("second_function");
  });
});
