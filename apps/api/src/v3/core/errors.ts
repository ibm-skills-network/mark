export type V3ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL";

/** The only messages a v3 client ever sees; they never carry internals. */
export type V3PublicMessage =
  | "Invalid request"
  | "Invalid user session"
  | "Unauthorized"
  | "Forbidden"
  | "Not found"
  | "Conflict"
  | "Payload too large"
  | "Too many requests"
  | "Internal error";

export type V3ErrorBody = {
  code: V3ErrorCode;
  message: V3PublicMessage;
  requestId: string;
};

/**
 * A refusal with a status, code and generic public message. `reason` is a
 * short machine-readable cause that is logged and never returned; `details`
 * (also logged only) must not carry request content or secrets.
 */
export class V3Error extends Error {
  private constructor(
    readonly status: number,
    readonly code: V3ErrorCode,
    readonly publicMessage: V3PublicMessage,
    readonly reason: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(reason);
    this.name = "V3Error";
  }

  static badRequest(
    reason: string,
    message: "Invalid request" | "Invalid user session" = "Invalid request",
    details?: Record<string, unknown>,
  ): V3Error {
    return new V3Error(400, "BAD_REQUEST", message, reason, details);
  }

  static unauthorized(reason: string): V3Error {
    return new V3Error(401, "UNAUTHORIZED", "Unauthorized", reason);
  }

  static forbidden(reason: string): V3Error {
    return new V3Error(403, "FORBIDDEN", "Forbidden", reason);
  }

  static notFound(reason: string): V3Error {
    return new V3Error(404, "NOT_FOUND", "Not found", reason);
  }

  static conflict(reason: string): V3Error {
    return new V3Error(409, "CONFLICT", "Conflict", reason);
  }

  static payloadTooLarge(reason: string): V3Error {
    return new V3Error(413, "PAYLOAD_TOO_LARGE", "Payload too large", reason);
  }

  static tooManyRequests(reason: string): V3Error {
    return new V3Error(429, "TOO_MANY_REQUESTS", "Too many requests", reason);
  }

  static internal(reason: string): V3Error {
    return new V3Error(500, "INTERNAL", "Internal error", reason);
  }

  body(requestId: string): V3ErrorBody {
    return { code: this.code, message: this.publicMessage, requestId };
  }
}

/** Error fields for a log line: name, message, code and stack only. */
export function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const code: unknown = Reflect.get(error, "code");
    return {
      name: error.name,
      message: error.message,
      code: typeof code === "string" || typeof code === "number" ? code : null,
      stack: error.stack ?? null,
    };
  }
  return {
    name: typeof error,
    message: String(error),
    code: null,
    stack: null,
  };
}
