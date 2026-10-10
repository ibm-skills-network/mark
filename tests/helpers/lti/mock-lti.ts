/**
 * Mock LTI foundation for Playwright E2E.
 *
 * Two halves:
 *
 *   1. LTI LAUNCH  — `buildLtiLaunchCookie` / `performLtiLaunch` produce the
 *      `authentication` cookie a real LMS launch results in. In production an
 *      external SSO / LTI gateway performs the OIDC launch and mints this HS256
 *      JWT cookie; the api-gateway's `JwtCookieStrategy`
 *      (apps/api-gateway/.../jwt.cookie.strategy.ts) then turns those JWT claims
 *      into the `UserSession`, and the api reads them off the forwarded
 *      `user-session` header AND the forwarded `authentication` cookie.
 *
 *      There is NO launch/OIDC endpoint reachable inside the e2e stack (the
 *      external LMS + SSO are not stood up), so we take the CONSTRUCT-THE-COOKIE
 *      path: we sign the exact JWT the launch would have produced, carrying the
 *      LTI launch claims the product actually consumes:
 *        - userID                       (an EMAIL — the LMS user identity)
 *        - role                         (learner | author)
 *        - groupID                      (the LMS course/context → Mark group)
 *        - assignmentID
 *        - gradingCallbackRequired      (LMS provided an AGS lineitem → passback on)
 *        - returnUrl                    (launch_presentation_return_url)
 *        - launch_presentation_locale   (UI locale from the launch)
 *      This mirrors the core `mintAuthCookie` (tests/helpers/auth.ts) but adds
 *      the two launch-only claims the core helper hardcodes to a fixed value
 *      (`gradingCallbackRequired:false`). Reusing the same secret + cookie name
 *      means the gateway accepts it exactly as it would a real launch.
 *
 *   2. MOCK LMS    — `startMockLms()` is a tiny `node:http` server (no new deps)
 *      that stands in for the LMS AGS endpoint the api PUTs grades to. The
 *      api's `LtiGradeSyncService` (apps/api/.../lti-grade-sync.service.ts) does:
 *          PUT <GRADING_LTI_GATEWAY_URL>
 *          headers: { Cookie: `authentication=<authCookie>` }
 *          body:    { score: <grade 0..1> }
 *      and treats HTTP 200 as SUCCESS. The mock records every PUT (score, the
 *      forwarded authentication cookie, the path/lineitem, headers) so a spec
 *      can assert the passback fired with the right score. By default it answers
 *      200; `failNext()` / `setResponseStatus()` let a spec exercise the
 *      SCHEDULED/FAILED retry paths.
 *
 *      The api reads `GRADING_LTI_GATEWAY_URL` from its environment at BOOT
 *      (apps/api `start:e2e` → `dotenv -e ./dev.env`), in a process started by
 *      Playwright's `webServer` BEFORE any test runs. A test cannot inject a
 *      dynamically-chosen port into that already-running process. So the mock
 *      binds to a FIXED, well-known port (`MOCK_LMS_PORT`, default 4567) and the
 *      env var must be pre-pointed at it:
 *          GRADING_LTI_GATEWAY_URL=http://127.0.0.1:4567/lineitems/e2e/scores
 *      See `MOCK_LMS_URL` below and the StructuredOutput envOrConfig notes. Until
 *      that env wiring lands, the full round-trip passback spec is `test.fixme`;
 *      the mock, launch, and status-UI specs run unconditionally.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { BrowserContext } from "@playwright/test";
import {
  getTestEnvironmentConfig,
  type TestEnvironmentConfig,
} from "../assignment-helpers";
import {
  AUTH_COOKIE_NAME,
  DEFAULT_EXPIRES_IN_SECONDS,
  DEFAULT_LOCALE,
  DEFAULT_RETURN_URL,
  buildAuthStorageState,
  signAuthJwt,
  type StorageState,
  type StorageStateCookie,
} from "../jwt";

export type LtiRole = "learner" | "author";

/**
 * Claims an LMS launch contributes. Everything except `userId` + `role` has a
 * launch-shaped default so a spec can launch with one line.
 */
export type LtiLaunchOptions = {
  /** LMS user identity — an EMAIL (User.userId is an email across the schema). */
  userId: string;
  role: LtiRole;
  /** LMS course/context mapped to a Mark group. Defaults to the test group. */
  groupId?: string;
  /** Assignment the launch targets. Defaults to 0 (resolved by URL in the UI). */
  assignmentId?: number;
  /**
   * Whether the LMS supplied an AGS lineitem (i.e. grades must be passed back).
   * THIS is what turns on the grade-sync path in the api. The core mintAuthCookie
   * hardcodes this false; the LTI launch sets it true so passback fires.
   */
  gradingCallbackRequired?: boolean;
  /** launch_presentation_return_url — where "return to course" sends the user. */
  returnUrl?: string;
  /** launch_presentation_locale — UI locale negotiated at launch. */
  locale?: string;
  /** Token lifetime in seconds from now. Default 6h. Negative = already expired. */
  expiresInSeconds?: number;
  /** Override the configured environment (rarely needed). */
  config?: TestEnvironmentConfig;
};

export type { StorageState, StorageStateCookie };

/** The exact JWT payload an LTI launch produces (matches UserSessionPayload). */
type LtiJwtPayload = {
  userID: string;
  role: LtiRole;
  assignmentID: number;
  groupID: string;
  gradingCallbackRequired: boolean;
  returnUrl: string;
  launch_presentation_locale: string;
  iat: number;
  exp: number;
};

export type LtiLaunchToken = {
  token: string;
  expiresAt: number;
  payload: LtiJwtPayload;
};

/**
 * Sign the `authentication` JWT a real LTI launch would have produced. HS256
 * with the dev secret — byte-identical to what the api-gateway accepts.
 */
export function mintLtiLaunchToken(options: LtiLaunchOptions): LtiLaunchToken {
  const config = options.config ?? getTestEnvironmentConfig();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt =
    issuedAt + (options.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS);

  const payload: LtiJwtPayload = {
    userID: options.userId,
    role: options.role,
    assignmentID: options.assignmentId ?? 0,
    groupID: options.groupId ?? config.groupId,
    gradingCallbackRequired: options.gradingCallbackRequired ?? false,
    returnUrl: options.returnUrl ?? DEFAULT_RETURN_URL,
    launch_presentation_locale: options.locale ?? DEFAULT_LOCALE,
    iat: issuedAt,
    exp: expiresAt,
  };

  return {
    token: signAuthJwt(payload, config.jwtSecret),
    expiresAt,
    payload,
  };
}

/**
 * Build a Playwright `storageState` containing the post-launch `authentication`
 * cookie. Pass to `browser.newContext({ storageState })`, or write to disk and
 * point a project's `storageState` at it.
 */
export function buildLtiLaunchCookie(options: LtiLaunchOptions): StorageState {
  const config = options.config ?? getTestEnvironmentConfig();
  const { token, expiresAt } = mintLtiLaunchToken(options);
  const { hostname } = new URL(config.webBaseUrl);
  return buildAuthStorageState({ token, expiresAt, hostname });
}

/**
 * Drive an LTI launch against an EXISTING browser context: replace whatever the
 * project storageState set with the post-launch `authentication` cookie, so the
 * very next navigation is an authenticated, launch-shaped session. Returns the
 * token + decoded claims for assertions.
 *
 * (Named `performLtiLaunch` because, from the spec's point of view, this IS the
 * launch — it puts the user in the same state a real LMS launch would.)
 */
export async function performLtiLaunch(
  context: BrowserContext,
  options: LtiLaunchOptions,
): Promise<LtiLaunchToken> {
  const config = options.config ?? getTestEnvironmentConfig();
  const minted = mintLtiLaunchToken(options);
  const { hostname } = new URL(config.webBaseUrl);

  await context.clearCookies({ name: AUTH_COOKIE_NAME });
  await context.addCookies([
    {
      name: AUTH_COOKIE_NAME,
      value: minted.token,
      domain: hostname,
      path: "/",
      expires: minted.expiresAt,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  return minted;
}

// ───────────────────────── Mock LMS (AGS endpoint) ─────────────────────────

/** A single recorded grade-passback the api PUT to the mock LMS. */
export type ReceivedScore = {
  /** Request path (the AGS lineitem/scores route). */
  path: string;
  method: string;
  /** Parsed body — the api sends `{ score }` (grade in 0..1). */
  body: unknown;
  /** The score extracted from the body, if present. */
  score: number | null;
  /**
   * The user identity the score belongs to. The api's PUT body is only
   * `{ score }`; the learner identity travels in the forwarded
   * `authentication` cookie, so we decode it from there (best-effort).
   */
  userId: string | null;
  /** The raw `authentication` cookie value the api forwarded, if any. */
  authCookie: string | null;
  /** All request headers, lower-cased (for cookie / content-type assertions). */
  headers: Record<string, string | string[] | undefined>;
  receivedAt: string;
};

export type MockLms = {
  /** Base URL the mock listens on, e.g. http://127.0.0.1:4567 */
  url: string;
  /** The default AGS scores URL to point GRADING_LTI_GATEWAY_URL at. */
  scoresUrl: string;
  /** Port actually bound. */
  port: number;
  /** Every passback received so far, in arrival order. */
  getReceivedScores(): ReceivedScore[];
  /** The most recent passback, or null. */
  lastScore(): ReceivedScore | null;
  /** Clear recorded passbacks (call in beforeEach / afterEach). */
  reset(): void;
  /** Make the NEXT passback respond with `status` (default 500) then recover. */
  failNext(status?: number): void;
  /** Make ALL subsequent passbacks respond with `status` until changed. */
  setResponseStatus(status: number): void;
  /**
   * Resolve once at least `count` passbacks have arrived (default 1), or reject
   * after `timeoutMs` (default 30s). Lets a spec await an async passback without
   * a fixed sleep.
   */
  waitForScore(count?: number, timeoutMs?: number): Promise<ReceivedScore[]>;
  /** Stop the server and release the port. */
  stop(): Promise<void>;
};

const DEFAULT_MOCK_LMS_PORT = 4567;
const DEFAULT_SCORES_PATH = "/lineitems/e2e/scores";

/** Decode a JWT payload without verifying (best-effort, for recording only). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf-8");
    const parsed = JSON.parse(json) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractAuthCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === AUTH_COOKIE_NAME) {
      return rest.join("=");
    }
  }
  return null;
}

function extractScore(body: unknown): number | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  // The api sends `{ score }`; accept a couple of common AGS aliases too so the
  // mock survives a payload-shape tweak without silently dropping the score.
  const candidate = record.score ?? record.scoreGiven ?? record.grade;
  return typeof candidate === "number" ? candidate : null;
}

/**
 * Start the mock LMS AGS endpoint. Binds to `port` (default `MOCK_LMS_PORT` env
 * or 4567) on 127.0.0.1. Point the api's `GRADING_LTI_GATEWAY_URL` at the
 * returned `scoresUrl`.
 */
export async function startMockLms(options?: {
  port?: number;
  scoresPath?: string;
}): Promise<MockLms> {
  const scoresPath = options?.scoresPath ?? DEFAULT_SCORES_PATH;
  const requestedPort =
    options?.port ??
    (process.env.MOCK_LMS_PORT
      ? Number(process.env.MOCK_LMS_PORT)
      : DEFAULT_MOCK_LMS_PORT);

  const received: ReceivedScore[] = [];
  let oneShotFailStatus: number | null = null;
  let stickyStatus = 200;
  const waiters: Array<{
    count: number;
    resolve: (scores: ReceivedScore[]) => void;
    timer: NodeJS.Timeout;
  }> = [];

  function notifyWaiters() {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (received.length >= waiters[i].count) {
        clearTimeout(waiters[i].timer);
        waiters[i].resolve([...received]);
        waiters.splice(i, 1);
      }
    }
  }

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      let parsedBody: unknown = raw;
      try {
        parsedBody = raw ? JSON.parse(raw) : null;
      } catch {
        // keep raw string body on parse failure
      }

      const authCookie = extractAuthCookie(
        req.headers.cookie as string | undefined,
      );
      const decoded = authCookie ? decodeJwtPayload(authCookie) : null;
      const userId =
        decoded && typeof decoded.userID === "string"
          ? (decoded.userID as string)
          : null;

      // Only record mutating passbacks (PUT/POST); ignore health probes / GETs.
      if (req.method === "PUT" || req.method === "POST") {
        received.push({
          path: req.url ?? "",
          method: req.method,
          body: parsedBody,
          score: extractScore(parsedBody),
          userId,
          authCookie,
          headers: req.headers,
          receivedAt: new Date().toISOString(),
        });
        notifyWaiters();
      }

      let status = stickyStatus;
      if (oneShotFailStatus !== null) {
        status = oneShotFailStatus;
        oneShotFailStatus = null;
      }

      res.writeHead(status, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: status >= 200 && status < 300,
          received: received.length,
        }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `Mock LMS port ${requestedPort} is already in use. Free it or set MOCK_LMS_PORT to an open port (also update GRADING_LTI_GATEWAY_URL to match).`,
          ),
        );
        return;
      }
      reject(error);
    };
    server.once("error", onError);
    server.listen(requestedPort, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const port = address.port;
  const url = `http://127.0.0.1:${port}`;
  const scoresUrl = `${url}${scoresPath}`;

  return {
    url,
    scoresUrl,
    port,
    getReceivedScores: () => [...received],
    lastScore: () => (received.length ? received[received.length - 1] : null),
    reset: () => {
      received.length = 0;
    },
    failNext: (status = 500) => {
      oneShotFailStatus = status;
    },
    setResponseStatus: (status: number) => {
      stickyStatus = status;
    },
    waitForScore: (count = 1, timeoutMs = 30_000) =>
      new Promise<ReceivedScore[]>((resolve, reject) => {
        if (received.length >= count) {
          resolve([...received]);
          return;
        }
        const timer = setTimeout(() => {
          const index = waiters.findIndex((w) => w.timer === timer);
          if (index >= 0) {
            waiters.splice(index, 1);
          }
          reject(
            new Error(
              `Mock LMS did not receive ${count} passback(s) within ${timeoutMs}ms (got ${received.length}).`,
            ),
          );
        }, timeoutMs);
        waiters.push({ count, resolve, timer });
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
        }
        waiters.length = 0;
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/**
 * The fixed mock-LMS scores URL the api's `GRADING_LTI_GATEWAY_URL` should point
 * at in the e2e env (so the api process, started before tests, sends passbacks
 * to a port the mock will later bind). Built from `MOCK_LMS_PORT` (default 4567)
 * so test + env agree without hard-coding the number in two places.
 */
export const MOCK_LMS_URL = `http://127.0.0.1:${
  process.env.MOCK_LMS_PORT ?? DEFAULT_MOCK_LMS_PORT
}${DEFAULT_SCORES_PATH}`;

/**
 * True when the api was booted with `GRADING_LTI_GATEWAY_URL` pointed at the
 * mock. The full round-trip passback spec gates on this; until the Integrate
 * phase wires the env var, it stays `test.fixme` rather than failing.
 */
export function isPassbackWiredToMock(): boolean {
  const url = process.env.GRADING_LTI_GATEWAY_URL;
  return (
    typeof url === "string" &&
    url.includes(`:${process.env.MOCK_LMS_PORT ?? DEFAULT_MOCK_LMS_PORT}`)
  );
}
