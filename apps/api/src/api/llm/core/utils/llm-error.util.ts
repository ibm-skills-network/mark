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

/**
 * Classification of an error thrown by an LLM provider invocation, used by the
 * prompt processor to decide whether to retry, to open the quota
 * circuit-breaker, or to surface a "service unavailable" signal to callers.
 *
 *  - "quota"      : the account/project is out of credit or hit a hard billing
 *                   / usage cap (OpenAI `insufficient_quota`, HTTP 429). This
 *                   does NOT recover by retrying — every call fails the same
 *                   way until billing is topped up or the cap resets. Retrying
 *                   it just hammers a dead key, which is exactly what turned a
 *                   billing blip into an hour of failing grading + translation.
 *  - "rate_limit" : RPM/TPM throttling (HTTP 429, `rate_limit_exceeded`).
 *                   Transient — backing off and retrying is the correct
 *                   response.
 *  - "transient"  : network / timeout / 5xx. Retryable.
 *  - "terminal"   : anything else (bad request, context-length, auth). Not
 *                   retryable — the same input will fail again.
 */
export type LlmErrorKind = "quota" | "rate_limit" | "transient" | "terminal";

export interface ClassifiedLlmError {
  kind: LlmErrorKind;
  retryable: boolean;
  status?: number;
  code?: string;
}

/**
 * Thrown by the prompt processor when the LLM is unavailable because the
 * account is out of quota (or the per-pod quota circuit-breaker is open).
 * Carries a `retryAfterSeconds` hint so HTTP callers can emit a `Retry-After`
 * header and the UI can pause instead of re-spamming a dead provider.
 */
export class LlmQuotaExceededError extends Error {
  readonly retryAfterSeconds: number;

  constructor(
    message: string,
    options: { retryAfterSeconds: number; cause?: unknown },
  ) {
    super(message);
    this.name = "LlmQuotaExceededError";
    this.retryAfterSeconds = options.retryAfterSeconds;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

interface ErrorLike {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  type?: unknown;
  name?: unknown;
  message?: unknown;
  response?: { status?: unknown; data?: { error?: ErrorLike } };
  error?: ErrorLike;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Pull an HTTP status out of the various shapes OpenAI/LangChain throw. */
function extractStatus(error: ErrorLike): number | undefined {
  return (
    readNumber(error.status) ??
    readNumber(error.statusCode) ??
    readNumber(error.response?.status) ??
    readNumber(error.error?.status)
  );
}

/** Pull the provider error code/type (e.g. "insufficient_quota"). */
function extractCode(error: ErrorLike): string | undefined {
  return (
    readString(error.code) ??
    readString(error.type) ??
    readString(error.error?.code) ??
    readString(error.error?.type) ??
    readString(error.response?.data?.error?.code) ??
    readString(error.response?.data?.error?.type)
  );
}

const QUOTA_PATTERN =
  /insufficient_quota|exceeded your current quota|check your plan and billing/i;
const RATE_LIMIT_PATTERN = /rate.?limit|too many requests|try again in/i;
const TRANSIENT_PATTERN =
  /timeout|timed out|econnreset|etimedout|epipe|econnrefused|eai_again|socket hang up|premature close|network|fetch failed|connection error/i;

/**
 * Classify an LLM provider error. Order matters: quota is also surfaced as
 * HTTP 429, so it must be detected BEFORE the generic rate-limit check or a
 * billing-exhaustion error would be (wrongly) treated as retryable.
 */
export function classifyLlmError(error: unknown): ClassifiedLlmError {
  const error_ = (
    typeof error === "object" && error !== null ? error : {}
  ) as ErrorLike;

  const status = extractStatus(error_);
  const code = extractCode(error_);
  const name = readString(error_.name) ?? "";
  const message = readString(error_.message) ?? String(error ?? "");

  // 1. Quota / billing exhaustion — never retryable.
  if (code === "insufficient_quota" || QUOTA_PATTERN.test(message)) {
    return { kind: "quota", retryable: false, status, code };
  }

  // 2. Rate-limit throttling — retryable.
  if (
    code === "rate_limit_exceeded" ||
    (status === 429 && !QUOTA_PATTERN.test(message)) ||
    RATE_LIMIT_PATTERN.test(message)
  ) {
    return { kind: "rate_limit", retryable: true, status, code };
  }

  // 3. Network / timeout / 5xx — retryable.
  if (
    status === 408 ||
    (status !== undefined && status >= 500) ||
    name === "APIConnectionError" ||
    name === "APIConnectionTimeoutError" ||
    TRANSIENT_PATTERN.test(message)
  ) {
    return { kind: "transient", retryable: true, status, code };
  }

  // 4. Everything else (4xx bad request, auth, context length) — terminal.
  return { kind: "terminal", retryable: false, status, code };
}
