/**
 * Authorization (API-level) — real auth at the GATEWAY.
 *
 * These are request-level tests: they target the GATEWAY base url
 * (`gatewayBaseUrl`), NOT the mark api directly, because the gateway is where the
 * real cookie-JWT auth guard runs (`DynamicJwtCookieAuthGuard` -> passport
 * `cookie-strategy`, `ignoreExpiration:false`, dev secret "devsecret"). The
 * gateway then forwards the request — injecting the derived `user-session`
 * header — to the api, whose GLOBAL `RolesGlobalGuard` and route-scoped
 * `AssignmentAccessControlGuard` enforce role + group/tenancy.
 *
 * Guard ordering matters and drives the expected status codes:
 *   - Gateway cookie guard: missing / expired / forged cookie -> 401 (request
 *     never reaches the api).
 *   - api RolesGlobalGuard (GLOBAL, runs first): wrong role for the route ->
 *     returns false -> Nest 403.
 *   - api AssignmentAccessControlGuard (route-scoped, runs after roles pass):
 *     assignment exists but not linked to the caller's group -> 403
 *     ("Access denied to this assignment"); assignment does not exist -> 404.
 *
 * Endpoints chosen for stability (read straight off the v2 assignment
 * controller):
 *   - GET   /api/v2/assignments/:id        @Roles(AUTHOR, LEARNER) + AccessGuard
 *   - PATCH /api/v2/assignments/:id        @Roles(AUTHOR)          + AccessGuard
 *   - GET   /api/v2/assignments/:id/files  @Roles(AUTHOR)          + AccessGuard
 *
 * The gateway/api global prefix is "api" with URI versioning, so a client path
 * is `/api/v2/assignments/:id` (the gateway forwards `originalUrl` verbatim to
 * the mark api, which shares the same prefix + version).
 *
 * Auth is attached per-request via the `Cookie` header (the gateway reads
 * `request.cookies.authentication` through cookie-parser), minted with the
 * shared `mintAuthToken` helper so we can vary identity, expiry, and signing
 * secret independently for the negative cases.
 *
 * No browser, no project storageState: each test mints exactly the cookie it
 * needs. The Integrate phase registers an API-only Playwright project for this
 * directory.
 */
import {
  type APIRequestContext,
  expect,
  request,
  test,
} from "@playwright/test";
import {
  getTestEnvironmentConfig,
  type TestEnvironmentConfig,
} from "../helpers/assignment-helpers";
import { mintAuthToken, negativeAuth } from "../helpers/auth";
import { singleCorrect } from "../helpers/factories/question-factories";
import {
  createSeededAssignment,
  deleteSeededAssignment,
} from "../helpers/seed";

const AUTHOR_EMAIL = "author@example.com";
const LEARNER_EMAIL = "learner@example.com";

/** A group the known author identity is NOT a member of (for tenancy tests). */
const FOREIGN_GROUP_ID = "pw-group-foreign";

/** An assignment id that does not exist — for the 404 / no-leakage path. */
const NONEXISTENT_ASSIGNMENT_ID = 999_000_111;

const config: TestEnvironmentConfig = getTestEnvironmentConfig();

/** A single objective question is enough to stand up an attemptable assignment. */
function seedQuestions() {
  return [
    singleCorrect({
      prompt: "What is 2 + 2?",
      choices: ["3", "4", "5"],
      correctIndex: 1,
    }),
  ];
}

/**
 * Build the `Cookie` request header carrying a freshly-minted `authentication`
 * JWT for the given identity. The gateway extracts it via cookie-parser.
 */
function authCookieHeader(
  options: Parameters<typeof mintAuthToken>[0],
): Record<string, string> {
  const { token } = mintAuthToken({ config, ...options });
  return { Cookie: `authentication=${token}` };
}

/** Pull the `authentication` value out of a minted storageState cookie. */
function cookieHeaderFromStorageState(state: {
  cookies: Array<{ name: string; value: string }>;
}): Record<string, string> {
  const cookie = state.cookies.find((entry) => entry.name === "authentication");
  if (!cookie) {
    throw new Error(
      "Expected an `authentication` cookie in the storage state.",
    );
  }
  return { Cookie: `authentication=${cookie.value}` };
}

/**
 * Assert that an error body does NOT leak which field failed, whether a record
 * exists, or any internal detail. The api throws generic messages
 * ("Access denied to this assignment", "Assignment not found", default Nest
 * Forbidden/Unauthorized) — none of which should echo the caller's input,
 * stack frames, SQL, or prisma internals.
 */
async function expectGenericErrorBody(
  response: { text(): Promise<string> },
  forbiddenSubstrings: string[],
): Promise<void> {
  const raw = (await response.text()).toLowerCase();
  for (const needle of forbiddenSubstrings) {
    expect(
      raw.includes(needle.toLowerCase()),
      `error body unexpectedly leaked "${needle}": ${raw}`,
    ).toBe(false);
  }
  // Never surface a stack trace or prisma/SQL internals to a hostile frontend.
  for (const leak of ["at ", "prisma", "select ", "stack", "node_modules"]) {
    expect(
      raw.includes(leak),
      `error body unexpectedly leaked internal detail "${leak}": ${raw}`,
    ).toBe(false);
  }
}

test.describe("Authz - assignment access (real gateway auth)", () => {
  let gateway: APIRequestContext;
  let api: APIRequestContext;

  // Assignment in the author's OWN group (pw-group) — the positive control.
  let ownAssignmentId: number;
  // Assignment in a FOREIGN group the author is not a member of — for tenancy.
  let foreignAssignmentId: number;

  test.beforeAll(async () => {
    gateway = await request.newContext({ baseURL: config.gatewayBaseUrl });
    // Direct-to-api context is used ONLY for seeding/teardown, never for the
    // assertions (those all go through the gateway so the real guard runs).
    api = await request.newContext({ baseURL: config.markApiBaseUrl });

    const own = await createSeededAssignment(api, {
      questions: seedQuestions(),
      name: `Authz Own-Group ${Date.now()}`,
      groupId: config.groupId,
    });
    ownAssignmentId = own.id;

    const foreign = await createSeededAssignment(api, {
      questions: seedQuestions(),
      name: `Authz Foreign-Group ${Date.now()}`,
      groupId: FOREIGN_GROUP_ID,
    });
    foreignAssignmentId = foreign.id;
  });

  test.afterAll(async () => {
    if (ownAssignmentId) {
      await deleteSeededAssignment(api, ownAssignmentId, config);
    }
    if (foreignAssignmentId) {
      await deleteSeededAssignment(api, foreignAssignmentId, config);
    }
    await api.dispose();
    await gateway.dispose();
  });

  // -- Positive control -------------------------------------------------------

  test("author with a valid cookie can read an assignment in their own group", async () => {
    const response = await gateway.get(
      `/api/v2/assignments/${ownAssignmentId}`,
      {
        headers: authCookieHeader({
          userId: AUTHOR_EMAIL,
          role: "author",
          groupId: config.groupId,
          assignmentId: ownAssignmentId,
        }),
      },
    );

    expect(
      response.ok(),
      `expected 2xx for own-group author read, got ${response.status()}`,
    ).toBe(true);
    const body = (await response.json()) as { id?: number };
    expect(body.id).toBe(ownAssignmentId);
  });

  // -- (1) Wrong role: learner cookie -> author-only route -> 403 -------------

  test("a learner cookie hitting an author-only route (PATCH assignment) is forbidden (403)", async () => {
    // PATCH /v2/assignments/:id is @Roles(AUTHOR). The GLOBAL RolesGlobalGuard
    // runs first and rejects a learner regardless of group membership.
    const response = await gateway.patch(
      `/api/v2/assignments/${ownAssignmentId}`,
      {
        headers: authCookieHeader({
          userId: LEARNER_EMAIL,
          role: "learner",
          groupId: config.groupId,
          assignmentId: ownAssignmentId,
        }),
        data: { name: "hostile-rename-attempt" },
      },
    );

    expect(response.status()).toBe(403);
    // Generic: must not echo the attempted new name or reveal the role rule.
    await expectGenericErrorBody(response, [
      "hostile-rename-attempt",
      "author",
      "role",
    ]);
  });

  test("a learner cookie hitting an author-only route (GET assignment files) is forbidden (403)", async () => {
    // GET /v2/assignments/:id/files is @Roles(AUTHOR) — a second author-only
    // surface, to prove the role gate isn't specific to the write path.
    const response = await gateway.get(
      `/api/v2/assignments/${ownAssignmentId}/files`,
      {
        headers: authCookieHeader({
          userId: LEARNER_EMAIL,
          role: "learner",
          groupId: config.groupId,
          assignmentId: ownAssignmentId,
        }),
      },
    );

    expect(response.status()).toBe(403);
    await expectGenericErrorBody(response, ["author", "role", "files"]);
  });

  // -- (2) Tenancy: author in group A -> assignment in group B -> 403/404 -----

  test("an author cannot read an assignment outside their group (tenancy, 403 or 404)", async () => {
    // Author's cookie carries pw-group; the assignment is linked only to the
    // foreign group. RolesGlobalGuard passes (author may GET), then
    // AssignmentAccessControlGuard finds no group link -> ForbiddenException.
    const response = await gateway.get(
      `/api/v2/assignments/${foreignAssignmentId}`,
      {
        headers: authCookieHeader({
          userId: AUTHOR_EMAIL,
          role: "author",
          groupId: config.groupId,
          assignmentId: foreignAssignmentId,
        }),
      },
    );

    // Either 403 (exists, no group link) or 404 (treated as not found) is an
    // acceptable non-leaking tenancy denial — never 200.
    expect([403, 404]).toContain(response.status());
    // The denial must NOT reveal the foreign group id or the assignment name.
    await expectGenericErrorBody(response, [
      FOREIGN_GROUP_ID,
      "authz foreign-group",
    ]);
  });

  test("a tenancy denial is indistinguishable from a missing assignment (no record-existence leak)", async () => {
    // A request for an assignment that does NOT exist should look the same to a
    // hostile frontend as a forbidden one: a generic 4xx with no body that
    // confirms existence. This guards against tenant-enumeration.
    const missingResponse = await gateway.get(
      `/api/v2/assignments/${NONEXISTENT_ASSIGNMENT_ID}`,
      {
        headers: authCookieHeader({
          userId: AUTHOR_EMAIL,
          role: "author",
          groupId: config.groupId,
          assignmentId: NONEXISTENT_ASSIGNMENT_ID,
        }),
      },
    );

    expect([403, 404]).toContain(missingResponse.status());
    await expectGenericErrorBody(missingResponse, [
      String(NONEXISTENT_ASSIGNMENT_ID),
    ]);
  });

  // -- (3) No cookie -> 401 ---------------------------------------------------

  test("a request with NO authentication cookie is unauthorized (401)", async () => {
    const response = await gateway.get(
      `/api/v2/assignments/${ownAssignmentId}`,
      {
        // No Cookie header at all.
      },
    );

    expect(response.status()).toBe(401);
    await expectGenericErrorBody(response, [
      String(ownAssignmentId),
      "secret",
      "jwt",
    ]);
  });

  // -- (4) Expired cookie -> 401 ---------------------------------------------

  test("a correctly-signed but EXPIRED cookie is unauthorized (401)", async () => {
    // negativeAuth.expired mints a valid-signature token with exp in the past.
    // The gateway strategy sets ignoreExpiration:false, so it rejects with 401.
    const state = negativeAuth.expired({
      userId: AUTHOR_EMAIL,
      role: "author",
      groupId: config.groupId,
      assignmentId: ownAssignmentId,
      config,
    });

    const response = await gateway.get(
      `/api/v2/assignments/${ownAssignmentId}`,
      { headers: cookieHeaderFromStorageState(state) },
    );

    expect(response.status()).toBe(401);
    await expectGenericErrorBody(response, ["expired", "exp", "secret"]);
  });

  // -- (5) Forged cookie (wrong secret) -> 401 -------------------------------

  test("a FORGED cookie signed with the wrong secret is unauthorized (401)", async () => {
    // negativeAuth.forged signs with a secret the gateway does not trust, so
    // signature verification fails -> 401. This is the core "hostile frontend
    // cannot self-mint a session" guarantee.
    const state = negativeAuth.forged({
      userId: AUTHOR_EMAIL,
      role: "author",
      groupId: config.groupId,
      assignmentId: ownAssignmentId,
      config,
    });

    const response = await gateway.get(
      `/api/v2/assignments/${ownAssignmentId}`,
      { headers: cookieHeaderFromStorageState(state) },
    );

    expect(response.status()).toBe(401);
    await expectGenericErrorBody(response, ["signature", "secret", "forged"]);
  });

  test("a forged cookie cannot escalate to an author-only write route either (401, not 403)", async () => {
    // Belt-and-suspenders: forged auth must be rejected at the gateway BEFORE
    // the role guard ever sees it — so a write attempt is 401 (bad signature),
    // never 403 (which would imply the cookie was accepted as a valid session).
    const state = negativeAuth.forged({
      userId: AUTHOR_EMAIL,
      role: "author",
      groupId: config.groupId,
      assignmentId: ownAssignmentId,
      config,
    });

    const response = await gateway.patch(
      `/api/v2/assignments/${ownAssignmentId}`,
      {
        headers: {
          ...cookieHeaderFromStorageState(state),
        },
        data: { name: "forged-write-attempt" },
      },
    );

    expect(response.status()).toBe(401);
    await expectGenericErrorBody(response, ["forged-write-attempt", "secret"]);
  });
});
