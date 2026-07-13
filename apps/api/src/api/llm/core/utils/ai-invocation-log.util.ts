import { Logger } from "winston";

/**
 * Cap on how much of the prompt/response lands in the headline message so a
 * single AI call cannot blow up a log line; full lengths are always reported
 * in the structured fields.
 */
const MAX_LOGGED_CHARS = 2000;

export interface AiInvocationLog {
  /** Provider/model key the call ran on, e.g. "gpt-5-nano". */
  modelKey: string;
  /** What the call was for, e.g. "criterion_judge" or an AIUsageType. */
  purpose: string;
  /** Final prompt text sent to the model. */
  prompt: string;
  /** Model output (or serialized structured output). */
  response: string;
  /** Extra structured fields (assignment id, chat id, token counts, ...). */
  context?: Record<string, unknown>;
}

function clip(text: string): string {
  if (text.length <= MAX_LOGGED_CHARS) return text;
  return `${text.slice(0, MAX_LOGGED_CHARS)}... [truncated, ${text.length} chars total]`;
}

/**
 * Single log format for every AI model invocation:
 *
 *   [<model>] <PURPOSE> - <prompt> ; <response>
 *
 * Every path that sends a prompt to a model (prompt processor, chat
 * assistant, moderation) funnels through this so AI traffic is greppable by
 * model or purpose from one line shape.
 */
export function logAiInvocation(
  logger: Logger,
  { modelKey, purpose, prompt, response, context }: AiInvocationLog,
): void {
  const purposeLabel = purpose.toUpperCase();
  logger.info(
    `[${modelKey}] ${purposeLabel} - ${clip(prompt)} ; ${clip(response)}`,
    {
      ai_invocation: true,
      model: modelKey,
      purpose: purposeLabel,
      prompt_length: prompt.length,
      response_length: response.length,
      ...context,
    },
  );
}
