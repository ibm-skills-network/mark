import { getBaseApiPath } from "@/config/constants";
import { createRateLimiter } from "@/lib/rate-limit";
import { createHash } from "node:crypto";

const SESSION_COOKIE_PREFIX = "authentication=";

/**
 * A chat turn costs a model call, so the budget is per caller and generous
 * enough for a real conversation while still bounding what one account can
 * spend. Both chat routes share this limiter: alternating between them must
 * not hand a caller twice the budget.
 */
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_MAX_TRACKED_CALLERS = 5000;

const chatRateLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  maxRequests: RATE_LIMIT_MAX_REQUESTS,
  maxTrackedKeys: RATE_LIMIT_MAX_TRACKED_CALLERS,
});

/** Who the API says the caller is, and the cookie that proved it. */
export interface VerifiedChatSession {
  userId: string;
  assignmentId?: number;
  /** Forwarded downstream so the backend authenticates the same session. */
  cookie: string;
}

interface ChatRequestAllowed {
  outcome: "allowed";
  session: VerifiedChatSession;
  /** Non-identifying handle for logs and rate-limit buckets. */
  caller: string;
}

interface ChatRequestDenied {
  outcome: "denied";
  status: number;
  /** Generic, safe to hand to the browser. */
  message: string;
}

export type ChatRequestAuthorization = ChatRequestAllowed | ChatRequestDenied;

function hasSessionCookie(cookieHeader: string): boolean {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .some(
      (part) =>
        part.startsWith(SESSION_COOKIE_PREFIX) &&
        part.length > SESSION_COOKIE_PREFIX.length,
    );
}

/** Identifies a caller in logs and rate-limit buckets without recording who they are. */
function callerKey(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 16);
}

/**
 * Asks the API whose session this is. The cookie only carries a session:
 * whether it is valid, and who it belongs to, is never inferred from its value
 * and never read from a header the caller controls.
 */
async function resolveSession(
  cookieHeader: string,
): Promise<VerifiedChatSession | null> {
  const response = await fetch(`${getBaseApiPath("v1")}/user-session`, {
    headers: { Cookie: cookieHeader },
  });

  if (!response.ok) return null;

  const session = (await response.json()) as {
    userId?: unknown;
    assignmentId?: unknown;
  };

  if (typeof session.userId !== "string" || session.userId.length === 0) {
    return null;
  }

  return {
    userId: session.userId,
    assignmentId:
      typeof session.assignmentId === "number"
        ? session.assignmentId
        : undefined,
    cookie: cookieHeader,
  };
}

/**
 * Decides whether a chat request may proceed, and on whose behalf.
 *
 * The caller's identity comes from the API alone. A request that names its own
 * user is refused rather than believed, and a request that cannot be checked is
 * refused rather than let through.
 *
 * @param request incoming chat request
 * @param logEvent event prefix for the structured log lines this emits
 */
export async function authorizeChatRequest(
  request: Request,
  logEvent: string,
): Promise<ChatRequestAuthorization> {
  // Identity is not something a request gets to assert. Anything claiming a
  // user in a header is refused outright, so no code path can read it later.
  if (request.headers.get("user-session")) {
    console.warn(`${logEvent}.rejected`, { reason: "self_declared_identity" });
    return { outcome: "denied", status: 401, message: "Unauthorized" };
  }

  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader || !hasSessionCookie(cookieHeader)) {
    console.warn(`${logEvent}.rejected`, { reason: "no_session" });
    return { outcome: "denied", status: 401, message: "Unauthorized" };
  }

  let session: VerifiedChatSession | null;
  try {
    session = await resolveSession(cookieHeader);
  } catch (error) {
    // The session service is the only thing that can authorize this call, so a
    // failure to reach it has to fail closed rather than let the request run.
    console.error(`${logEvent}.failed`, {
      reason: "session_check_unavailable",
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return { outcome: "denied", status: 503, message: "Chat unavailable" };
  }

  if (!session) {
    console.warn(`${logEvent}.rejected`, { reason: "invalid_session" });
    return { outcome: "denied", status: 401, message: "Unauthorized" };
  }

  const caller = callerKey(session.userId);

  if (chatRateLimiter.isRateLimited(caller)) {
    console.warn(`${logEvent}.rejected`, { caller, reason: "rate_limited" });
    return { outcome: "denied", status: 429, message: "Too many requests" };
  }

  return { outcome: "allowed", session, caller };
}
