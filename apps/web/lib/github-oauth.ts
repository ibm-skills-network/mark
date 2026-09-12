/**
 * Client side of the GitHub file-picker OAuth handoff.
 *
 * Two things live here because both of them used to be wrong in the modal:
 *
 * 1. The authorization code is consumed exactly once. It is removed from the
 *    address bar the moment it is read — not only when the exchange succeeds —
 *    and remembered for the rest of the browser session, so a remount, a reload
 *    or a second upload question can never re-post a code GitHub has already
 *    spent.
 * 2. A failure is classified instead of being flattened to "token expired".
 *    Nothing had ever issued a token to most of the learners who saw that
 *    message.
 */
import { API_VERSIONS, getBaseApiPath } from "@/config/constants";

/** How many failed connection attempts before we stop sending learners back. */
export const GITHUB_AUTH_MAX_ATTEMPTS = 3;

const CONSUMED_CODE_KEY = "mark.github-oauth.consumed-code";
const FAILURE_COUNT_KEY = "mark.github-oauth.failures";
const OAUTH_QUERY_PARAMS = ["code", "state", "iss"];

export type GithubAuthFailure =
  | "configuration"
  | "authorization_expired"
  | "authorization_invalid"
  | "access_denied"
  | "token_rejected"
  | "session_expired"
  | "unavailable"
  | "unknown";

/**
 * Flat on purpose: this app compiles without `strictNullChecks`, where a
 * discriminated union does not narrow, so callers check the fields directly.
 */
export interface GithubExchangeResult {
  token: string | null;
  failure: GithubAuthFailure | null;
}

export interface PendingGithubAuthorization {
  code: string;
  state: string | null;
}

const SERVER_FAILURES: Record<string, GithubAuthFailure> = {
  github_configuration_error: "configuration",
  github_authorization_expired: "authorization_expired",
  github_authorization_invalid: "authorization_invalid",
  github_access_denied: "access_denied",
  github_unavailable: "unavailable",
};

const FAILURE_COPY: Record<
  GithubAuthFailure,
  { message: string; canRetry: boolean }
> = {
  configuration: {
    message:
      "GitHub sign-in is not working right now. This is a problem on our side, " +
      "not with your GitHub account.",
    canRetry: false,
  },
  authorization_expired: {
    message:
      "That GitHub sign-in had already been used. Connect to GitHub again to continue.",
    canRetry: true,
  },
  authorization_invalid: {
    message:
      "We could not verify that GitHub sign-in. Connect to GitHub again to continue.",
    canRetry: true,
  },
  access_denied: {
    message:
      "GitHub did not give Mark access to your repositories. Connect again and " +
      "approve access to continue.",
    canRetry: true,
  },
  token_rejected: {
    message:
      "GitHub no longer accepts your saved connection. Connect to GitHub again " +
      "to continue.",
    canRetry: true,
  },
  session_expired: {
    message:
      "Your session has expired. Refresh this page, then connect to GitHub again.",
    canRetry: false,
  },
  unavailable: {
    message: "We could not reach GitHub just now. Try again in a moment.",
    canRetry: true,
  },
  unknown: {
    message: "We could not connect your GitHub account.",
    canRetry: true,
  },
};

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // Private-mode browsers can throw on access. Losing the de-duplication
    // hint is survivable; the URL is stripped either way.
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Same as above: best effort, never fatal.
  }
}

function removeSession(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Same as above: best effort, never fatal.
  }
}

/**
 * Reads the authorization code GitHub redirected back with, strips the OAuth
 * parameters from the address bar, and returns the code only the first time it
 * is seen. Other query parameters (`authorMode`, for one) are preserved.
 */
export function consumeGithubAuthorizationCode(): PendingGithubAuthorization | null {
  if (typeof window === "undefined") {
    return null;
  }

  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) {
    return null;
  }
  const state = url.searchParams.get("state");

  for (const param of OAUTH_QUERY_PARAMS) {
    url.searchParams.delete(param);
  }
  window.history.replaceState(
    {},
    document.title,
    `${url.pathname}${url.search}${url.hash}`,
  );

  if (readSession(CONSUMED_CODE_KEY) === code) {
    return null;
  }
  writeSession(CONSUMED_CODE_KEY, code);

  return { code, state };
}

/**
 * Exchanges the code for a GitHub token, returning why it failed rather than a
 * bare null.
 */
export async function exchangeGithubAuthorizationCode(
  code: string,
  state: string | null,
): Promise<GithubExchangeResult> {
  try {
    const response = await fetch(
      `${getBaseApiPath(API_VERSIONS.V1)}/github/oauth-callback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state: state ?? undefined }),
      },
    );

    const body = (await response.json().catch(() => ({}))) as Partial<{
      token: string;
      code: string;
    }>;

    if (response.ok) {
      return body.token
        ? { token: body.token, failure: null }
        : { token: null, failure: "unknown" };
    }

    if (response.status === 401) {
      return { token: null, failure: "session_expired" };
    }
    if (response.status === 429) {
      return { token: null, failure: "unavailable" };
    }

    const mapped = body.code ? SERVER_FAILURES[body.code] : undefined;
    if (mapped) {
      return { token: null, failure: mapped };
    }

    return {
      token: null,
      failure: response.status >= 500 ? "unavailable" : "unknown",
    };
  } catch {
    return { token: null, failure: "unavailable" };
  }
}

/** Learner-facing wording for a failure, plus whether retrying can help. */
export function describeGithubAuthFailure(failure: GithubAuthFailure): {
  message: string;
  canRetry: boolean;
} {
  return FAILURE_COPY[failure] ?? FAILURE_COPY.unknown;
}

/**
 * Failed attempts are counted in session storage because each retry is a full
 * page navigation to github.com and back — component state does not survive it.
 */
export function readGithubAuthFailureCount(): number {
  if (typeof window === "undefined") {
    return 0;
  }
  const stored = Number(readSession(FAILURE_COUNT_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : 0;
}

export function recordGithubAuthFailure(): number {
  const next = readGithubAuthFailureCount() + 1;
  if (typeof window !== "undefined") {
    writeSession(FAILURE_COUNT_KEY, String(next));
  }
  return next;
}

export function clearGithubAuthFailures(): void {
  if (typeof window === "undefined") {
    return;
  }
  removeSession(FAILURE_COUNT_KEY);
}
