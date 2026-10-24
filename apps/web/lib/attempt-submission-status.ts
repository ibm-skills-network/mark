import { getApiRoutes } from "@/config/constants";
import { apiClient } from "./api-client";

/** What the API says about an attempt right now. */
export interface AttemptSubmissionStatus {
  id: number;
  submitted: boolean;
  closedAtTimeLimit: boolean;
  acceptingSubmissions: boolean;
  expiresAt: string | null;
  serverNow: string;
}

export type AttemptSubmissionStatusResult =
  | {
      ok: true;
      status: AttemptSubmissionStatus;
      /** `serverNow - deviceNow`, measured on this request. */
      serverTimeOffsetMs: number;
    }
  | { ok: false };

/** Why an attempt the page was handed can no longer be edited. */
export type ClosedAttemptReason = "time_limit" | "submitted" | "expired";

export const closedAttemptReason = (
  status: AttemptSubmissionStatus,
): ClosedAttemptReason | null => {
  if (status.acceptingSubmissions) return null;
  if (!status.submitted) return "expired";
  return status.closedAtTimeLimit ? "time_limit" : "submitted";
};

const isStatus = (value: unknown): value is AttemptSubmissionStatus => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.submitted === "boolean" &&
    typeof candidate.acceptingSubmissions === "boolean" &&
    typeof candidate.serverNow === "string"
  );
};

/**
 * Asks the API, now, whether an attempt still accepts a submit, and measures
 * the device clock against the server's on the same round trip.
 *
 * The attempt payload a page is rendered from can be arbitrarily old — the
 * router cache and back/forward cache both replay it — so a clock offset taken
 * from its `serverNow` is wrong by the payload's age, and its `submitted` flag
 * may describe an attempt that has since been closed. This reading is taken at
 * mount and is what the countdown runs against.
 *
 * The offset uses the midpoint of the request, so it is off by at most half
 * the round trip rather than by however long rendering and hydration took.
 */
export async function getAttemptSubmissionStatus(
  assignmentId: number,
  attemptId: number,
): Promise<AttemptSubmissionStatusResult> {
  const endpointURL = `${getApiRoutes().assignments}/${assignmentId}/attempts/${attemptId}/submission-status`;
  const sentAt = Date.now();
  try {
    // The route answers plain JSON; the shared decoder would try to
    // base64-decode its fields.
    const body = await apiClient.get<unknown>(endpointURL, {
      quiet: true,
      transformResponse: false,
    });
    const receivedAt = Date.now();
    if (!isStatus(body)) {
      console.warn(
        "[learner] attempt status response had an unexpected shape",
        {
          assignmentId,
          attemptId,
        },
      );
      return { ok: false };
    }
    const serverNowMs = Date.parse(body.serverNow);
    if (Number.isNaN(serverNowMs)) {
      console.warn("[learner] attempt status carried no usable server time", {
        assignmentId,
        attemptId,
      });
      return { ok: false };
    }
    return {
      ok: true,
      status: body,
      serverTimeOffsetMs: serverNowMs - (sentAt + receivedAt) / 2,
    };
  } catch (error) {
    // The server still enforces the deadline; the caller falls back to the
    // payload's clock reading rather than blocking the learner.
    console.warn("[learner] attempt status request failed", {
      assignmentId,
      attemptId,
      error,
    });
    return { ok: false };
  }
}
