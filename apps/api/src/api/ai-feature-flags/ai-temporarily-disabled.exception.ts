import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Stable, machine-readable code returned in the response body so the frontend
 * can distinguish "AI temporarily disabled" from other client errors and show
 * the out-of-service notice. Keep this string in sync with the web client.
 */
export const AI_TEMPORARILY_DISABLED_CODE = "AI_TEMPORARILY_DISABLED";

export const AI_TEMPORARILY_DISABLED_MESSAGE =
  "This activity is temporarily out of service. Please try again later.";

/**
 * Thrown when a learner tries to start or submit an AI-graded attempt — or any
 * other AI-backed action — while that AI component is switched off.
 *
 * Surfaces as HTTP 409 (a client-side "can't do this right now"), NOT 503:
 * the api-gateway and service mesh special-case 5xx responses (treating them
 * as "upstream down" and coercing them toward a generic 500), which strips our
 * JSON body and breaks the learner-facing message. 4xx codes pass through the
 * gateway untouched — the same reason the existing 422/429 attempt errors reach
 * the UI cleanly. The body still carries `code` so the client matches on that.
 */
export class AiTemporarilyDisabledException extends HttpException {
  constructor(message: string = AI_TEMPORARILY_DISABLED_MESSAGE) {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        code: AI_TEMPORARILY_DISABLED_CODE,
        message,
      },
      HttpStatus.CONFLICT,
    );
  }
}
