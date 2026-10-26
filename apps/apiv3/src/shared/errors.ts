import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", details?: Record<string, unknown>) {
    super("UNAUTHORIZED", 401, message, details);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: Record<string, unknown>) {
    super("BAD_REQUEST", 400, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found", details?: Record<string, unknown>) {
    super("NOT_FOUND", 404, message, details);
  }
}

export class DependencyUnavailableError extends AppError {
  constructor(
    message = "Dependency unavailable",
    details?: Record<string, unknown>,
  ) {
    super("DEPENDENCY_UNAVAILABLE", 503, message, details);
  }
}

export type ErrorEnvelope = {
  status: number;
  body: { code: string; message: string; requestId: string };
};

export function errorEnvelope(err: unknown, requestId: string): ErrorEnvelope {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: { code: err.code, message: err.message, requestId },
    };
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        code: "VALIDATION_FAILED",
        message: "Invalid request",
        requestId,
      },
    };
  }
  return {
    status: 500,
    body: { code: "INTERNAL_ERROR", message: "Internal error", requestId },
  };
}
