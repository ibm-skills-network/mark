/**
 * LTI grade passback (AGS) round-trip.
 *
 * The product path (verified in apps/api/.../attempt-submission.service.ts +
 * lti-grade-sync.service.ts):
 *   learner submits an objective attempt with a launch session that has
 *   `gradingCallbackRequired:true`  →  grading completes in-process  →
 *   LtiGradeSyncService PUTs { score } (grade in 0..1) to
 *   GRADING_LTI_GATEWAY_URL with header Cookie: authentication=<launch JWT>  →
 *   HTTP 200 ⇒ status SUCCESS.
 *
 * THE WIRING CONSTRAINT (why the round-trip is test.fixme today):
 *   `GRADING_LTI_GATEWAY_URL` is read by the api at BOOT, from the process
 *   Playwright's `webServer` starts BEFORE any test runs. The mock LMS, by
 *   contrast, is started inside the test runner process at runtime. A running
 *   api process cannot have its env re-pointed at the mock from a test. So the
 *   full round-trip only works once the env var is pre-pointed at the mock's
 *   FIXED port (default 4567 / MOCK_LMS_PORT) — see `MOCK_LMS_URL`. When the
 *   `tests/lti` project is wired into playwright.config, the api's e2e env must
 *   also set:
 *       GRADING_LTI_GATEWAY_URL=http://127.0.0.1:4567/lineitems/e2e/scores
 *   Until then `isPassbackWiredToMock()` is false and the round-trip test is
 *   skipped via test.fixme rather than failing.
 *
 * What DOES run unconditionally here: a contract test for the mock LMS itself —
 * it proves the mock records a passback's score, user identity (decoded from the
 * forwarded `authentication` cookie), and lineitem path exactly as the api would
 * send them. That guards the mock without depending on the env wiring.
 */
import { expect, request, test } from "@playwright/test";
import {
  createApiContext,
  getTestEnvironmentConfig,
} from "../helpers/assignment-helpers";
import { createSeededAssignment } from "../helpers/seed";
import { singleCorrect } from "../helpers/factories/question-factories";
import {
  isPassbackWiredToMock,
  mintLtiLaunchToken,
  startMockLms,
  type MockLms,
} from "../helpers/lti/mock-lti";

const LEARNER_EMAIL = "learner@example.com";

test.describe("LTI - mock LMS contract (unconditional)", () => {
  let lms: MockLms;

  test.beforeAll(async () => {
    lms = await startMockLms();
  });
  test.afterAll(async () => {
    await lms.stop();
  });
  test.beforeEach(() => {
    lms.reset();
    lms.setResponseStatus(200);
  });

  test("records a passback: score, user (from cookie), and lineitem path", async () => {
    // Simulate exactly what LtiGradeSyncService.attemptSync does: PUT { score }
    // with the learner's launch JWT in the authentication cookie.
    const { token } = mintLtiLaunchToken({
      userId: LEARNER_EMAIL,
      role: "learner",
      assignmentId: 123,
      gradingCallbackRequired: true,
    });

    const apiLikeContext = await createApiContext();
    try {
      const response = await apiLikeContext.put(lms.scoresUrl, {
        headers: { Cookie: `authentication=${token}` }, // pragma: allowlist secret
        data: { score: 1 },
      });
      expect(response.ok()).toBe(true);
    } finally {
      await apiLikeContext.dispose();
    }

    const [passback] = await lms.waitForScore(1, 10_000);
    expect(passback.method).toBe("PUT");
    expect(passback.path).toContain("/lineitems/");
    expect(passback.score).toBe(1);
    expect(passback.userId).toBe(LEARNER_EMAIL);
    expect(passback.authCookie).toBe(token);
  });

  test("failNext() drives the retry path (non-200 then recover)", async () => {
    lms.failNext(503);

    const { token } = mintLtiLaunchToken({
      userId: LEARNER_EMAIL,
      role: "learner",
      gradingCallbackRequired: true,
    });

    const apiLikeContext = await createApiContext();
    try {
      const failed = await apiLikeContext.put(lms.scoresUrl, {
        headers: { Cookie: `authentication=${token}` }, // pragma: allowlist secret
        data: { score: 0.5 },
      });
      expect(failed.status()).toBe(503);

      // The api would schedule a retry; the next attempt succeeds.
      const ok = await apiLikeContext.put(lms.scoresUrl, {
        headers: { Cookie: `authentication=${token}` }, // pragma: allowlist secret
        data: { score: 0.5 },
      });
      expect(ok.ok()).toBe(true);
    } finally {
      await apiLikeContext.dispose();
    }

    const scores = await lms.waitForScore(2, 10_000);
    expect(scores).toHaveLength(2);
    expect(scores.every((s) => s.score === 0.5)).toBe(true);
  });
});

test.describe("LTI - grade passback round-trip (real api → mock LMS)", () => {
  let lms: MockLms;

  test.beforeAll(async () => {
    lms = await startMockLms();
  });
  test.afterAll(async () => {
    await lms?.stop();
  });

  // TODO: un-fixme once the api's e2e env sets
  //   GRADING_LTI_GATEWAY_URL=http://127.0.0.1:4567/lineitems/e2e/scores
  // (the mock LMS fixed port). Until then the api PUTs grades to whatever URL it
  // was booted with — not this in-test mock — so the round-trip cannot be
  // observed here. `isPassbackWiredToMock()` reflects that env state and keeps
  // the test skipped (rather than failing) until the env var is wired.
  test.fixme(
    !isPassbackWiredToMock(),
    "Pending: api GRADING_LTI_GATEWAY_URL must point at the fixed mock LMS port.",
  );

  test("submitting an objective attempt under an LTI launch passes the grade back", async () => {
    lms.reset();
    lms.setResponseStatus(200);

    const config = getTestEnvironmentConfig();

    // The passback only fires when the SUBMIT carries gradingCallbackRequired:true
    // (from the launch JWT) AND the authentication cookie (forwarded to the api).
    // The gateway provides BOTH: its cookie auth guard reads the launch JWT into
    // request.user and forwards `user-session: JSON.stringify(request.user)` +
    // the original cookie. So we drive create+submit THROUGH THE GATEWAY with the
    // LTI launch cookie — the realistic path — rather than direct-to-api (which
    // would carry neither claim nor cookie).
    const { token } = mintLtiLaunchToken({
      userId: LEARNER_EMAIL,
      role: "learner",
      gradingCallbackRequired: true,
    });

    // Admin-context (direct to api) to seed the assignment.
    const adminCtx = await createApiContext();
    // Learner-context THROUGH THE GATEWAY, authenticated by the launch cookie.
    const gatewayCtx = await request.newContext({
      baseURL: config.gatewayBaseUrl,
      extraHTTPHeaders: { Cookie: `authentication=${token}` }, // pragma: allowlist secret
    });

    try {
      const assignment = await createSeededAssignment(adminCtx, {
        questions: [
          singleCorrect({
            prompt: "What is 2 + 2?",
            choices: ["3", "4", "5"],
            correctIndex: 1,
            points: 10,
          }),
        ],
        name: `LTI passback ${Date.now()}`,
      });

      // Create the attempt (gateway injects user-session from the launch JWT).
      const createRes = await gatewayCtx.post(
        `/api/v2/assignments/${assignment.id}/attempts`,
      );
      expect(createRes.ok()).toBe(true);
      const { id: attemptId } = (await createRes.json()) as { id: number };

      // Read the attempt to get the real question id.
      const attemptRes = await gatewayCtx.get(
        `/api/v2/assignments/${assignment.id}/attempts/${attemptId}?lang=en`,
      );
      const attemptBody = (await attemptRes.json()) as {
        questions: { id: number; question: string }[];
      };
      const question = attemptBody.questions[0];

      // Submit the perfect objective answer. Grading settles in-process and the
      // api fires the LTI passback because gradingCallbackRequired:true rode in
      // on the launch JWT.
      const submitRes = await gatewayCtx.patch(
        `/api/v2/assignments/${assignment.id}/attempts/${attemptId}`,
        {
          data: {
            submitted: true,
            language: "en",
            responsesForQuestions: [
              {
                id: question.id,
                question: question.question,
                learnerChoices: ["4"],
              },
            ],
          },
        },
      );
      expect(submitRes.ok()).toBe(true);

      // The passback is async relative to the submit response. Wait on the mock
      // instead of a fixed sleep.
      const [passback] = await lms.waitForScore(1, 30_000);
      expect(passback.score).toBe(1); // perfect objective answer ⇒ 1.0
      expect(passback.userId).toBe(LEARNER_EMAIL);
      expect(passback.authCookie).toBe(token);
    } finally {
      await gatewayCtx.dispose();
      await adminCtx.dispose();
    }
  });
});
