#!/usr/bin/env node
/**
 * Read-only inspection of a learner's attempts/submissions for one assignment.
 *
 * "Course id" / "quiz id" in support requests is the Assignment.id. This shows
 * every AssignmentAttempt that user has on that assignment, with per-question
 * points, grading status, and a short response preview. Performs ZERO writes
 * (only findUnique/findMany) — safe to run against production.
 *
 * If the exact email has no attempt, it falls back to listing other userIds
 * that DID attempt this same assignment and whose address matches the email's
 * local-part (case-insensitive) — this is the usual "wrong/typo'd email" case.
 *
 * Parameters come from env (so no PII is baked into the committed file):
 *   CHK_USER        required — the learner's userId (an email)
 *   CHK_ASSIGNMENT  required — the assignmentId ("course"/"quiz" id)
 *
 * Prefer the wrapper, which handles pod selection:
 *   ./scripts/check-submissions.sh <email> <assignmentId>
 *
 * Or run it by hand against a pod:
 *   pod=$(kubectl get pods -o name | grep -m1 mark-api | cut -d/ -f2)
 *   kubectl exec -i "$pod" -c mark-api -- env \
 *     NODE_PATH=/usr/src/app/node_modules \
 *     CHK_USER="x@y.com" CHK_ASSIGNMENT=3337 node < scripts/check-submissions.js
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Cap on how many "did you mean" matches we list when there's no exact hit.
const MAX_NEARBY = 25;

/**
 * Decode the LMS destination host from an LTI auth-cookie JWT, so a sync can be
 * tied to where the grade was actually pushed. Only the host is ever surfaced —
 * never the cookie/JWT itself.
 */
function decodeLtiDestination(jwt) {
  try {
    const parts = (jwt || "").split(".");
    if (parts.length < 2) return "unknown";
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    const url =
      (payload.grading && payload.grading.lis_outcome_service_url) ||
      payload.lis_outcome_service_url ||
      "";
    try {
      return new URL(url).host;
    } catch {
      return url || "unknown";
    }
  } catch {
    return "decode-failed";
  }
}

(async () => {
  const userId = process.env.CHK_USER;
  const assignmentId = Number(process.env.CHK_ASSIGNMENT);
  if (!userId || !Number.isFinite(assignmentId)) {
    console.error(
      "CHK_USER (email) and CHK_ASSIGNMENT (assignmentId) are required",
    );
    process.exit(1);
  }

  console.log(`Submissions lookup — user=${userId} assignment=${assignmentId}`);
  console.log("Read-only. No rows will be modified.\n");

  try {
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        name: true,
        type: true,
        graded: true,
        published: true,
        numAttempts: true,
      },
    });
    if (!assignment) {
      console.log(`── No assignment with id=${assignmentId} ──`);
      return;
    }
    console.log("── Assignment ──");
    console.table([assignment]);

    const attempts = await prisma.assignmentAttempt.findMany({
      where: { assignmentId, userId },
      orderBy: { createdAt: "asc" },
      include: {
        questionResponses: {
          select: {
            questionId: true,
            points: true,
            gradedAt: true,
            learnerResponse: true,
          },
          orderBy: { questionId: "asc" },
        },
        gradingProgress: {
          select: {
            status: true,
            progress: true,
            error: true,
            completedAt: true,
          },
        },
      },
    });

    console.log(`\n── Attempts for this user (${attempts.length}) ──`);

    if (attempts.length === 0) {
      console.log("No attempts exist for this user on this assignment.\n");
      await suggestNearby(userId, assignmentId);
      return;
    }

    console.table(
      attempts.map((a) => ({
        attemptId: a.id,
        submitted: a.submitted,
        grade: a.grade,
        responses: a.questionResponses.length,
        graded: a.questionResponses.filter((r) => r.gradedAt).length,
        gradingStatus: a.gradingProgress?.status ?? null,
        gradingError: a.gradingProgress?.error ?? null,
        createdAt: a.createdAt?.toISOString(),
        expiresAt: a.expiresAt?.toISOString() ?? null,
      })),
    );

    await printLtiSync(userId, assignmentId);

    for (const a of attempts) {
      console.log(`\n── Attempt ${a.id} — responses ──`);
      console.table(
        a.questionResponses.map((r) => ({
          questionId: r.questionId,
          points: r.points,
          gradedAt: r.gradedAt?.toISOString() ?? null,
          respLen: (r.learnerResponse ?? "").length,
          preview: (r.learnerResponse ?? "").replace(/\s+/g, " ").slice(0, 80),
        })),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
})();

/**
 * Show the LTI grade-sync status for this user/assignment — whether the grade
 * was pushed back to the LMS (Canvas, etc.), and any retry/error history.
 * NEVER selects authCookie (it holds the LTI auth JWT). For any non-SUCCESS
 * sync, the most recent error-log rows are printed too.
 */
async function printLtiSync(userId, assignmentId) {
  const syncs = await prisma.ltiGradeSync.findMany({
    where: { userId, assignmentId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      attemptId: true,
      status: true,
      grade: true,
      retryCount: true,
      maxRetries: true,
      createdAt: true,
      lastAttemptAt: true,
      nextRetryAt: true,
      completedAt: true,
      lastError: true,
      learnerNotified: true,
      authCookie: true, // decoded to a host only; never printed raw
      errorLogs: {
        orderBy: { timestamp: "desc" },
        take: 3,
        select: {
          attemptNumber: true,
          httpStatus: true,
          errorMessage: true,
          timestamp: true,
        },
      },
    },
  });

  console.log(`\n── LTI grade sync (${syncs.length}) ──`);
  if (syncs.length === 0) {
    console.log(
      "No LtiGradeSync row exists for this user/assignment — the grade was\n" +
        "never enqueued for sync (e.g. the assignment isn't LTI-linked, or the\n" +
        "attempt predates sync). Nothing was pushed back to the LMS.",
    );
    return;
  }

  console.table(
    syncs.map((s) => ({
      syncId: s.id,
      attemptId: s.attemptId,
      status: s.status,
      grade: s.grade,
      retries: `${s.retryCount}/${s.maxRetries}`,
      destination: decodeLtiDestination(s.authCookie),
      notified: s.learnerNotified,
      createdAt: s.createdAt?.toISOString(),
      completedAt: s.completedAt?.toISOString() ?? null,
      nextRetryAt: s.nextRetryAt?.toISOString() ?? null,
      lastError: s.lastError ? s.lastError.slice(0, 60) : null,
    })),
  );

  for (const s of syncs) {
    if (s.status === "SUCCESS" || s.errorLogs.length === 0) continue;
    console.log(`\n   sync ${s.id} — recent errors (${s.status}) ──`);
    console.table(
      s.errorLogs.map((e) => ({
        attempt: e.attemptNumber,
        httpStatus: e.httpStatus,
        error: (e.errorMessage ?? "").slice(0, 80),
        timestamp: e.timestamp?.toISOString(),
      })),
    );
  }
}

/**
 * When the exact email has no attempt, list other learners who DID attempt this
 * assignment and whose userId matches the email's local-part. Scoped to the
 * assignment so the blast radius stays small (only people who took this quiz).
 */
async function suggestNearby(userId, assignmentId) {
  const localPart = String(userId).split("@")[0];
  if (!localPart) return;

  const nearby = await prisma.assignmentAttempt.findMany({
    where: {
      assignmentId,
      userId: { contains: localPart, mode: "insensitive" },
    },
    select: { userId: true, submitted: true, grade: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: MAX_NEARBY,
  });

  if (nearby.length === 0) {
    console.log(
      `No nearby userIds (matching "${localPart}") attempted this assignment either.\n` +
        "→ This account never started this assignment. Confirm the correct email.",
    );
    return;
  }

  console.log(
    `── Did you mean? userIds matching "${localPart}" with an attempt on this ` +
      `assignment (showing up to ${MAX_NEARBY}) ──`,
  );
  console.table(
    nearby.map((a) => ({
      userId: a.userId,
      submitted: a.submitted,
      grade: a.grade,
      createdAt: a.createdAt?.toISOString(),
    })),
  );
}
