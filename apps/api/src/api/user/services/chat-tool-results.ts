export interface ChatToolResult {
  toolCallId?: string;
  toolName?: string;
  output?: unknown;
}

interface ChatStepLike {
  toolResults?: ReadonlyArray<ChatToolResult | undefined>;
}

export interface TrackedClientExecution {
  function: string;
  params: unknown;
}

export interface NonClientToolOutput {
  toolName?: string;
  rawResult: string;
}

/**
 * AI SDK v5 exposes `result.toolResults` for the final step only. With
 * multi-step tool loops (`stopWhen: stepCountIs(n)`) the model typically
 * follows a tool call with a text-only step, so reading `result.toolResults`
 * drops every tool result. Always flatten across steps instead.
 */
export function collectToolResultsAcrossSteps(
  steps: ReadonlyArray<ChatStepLike | undefined> | undefined,
): ChatToolResult[] {
  if (!steps) return [];

  const collected: ChatToolResult[] = [];
  for (const step of steps) {
    const stepToolResults = step?.toolResults;
    if (!stepToolResults) continue;
    for (const toolResult of stepToolResults) {
      if (toolResult) collected.push(toolResult);
    }
  }
  return collected;
}

/**
 * Splits tool results into client-execution signals (dialogs the frontend
 * must open, e.g. showReportPreview) and plain tool outputs the model is
 * expected to narrate itself.
 */
export function partitionClientExecutions(
  toolResults: ReadonlyArray<ChatToolResult | undefined>,
): {
  trackedClientExecutions: TrackedClientExecution[];
  nonClientToolOutputs: NonClientToolOutput[];
} {
  const trackedClientExecutions: TrackedClientExecution[] = [];
  const nonClientToolOutputs: NonClientToolOutput[] = [];

  for (const toolResult of toolResults) {
    if (!toolResult || toolResult.output === undefined) continue;

    const rawResult =
      typeof toolResult.output === "string"
        ? toolResult.output
        : JSON.stringify(toolResult.output);

    if (typeof rawResult !== "string" || rawResult.length === 0) continue;

    try {
      const parsedResult = JSON.parse(rawResult) as {
        clientExecution?: boolean;
        function?: string;
        params?: unknown;
      };
      if (parsedResult?.clientExecution && parsedResult.function) {
        trackedClientExecutions.push({
          function: parsedResult.function,
          params: parsedResult.params,
        });
        continue;
      }
    } catch {
      // Non-JSON tool output is expected for content tools.
    }

    nonClientToolOutputs.push({
      toolName: toolResult.toolName,
      rawResult,
    });
  }

  return { trackedClientExecutions, nonClientToolOutputs };
}
