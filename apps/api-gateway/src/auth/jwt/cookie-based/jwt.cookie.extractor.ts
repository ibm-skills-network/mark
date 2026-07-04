import { Request } from "express";

const COOKIE_NAME = "authentication";

export interface AuthCookieSelection {
  /** The chosen cookie value, or undefined when none is present. */
  token: string | undefined;
  /** How many `authentication` cookies the request carried. >1 means jar duplication. */
  candidateCount: number;
}

/**
 * Selects which `authentication` cookie to authenticate with.
 *
 * The lti-gateway sets this cookie with different attributes per LTI version
 * (1.1: SameSite=Lax unpartitioned, 1.3: SameSite=None; Partitioned). CHIPS
 * partitioning means those live in separate browser cookie jars, so one
 * browser can legitimately hold several `authentication` cookies at once —
 * none of which ever overwrite each other. Browsers send duplicates
 * oldest-first (RFC 6265 §5.4) and cookie-parser keeps only the first, so
 * without this selection step the STALEST session always wins and a fresh
 * launch can land the user in a previous session's user/assignment.
 *
 * Selection rule: prefer the token with the newest decodable `iat` (the most
 * recent launch = the user's most recent intent). Signature verification is
 * intentionally left to passport-jwt on the winner: if the newest token is
 * expired or invalid the request fails closed (401 → relaunch) rather than
 * silently reviving an older session, which is the exact bug this prevents.
 */
export function selectAuthenticationCookie(
  request: Pick<Request, "headers"> & {
    cookies?: Record<string, string>;
  },
): AuthCookieSelection {
  const candidates: string[] = [];

  const rawHeader = request.headers?.cookie;
  if (typeof rawHeader === "string" && rawHeader.length > 0) {
    for (const pair of rawHeader.split(";")) {
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }
      const name = pair.slice(0, separatorIndex).trim();
      if (name !== COOKIE_NAME) {
        continue;
      }
      const value = pair.slice(separatorIndex + 1).trim();
      if (value.length > 0) {
        candidates.push(tryDecodeUriComponent(value));
      }
    }
  }

  // Raw header absent (e.g. internal callers): fall back to cookie-parser's
  // view, which by construction holds at most one value per name.
  if (candidates.length === 0) {
    const parsed = request.cookies?.[COOKIE_NAME];
    return { token: parsed, candidateCount: parsed ? 1 : 0 };
  }

  let selected = candidates[0];
  let selectedIat = decodeIat(selected);
  for (const candidate of candidates.slice(1)) {
    const iat = decodeIat(candidate);
    if (iat > selectedIat) {
      selected = candidate;
      selectedIat = iat;
    }
  }

  return { token: selected, candidateCount: candidates.length };
}

/** cookie-parser parity: values are usually URL-encoded; garbage passes through. */
function tryDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Not valid percent-encoding — use the raw value, matching cookie-parser.
    return value;
  }
}

/**
 * Best-effort read of a JWT's `iat` without verifying it. Undecodable tokens
 * rank lowest; the eventual winner is still signature-checked by passport.
 */
function decodeIat(token: string): number {
  try {
    const segments = token.split(".");
    if (segments.length < 2) {
      return -1;
    }
    const payload = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    ) as { iat?: unknown };
    return typeof payload.iat === "number" && Number.isFinite(payload.iat)
      ? payload.iat
      : -1;
  } catch {
    // Not a decodable JWT — rank it below any decodable candidate.
    return -1;
  }
}
