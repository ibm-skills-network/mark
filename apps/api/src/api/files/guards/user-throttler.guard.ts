import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { UserSession } from "src/auth/interfaces/user.session.interface";

/**
 * Throttler keyed on the authenticated user instead of the client IP.
 *
 * Requests reach this service through the gateway, and Express is not
 * configured to trust proxy headers, so every request reports the same
 * remote address. An IP-keyed bucket would therefore be one global bucket:
 * a handful of uploads would rate-limit the entire platform.
 *
 * Falls back to the socket address when no session is present. Those requests
 * are rejected by the auth guard anyway; the fallback only keeps unauthenticated
 * traffic from sharing a single empty key.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(request: Record<string, unknown>): Promise<string> {
    const session = request.userSession as UserSession | undefined;
    const userId = session?.userId;

    if (typeof userId === "string" && userId.length > 0) {
      return Promise.resolve(`user:${userId}`);
    }

    const ip = typeof request.ip === "string" ? request.ip : "unknown";
    return Promise.resolve(`ip:${ip}`);
  }
}
