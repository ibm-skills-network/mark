#!/usr/bin/env node
/**
 * Read-only export of recent notebooks with their current assignment rubrics.
 * Run in a deployed mark-api pod with NODE_PATH=/usr/src/app/node_modules.
 * BENCH_ASSIGNMENTS: comma-separated assignment IDs (required).
 * BENCH_SOURCE: staging or production label (required).
 * BENCH_PER_ASSIGNMENT: number of submissions to download (default 2).
 * Redirect stdout to a private JSON file outside the repository.
 *
 * kubectl -n mark exec -i deploy/mark-api -c mark-api -- env \
 *   NODE_PATH=/usr/src/app/node_modules BENCH_SOURCE=staging \
 *   BENCH_ASSIGNMENTS=123,456 node < scripts/export-notebook-benchmark.js > /tmp/samples.json
 *
 * Only reads database rows and storage objects. Learner identifiers and
 * storage keys are not exported; notebook contents may contain personal data.
 */
const { PrismaClient } = require("@prisma/client");
const { S3Service } = require("./dist/api/files/services/s3.service");
const assignments = (process.env.BENCH_ASSIGNMENTS || "")
  .split(",")
  .map(Number);
const perAssignment = Number(process.env.BENCH_PER_ASSIGNMENT || 2);
if (
  !process.env.BENCH_SOURCE ||
  assignments.some((id) => !Number.isInteger(id) || id < 1) ||
  !Number.isInteger(perAssignment) ||
  perAssignment < 1
) {
  throw new Error(
    "Provide BENCH_SOURCE, positive BENCH_ASSIGNMENTS IDs, and a positive sample count",
  );
}
const prisma = new PrismaClient();
const storage = new S3Service();
(async () => {
  const features = await prisma.aIFeature.findMany({
    include: {
      assignments: {
        where: { isActive: true },
        orderBy: { priority: "desc" },
        take: 1,
        include: { model: true },
      },
    },
  });
  const models = Object.fromEntries(
    features.map((f) => [
      f.featureKey,
      f.assignments[0]?.model.modelKey || f.defaultModelKey,
    ]),
  );
  const samples = [];
  for (const assignmentId of assignments) {
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { name: true },
    });
    if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);
    const questions = await prisma.question.findMany({
      where: { assignmentId, isDeleted: false },
      orderBy: { id: "asc" },
    });
    let collected = 0;
    for (const q of questions) {
      const scoring =
        typeof q.scoring === "string" ? JSON.parse(q.scoring) : q.scoring;
      if (!scoring?.rubrics?.length) continue;
      // Use the questionId/assignmentAttemptId index, avoiding a substring
      // scan of the production response table or a sort by unindexed id.
      const rows = await prisma.questionResponse.findMany({
        where: { questionId: q.id },
        orderBy: { assignmentAttemptId: "desc" },
        take: Math.max(12, perAssignment),
        select: {
          id: true,
          assignmentAttemptId: true,
          learnerResponse: true,
          points: true,
        },
      });
      for (const row of rows) {
        let files;
        try {
          files = JSON.parse(row.learnerResponse);
        } catch {
          continue;
        }
        if (!Array.isArray(files)) continue;
        for (const file of files) {
          if (!file.filename?.toLowerCase().endsWith(".ipynb")) continue;
          try {
            const object = await storage.getObject({
              Bucket: file.bucket,
              Key: file.key,
            });
            const bytes = Buffer.from(await object.Body.transformToByteArray());
            const notebook = JSON.parse(bytes.toString());
            samples.push({
              id: row.id,
              attemptId: row.assignmentAttemptId,
              questionId: q.id,
              assignmentId,
              assignmentName: assignment.name,
              question: q.question,
              scoring,
              totalPoints: q.totalPoints,
              responseType: q.responseType,
              type: q.type,
              storedPoints: row.points,
              filename: file.filename,
              notebookBase64: bytes.toString("base64"),
              cells: notebook.cells?.length,
              images: notebook.cells
                ?.flatMap((cell) => cell.outputs || [])
                .filter(
                  (output) =>
                    output.data?.["image/png"] || output.data?.["image/jpeg"],
                ).length,
            });
            collected++;
          } catch (error) {
            console.error("Sample unavailable", row.id, error.name);
          }
          if (collected >= perAssignment) break;
        }
        if (collected >= perAssignment) break;
      }
      if (collected >= perAssignment) break;
    }
    console.error("Collected", assignmentId, collected);
  }
  console.log(
    JSON.stringify({ source: process.env.BENCH_SOURCE, models, samples }),
  );
})()
  .catch((error) => {
    console.error(error.name, error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
