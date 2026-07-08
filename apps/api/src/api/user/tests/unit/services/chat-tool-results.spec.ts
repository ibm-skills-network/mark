import {
  collectToolResultsAcrossSteps,
  partitionClientExecutions,
} from "../../../services/chat-tool-results";

describe("collectToolResultsAcrossSteps", () => {
  it("returns tool results from every step, not just the last one", () => {
    const reportToolResult = {
      toolCallId: "call-1",
      toolName: "reportIssue",
      output: JSON.stringify({
        clientExecution: true,
        function: "showReportPreview",
        params: { issueType: "technical" },
      }),
    };

    // Multi-step generation: the model calls a tool in step 1, then produces
    // a text-only step 2. The final step has no tool results.
    const steps = [{ toolResults: [reportToolResult] }, { toolResults: [] }];

    expect(collectToolResultsAcrossSteps(steps)).toEqual([reportToolResult]);
  });

  it("concatenates tool results from multiple steps in order", () => {
    const first = {
      toolCallId: "a",
      toolName: "searchKnowledgeBase",
      output: "docs",
    };
    const second = { toolCallId: "b", toolName: "reportIssue", output: "{}" };

    const steps = [{ toolResults: [first] }, { toolResults: [second] }];

    expect(collectToolResultsAcrossSteps(steps)).toEqual([first, second]);
  });

  it("tolerates missing steps and missing toolResults arrays", () => {
    expect(collectToolResultsAcrossSteps(undefined)).toEqual([]);
    expect(collectToolResultsAcrossSteps([])).toEqual([]);
    expect(
      collectToolResultsAcrossSteps([
        undefined,
        {},
        { toolResults: undefined },
      ]),
    ).toEqual([]);
  });
});

describe("partitionClientExecutions", () => {
  it("routes clientExecution outputs to trackedClientExecutions", () => {
    const { trackedClientExecutions, nonClientToolOutputs } =
      partitionClientExecutions([
        {
          toolCallId: "call-1",
          toolName: "reportIssue",
          output: JSON.stringify({
            clientExecution: true,
            function: "showReportPreview",
            params: { issueType: "technical", severity: "error" },
          }),
        },
      ]);

    expect(trackedClientExecutions).toEqual([
      {
        function: "showReportPreview",
        params: { issueType: "technical", severity: "error" },
      },
    ]);
    expect(nonClientToolOutputs).toEqual([]);
  });

  it("routes plain tool outputs to nonClientToolOutputs", () => {
    const { trackedClientExecutions, nonClientToolOutputs } =
      partitionClientExecutions([
        {
          toolCallId: "call-2",
          toolName: "searchKnowledgeBase",
          output: "Some knowledge base answer",
        },
      ]);

    expect(trackedClientExecutions).toEqual([]);
    expect(nonClientToolOutputs).toEqual([
      {
        toolName: "searchKnowledgeBase",
        rawResult: "Some knowledge base answer",
      },
    ]);
  });

  it("stringifies non-string outputs and skips undefined ones", () => {
    const { trackedClientExecutions, nonClientToolOutputs } =
      partitionClientExecutions([
        { toolName: "someTool", output: { answer: 42 } },
        { toolName: "emptyTool", output: undefined },
        undefined,
      ]);

    expect(trackedClientExecutions).toEqual([]);
    expect(nonClientToolOutputs).toEqual([
      { toolName: "someTool", rawResult: JSON.stringify({ answer: 42 }) },
    ]);
  });
});
