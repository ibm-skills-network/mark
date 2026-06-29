import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Stable, machine-readable code returned in the response body so the frontend
 * can distinguish "AI temporarily disabled" from other 503s and show the
 * out-of-service popup. Keep this string in sync with the web client.
 */
export const AI_TEMPORARILY_DISABLED_CODE = "AI_TEMPORARILY_DISABLED";

export const AI_TEMPORARILY_DISABLED_MESSAGE =
  "This activity is temporarily out of service. Please try again later.";

/**
 * Thrown when a learner tries to start or submit an AI-graded attempt — or any
 * other AI-backed action — while that AI component is switched off. Surfaces as
 * HTTP 503 so it reads as a transient service condition, not a client error.
 */
export class AiTemporarilyDisabledException extends HttpException {
  constructor(message: string = AI_TEMPORARILY_DISABLED_MESSAGE) {
    super(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: AI_TEMPORARILY_DISABLED_CODE,
        message,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
