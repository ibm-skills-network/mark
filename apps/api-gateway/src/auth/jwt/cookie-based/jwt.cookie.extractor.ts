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
  const rawHeader = request.headers?.cookie;
  const candidates = parseCookiePairs(rawHeader)
    .filter((pair) => pair.name === COOKIE_NAME)
    .map((pair) => tryDecodeUriComponent(pair.rawValue));

  // Raw header absent (e.g. internal callers): fall back to cookie-parser's
  // view, which by construction holds at most one value per name.
  if (candidates.length === 0) {
    const parsed = request.cookies?.[COOKIE_NAME];
    return { token: parsed, candidateCount: parsed ? 1 : 0 };
  }

  return {
    token: candidates[pickNewestIatIndex(candidates)],
    candidateCount: candidates.length,
  };
}

/**
 * Rebuilds a Cookie header so it carries only the newest-iat `authentication`
 * cookie, preserving all other cookies untouched (raw values, original order,
 * winner appended last). Returns undefined when no rewrite is needed (zero or
 * one `authentication` cookie) so callers can skip the override entirely.
 *
 * Used by the gateway's forwarding layer: downstream services re-read the
 * cookie themselves (e.g. mark-api stores it as the LTI grade-callback
 * credential), and they must see the SAME session this gateway authenticated,
 * not whichever duplicate happened to come first.
 */
export function dedupeAuthenticationCookieHeader(
  rawHeader?: string,
): string | undefined {
  const pairs = parseCookiePairs(rawHeader);
  const authPairs = pairs.filter((pair) => pair.name === COOKIE_NAME);
  if (authPairs.length <= 1) {
    return undefined;
  }

  const winnerIndex = pickNewestIatIndex(
    authPairs.map((pair) => tryDecodeUriComponent(pair.rawValue)),
  );
  const winner = authPairs[winnerIndex];

  const kept = pairs.filter((pair) => pair.name !== COOKIE_NAME);
  kept.push(winner);
  return kept.map((pair) => `${pair.name}=${pair.rawValue}`).join("; ");
}

interface CookiePair {
  name: string;
  rawValue: string;
}

function parseCookiePairs(rawHeader: string | undefined): CookiePair[] {
  if (typeof rawHeader !== "string" || rawHeader.length === 0) {
    return [];
  }
  const pairs: CookiePair[] = [];
  for (const pair of rawHeader.split(";")) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const name = pair.slice(0, separatorIndex).trim();
    const rawValue = pair.slice(separatorIndex + 1).trim();
    if (name.length > 0 && rawValue.length > 0) {
      pairs.push({ name, rawValue });
    }
  }
  return pairs;
}

/** Index of the token with the newest decodable iat; ties keep the earliest. */
function pickNewestIatIndex(tokens: string[]): number {
  let selectedIndex = 0;
  let selectedIat = decodeIat(tokens[0]);
  for (let index = 1; index < tokens.length; index++) {
    const iat = decodeIat(tokens[index]);
    if (iat > selectedIat) {
      selectedIndex = index;
      selectedIat = iat;
    }
  }
  return selectedIndex;
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
