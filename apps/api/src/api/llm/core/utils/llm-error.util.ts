/**
 * Detects the OpenAI "context_length_exceeded" class of failure. These are
 * deterministic for a given prompt: retrying the identical request can never
 * succeed, so retry ladders must stop immediately when this returns true.
 */
export function isContextLengthExceededError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Error & {
    code?: unknown;
    status?: unknown;
    error?: { code?: unknown };
  };

  const code =
    typeof candidate.code === "string"
      ? candidate.code
      : typeof candidate.error?.code === "string"
        ? candidate.error.code
        : undefined;

  if (code === "context_length_exceeded") {
    return true;
  }

  return /maximum context length|context_length_exceeded|resulted in \d+ tokens/i.test(
    candidate.message,
  );
}
