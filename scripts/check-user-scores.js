#!/usr/bin/env node
/**
 * Read-only inspection of ALL of one learner's attempts/scores across every
 * assignment they've touched. Companion to check-submissions.js, which is
 * scoped to a single assignment; this one is scoped to a single user.
 *
 * Shows every AssignmentAttempt for the user, grouped by assignment, with the
 * attempt grade, submitted flag, and per-question points total. Performs ZERO
 * writes (only findMany) — safe to run against production.
 *
 * Parameters come from env (so no PII is baked into the committed file):
 *   CHK_USER  required — the learner's userId (an email)
 *
 * Run it against a pod (the pod is the only place @prisma/client and
 * DATABASE_URL are both available):
 *   pod=$(kubectl get pods -o name | grep -m1 mark-api | cut -d/ -f2)
 *   kubectl exec -i "$pod" -c mark-api -- env \
 *     NODE_PATH=/usr/src/app/node_modules \
 *     CHK_USER="x@y.com" node < scripts/check-user-scores.js
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  const userId = process.env.CHK_USER;
  if (!userId) {
    console.error("CHK_USER (email) is required");
    process.exit(1);
  }

  console.log(`Scores lookup — user=${userId}`);
  console.log("Read-only. No rows will be modified.\n");

  try {
    const attempts = await prisma.assignmentAttempt.findMany({
      where: { userId },
      orderBy: [{ assignmentId: "asc" }, { createdAt: "asc" }],
      include: {
        questionResponses: {
          select: { points: true, gradedAt: true },
        },
        gradingProgress: {
          select: { status: true },
        },
      },
    });

    if (attempts.length === 0) {
      console.log("No attempts exist for this user on any assignment.");
      return;
    }

    // No direct assignment relation on AssignmentAttempt — resolve names by id.
    const assignmentIds = [...new Set(attempts.map((a) => a.assignmentId))];
    const assignments = await prisma.assignment.findMany({
      where: { id: { in: assignmentIds } },
      select: { id: true, name: true, type: true, graded: true },
    });
    const nameById = new Map(assignments.map((x) => [x.id, x]));

    console.log(`── Attempts across all assignments (${attempts.length}) ──`);
    console.table(
      attempts.map((a) => ({
        assignmentId: a.assignmentId,
        assignment: (nameById.get(a.assignmentId)?.name ?? "").slice(0, 40),
        graded: nameById.get(a.assignmentId)?.graded ?? null,
        attemptId: a.id,
        submitted: a.submitted,
        grade: a.grade,
        pointsSum: a.questionResponses.reduce(
          (s, r) => s + (r.points ?? 0),
          0,
        ),
        questions: a.questionResponses.length,
        gradedQ: a.questionResponses.filter((r) => r.gradedAt).length,
        gradingStatus: a.gradingProgress?.status ?? null,
        createdAt: a.createdAt?.toISOString(),
      })),
    );

    // Per-assignment best grade summary, ignoring un-submitted attempts.
    const byAssignment = new Map();
    for (const a of attempts) {
      if (!a.submitted) continue;
      const cur = byAssignment.get(a.assignmentId);
      if (cur == null || (a.grade ?? -Infinity) > (cur.grade ?? -Infinity)) {
        byAssignment.set(a.assignmentId, {
          assignmentId: a.assignmentId,
          assignment: (nameById.get(a.assignmentId)?.name ?? "").slice(0, 40),
          bestGrade: a.grade,
          attempts: attempts.filter(
            (x) => x.assignmentId === a.assignmentId && x.submitted,
          ).length,
        });
      }
    }

    console.log(
      `\n── Best submitted grade per assignment (${byAssignment.size}) ──`,
    );
    if (byAssignment.size === 0) {
      console.log("No submitted attempts — nothing was graded.");
    } else {
      console.table([...byAssignment.values()]);
    }
  } finally {
    await prisma.$disconnect();
  }
})();
