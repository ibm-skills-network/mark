import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Gateway-side throttle guard for the public admin-auth passthrough routes
 * (send-code / verify-code). Keyed on the first X-Forwarded-For hop so that
 * the per-IP bucket is accurate even behind an ingress proxy. Falls back to
 * req.ip when no XFF header is present.
 */
@Injectable()
export class PublicAuthThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(
    request: Record<string, unknown>,
  ): Promise<string> {
    const headers = request["headers"] as Record<
      string,
      string | string[] | undefined
    >;
    const xff = headers?.["x-forwarded-for"];
    const xffString = Array.isArray(xff) ? xff[0] : xff;
    if (xffString) {
      return Promise.resolve(xffString.split(",")[0].trim());
    }
    return Promise.resolve((request["ip"] as string | undefined) ?? "");
  }
}
