/**
 * @jest-environment node
 */

import { resolveAttemptViewError } from "../attempt-error";

const ROUTE_ASSIGNMENT = 3532;

describe("resolveAttemptViewError", () => {
  it("keeps the real status instead of reporting every failure as a missing attempt", () => {
    expect(
      resolveAttemptViewError({
        status: 403,
        routeAssignmentId: ROUTE_ASSIGNMENT,
        sessionAssignmentId: ROUTE_ASSIGNMENT,
      }).statusCode,
    ).toBe(403);

    expect(
      resolveAttemptViewError({
        status: 500,
        routeAssignmentId: ROUTE_ASSIGNMENT,
        sessionAssignmentId: ROUTE_ASSIGNMENT,
      }).statusCode,
    ).toBe(500);
  });

  it("explains a replaced session rather than blaming the learner's account", () => {
    const resolved = resolveAttemptViewError({
      status: 403,
      routeAssignmentId: ROUTE_ASSIGNMENT,
      sessionAssignmentId: 3528,
    });

    expect(resolved.statusCode).toBe(403);
    expect(resolved.headline).toMatch(/another assignment/i);
    expect(resolved.message).toMatch(
      /reopen this assignment from your course/i,
    );
    expect(resolved.message).not.toMatch(/does not belong to your account/i);
  });

  it("sends a replaced session back to the course, not to a link that fails the same way", () => {
    const withReturnUrl = resolveAttemptViewError({
      status: 403,
      routeAssignmentId: ROUTE_ASSIGNMENT,
      sessionAssignmentId: 3528,
      returnUrl: "https://courses.example.test/course/1",
    });
    expect(withReturnUrl.primaryActionHref).toBe(
      "https://courses.example.test/course/1",
    );

    const withoutReturnUrl = resolveAttemptViewError({
      status: 403,
      routeAssignmentId: ROUTE_ASSIGNMENT,
      sessionAssignmentId: 3528,
    });
    expect(withoutReturnUrl.primaryActionHref).toBeUndefined();
  });

  it("treats an expired session as a sign-in problem, not a missing attempt", () => {
    const resolved = resolveAttemptViewError({
      status: 401,
      routeAssignmentId: ROUTE_ASSIGNMENT,
      sessionAssignmentId: ROUTE_ASSIGNMENT,
    });

    expect(resolved.statusCode).toBe(401);
    expect(resolved.headline).toMatch(/session/i);
  });

  it("still reports a genuinely missing attempt as missing when the session matches", () => {
    const resolved = resolveAttemptViewError({
      status: 404,
      routeAssignmentId: ROUTE_ASSIGNMENT,
      sessionAssignmentId: ROUTE_ASSIGNMENT,
    });

    expect(resolved.statusCode).toBe(404);
    expect(resolved.headline).toMatch(/not found/i);
    expect(resolved.primaryActionHref).toBe(`/learner/${ROUTE_ASSIGNMENT}`);
  });

  it.each([500, 502, 503, 504])(
    "does not blame a replaced session for a %s from the server",
    (status) => {
      // The session really was replaced, but the request failed on the server
      // side: telling the learner to reopen the assignment hides an outage and
      // sends them round a loop that cannot work.
      const resolved = resolveAttemptViewError({
        status,
        routeAssignmentId: ROUTE_ASSIGNMENT,
        sessionAssignmentId: 3528,
      });

      expect(resolved.statusCode).toBe(status);
      expect(resolved.headline).not.toMatch(/another assignment/i);
      expect(resolved.message).toMatch(/try again/i);
    },
  );

  it("does not claim a replaced session when the session assignment is unknown", () => {
    const resolved = resolveAttemptViewError({
      status: 403,
      routeAssignmentId: ROUTE_ASSIGNMENT,
    });

    expect(resolved.headline).not.toMatch(/another assignment/i);
  });
});

describe("resolveAttemptViewError — recovery steps", () => {
  it("tells a replaced session what actually happened", () => {
    const steps = resolveAttemptViewError({
      status: 403,
      routeAssignmentId: ROUTE_ASSIGNMENT,
      sessionAssignmentId: 3528,
    }).userSteps;

    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map((step) => step.title).join(" ")).toMatch(
      /reopen this assignment from your course/i,
    );
  });

  it("always offers at least one recovery step", () => {
    for (const status of [401, 403, 404, 500, 502]) {
      expect(
        resolveAttemptViewError({
          status,
          routeAssignmentId: ROUTE_ASSIGNMENT,
          sessionAssignmentId: ROUTE_ASSIGNMENT,
        }).userSteps.length,
      ).toBeGreaterThan(0);
    }
  });
});
