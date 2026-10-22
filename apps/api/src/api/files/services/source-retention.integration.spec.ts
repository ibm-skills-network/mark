import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AttemptSnapshotService } from "../../attempt/immutable/attempt-snapshot.service";
import { PrismaService } from "../../../database/prisma.service";
import { reserveSourceObjectDeletion } from "./source-retention";
const url = process.env.ATTEMPT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("original retention (real PostgreSQL)", () => {
  let prisma: PrismaClient;
  let snapshots: AttemptSnapshotService;
  beforeAll(() => {
    if (
      !url ||
      !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
      !new URL(url).pathname.endsWith("/mark_part03")
    )
      throw new Error("Use isolated localhost mark_part03 database");
    prisma = new PrismaClient({ datasources: { db: { url } } });
    snapshots = new AttemptSnapshotService(prisma as unknown as PrismaService);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  async function fixture() {
    const userId = `synthetic-${randomUUID()}`;
    const assignment = await prisma.assignment.create({
      data: {
        name: "Retention fixture",
        type: "AI_GRADED",
        published: true,
        questionOrder: [],
      },
    });
    const attempt = await prisma.assignmentAttempt.create({
      data: {
        assignmentId: assignment.id,
        userId,
        submitted: false,
        questionOrder: [],
      },
    });
    await prisma.attemptDefinition.create({
      data: {
        attemptId: attempt.id,
        snapshot: {
          schemaVersion: 1,
          assignmentVersionId: null,
          assignment: {
            name: "Retention",
            instructions: "",
            showAssignmentScore: true,
          },
          questions: [
            {
              id: 1,
              versionId: null,
              variantId: null,
              question: "Upload",
              type: "UPLOAD",
              totalPoints: 1,
              configuration: {},
              choices: [],
            },
          ],
        },
      },
    });
    await prisma.attemptDraft.create({
      data: { attemptId: attempt.id, answers: [] },
    });
    const upload = await prisma.fileUpload.create({
      data: {
        userId,
        uploadId: randomUUID(),
        storageKey: `synthetic/${randomUUID()}.pdf`,
        bucket: "local-only",
        uploadType: "learner",
        status: "COMPLETED",
      },
    });
    return { attempt, assignment, upload, userId };
  }
  const bind = (f: Awaited<ReturnType<typeof fixture>>) =>
    snapshots.bindSource(
      f.attempt.id,
      f.assignment.id,
      f.userId,
      f.upload.uploadId,
    );
  const reserve = (f: Awaited<ReturnType<typeof fixture>>) =>
    prisma.$transaction((tx) =>
      reserveSourceObjectDeletion(tx, f.upload.bucket, [f.upload.storageKey]),
    );
  it("a concurrent delete reservation and source binding cannot both win", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([bind(f), reserve(f)]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const source = await prisma.attemptSource.findUnique({
      where: { uploadId: f.upload.uploadId },
    });
    const deletion = await prisma.sourceObjectDeletion.findUnique({
      where: {
        bucket_storageKey: {
          bucket: f.upload.bucket,
          storageKey: f.upload.storageKey,
        },
      },
    });
    expect(Boolean(source)).not.toBe(Boolean(deletion));
  });
  it("deletion reservations remain authoritative for later bindings", async () => {
    const f = await fixture();
    await reserve(f);
    await reserve(f); // Idempotent reservation must not trigger immutable UPDATE.
    await expect(bind(f)).rejects.toMatchObject({ status: 409 });
  });
  it("retained originals block deletion and rollback earlier folder reservations", async () => {
    const f = await fixture();
    await bind(f);
    const earlier = `a-${randomUUID()}`;
    await expect(
      prisma.$transaction((tx) =>
        reserveSourceObjectDeletion(tx, f.upload.bucket, [
          earlier,
          f.upload.storageKey,
        ]),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await prisma.sourceObjectDeletion.findUnique({
        where: {
          bucket_storageKey: { bucket: f.upload.bucket, storageKey: earlier },
        },
      }),
    ).toBeNull();
  });
});
