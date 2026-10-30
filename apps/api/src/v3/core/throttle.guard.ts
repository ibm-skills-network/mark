import { Injectable, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { V3Error } from "./errors";
import { principalFor } from "./http-context";

/**
 * Rate limits a v3 route. Requests are counted per signed-in user when an
 * earlier guard attached a Principal (so admins sharing an office IP do not
 * share a budget), otherwise per client IP. Over the limit is a 429 in the
 * v3 envelope.
 */
@Injectable()
export class V3ThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(
    request: Record<string, unknown>,
  ): Promise<string> {
    const principal = principalFor(request);
    if (principal) return Promise.resolve(`user:${principal.userId}`);
    const ip = request.ip;
    return Promise.resolve(`ip:${typeof ip === "string" ? ip : "unknown"}`);
  }

  protected override throwThrottlingException(): Promise<void> {
    throw V3Error.tooManyRequests("rate_limited");
  }
}

/**
 * Applies the v3 rate limit. Guards run in the order they are applied and
 * decorators apply bottom-up, so put this ABOVE the auth decorator to count
 * per user. Pair it with @Throttle for the route's numbers.
 */
export const UseV3Throttle = (): MethodDecorator & ClassDecorator =>
  UseGuards(V3ThrottlerGuard);
