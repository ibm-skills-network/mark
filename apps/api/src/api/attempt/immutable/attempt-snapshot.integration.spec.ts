import { AttemptSubmissionService } from "../services/attempt-submission.service";
import { QuestionResponseService } from "../services/question-response/question-response.service";
import { QuestionVariantService } from "../services/question-variant/question-variant.service";
import {
  UserRole,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
/* eslint-disable unicorn/no-null */
import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AttemptSnapshotService } from "./attempt-snapshot.service";
import { PrismaService } from "../../../database/prisma.service";
import { AttemptDefinitionV1, gradePinnedChoice } from "backend-contracts";
const url = process.env.ATTEMPT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("immutable attempts (real PostgreSQL)", () => {
  let prisma: PrismaClient;
  let service: AttemptSnapshotService;
  beforeAll(() => {
    if (
      !url ||
      !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
      !new URL(url).pathname.endsWith("/mark_part03")
    )
      throw new Error("Use the isolated localhost mark_part03 database");
    prisma = new PrismaClient({ datasources: { db: { url } } });
    service = new AttemptSnapshotService(prisma as unknown as PrismaService);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  async function fixture(type = "SINGLE_CORRECT") {
    const assignment = await prisma.assignment.create({
      data: {
        name: "Snapshot test",
        type: "AI_GRADED",
        published: true,
        questionOrder: [],
      },
    });
    const attempt = await prisma.assignmentAttempt.create({
      data: {
        assignmentId: assignment.id,
        userId: "synthetic-learner",
        submitted: false,
        questionOrder: [1],
      },
    });
    const definition: AttemptDefinitionV1 = {
      schemaVersion: 1,
      assignmentVersionId: null,
      assignment: {
        name: "Original",
        instructions: "Pinned instructions",
        showAssignmentScore: true,
      },
      questions: [
        {
          id: 1,
          versionId: null,
          variantId: null,
          question: "Original question",
          type,
          totalPoints: 2,
          configuration: {
            gradingContextQuestionIds: [],
            scoring: {
              type: "CRITERIA_BASED",
              rubrics: [{ name: "original rubric" }],
            },
          },
          choices:
            type === "SINGLE_CORRECT"
              ? [
                  {
                    id: randomUUID(),
                    choice: '"0"',
                    isCorrect: true,
                    points: 2,
                  },
                  {
                    id: randomUUID(),
                    choice: "zero",
                    isCorrect: false,
                    points: 0,
                  },
                ]
              : [],
        },
      ],
    };
    await prisma.attemptDefinition.create({
      data: {
        attemptId: attempt.id,
        snapshot: definition as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.attemptDraft.create({
      data: { attemptId: attempt.id, answers: [] },
    });
    return {
      attemptId: attempt.id,
      assignmentId: assignment.id,
      userId: attempt.userId,
      definition,
    };
  }
  const save = (f: Awaited<ReturnType<typeof fixture>>, input: unknown) =>
    service.save(f.attemptId, f.assignmentId, f.userId, input);
  const submit = (f: Awaited<ReturnType<typeof fixture>>, input: unknown) =>
    service.submit(f.attemptId, f.assignmentId, f.userId, input);
  it("serializes two tabs: one save wins and one conflicts", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      save(f, { operationId: randomUUID(), expectedRevision: 0, answers: [] }),
      save(f, { operationId: randomUUID(), expectedRevision: 0, answers: [] }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        results.find((r) => r.status === "rejected") as PromiseRejectedResult
      ).reason.getStatus(),
    ).toBe(409);
    expect(
      (
        await prisma.attemptDraft.findUniqueOrThrow({
          where: { attemptId: f.attemptId },
        })
      ).revision,
    ).toBe(1);
  });
  it("returns original save receipt after a lost response and later saves", async () => {
    const f = await fixture();
    const command = {
      operationId: randomUUID(),
      expectedRevision: 0,
      answers: [],
    };
    const receipt = await save(f, command);
    await save(f, {
      operationId: randomUUID(),
      expectedRevision: 1,
      answers: [],
    });
    expect(await save(f, command)).toEqual(receipt);
    await expect(
      save(f, { ...command, expectedRevision: 2 }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("save/submit race freezes requested revision or explicitly conflicts", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      save(f, { operationId: randomUUID(), expectedRevision: 0, answers: [] }),
      submit(f, { operationId: randomUUID(), expectedRevision: 0 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const frozen = await prisma.attemptSubmission.findUnique({
      where: { attemptId: f.attemptId },
    });
    if (frozen) expect(frozen.draftRevision).toBe(0);
    else
      expect((results[1] as PromiseRejectedResult).reason.getStatus()).toBe(
        409,
      );
  });
  it("duplicate submissions and timeout retries resolve to one immutable snapshot", async () => {
    const f = await fixture();
    const command = { operationId: randomUUID(), expectedRevision: 0 };
    const [a, b] = await Promise.all([submit(f, command), submit(f, command)]);
    expect(a.id).toBe(b.id);
    expect((await submit(f, command)).id).toBe(a.id);
    await expect(
      submit(f, { ...command, operationId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      save(f, { operationId: randomUUID(), expectedRevision: 0, answers: [] }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("publication edits cannot change the captured definition or grade", async () => {
    const f = await fixture();
    const choiceId = f.definition.questions[0].choices[0].id;
    await save(f, {
      operationId: randomUUID(),
      expectedRevision: 0,
      answers: [{ questionId: 1, choiceIds: [choiceId] }],
    });
    await prisma.assignment.update({
      where: { id: f.assignmentId },
      data: {
        name: "Republished",
        instructions: "different",
        showAssignmentScore: false,
      },
    });
    await submit(f, { operationId: randomUUID(), expectedRevision: 1 });
    const loaded = await service.loadForGrading(
      f.attemptId,
      f.assignmentId,
      f.userId,
    );
    expect(loaded.definition).toEqual(f.definition);
    expect(
      gradePinnedChoice(
        loaded.definition.questions[0],
        loaded.updateDto.responsesForQuestions[0].learnerChoices,
      ).totalPoints,
    ).toBe(2);
    expect(
      (await service.read(f.attemptId, f.assignmentId, f.userId)).definition
        .assignment.name,
    ).toBe("Original");
  });
  it("rejects foreign owners and route assignment IDs", async () => {
    const f = await fixture();
    await expect(
      service.read(f.attemptId, f.assignmentId, "other-user"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.save(f.attemptId, f.assignmentId + 999, f.userId, {
        operationId: randomUUID(),
        expectedRevision: 0,
        answers: [],
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.submit(f.attemptId, f.assignmentId, "other-user", {
        operationId: randomUUID(),
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("binds completed owned uploads and rejects same-user cross-attempt reuse", async () => {
    const f = await fixture("UPLOAD");
    const g = await fixture("UPLOAD");
    const uploadId = randomUUID();
    await prisma.fileUpload.create({
      data: {
        uploadId,
        userId: f.userId,
        storageKey: "synthetic/long.pdf",
        bucket: "local-only",
        uploadType: "learner",
        status: "COMPLETED",
      },
    });
    const source = await service.bindSource(
      f.attemptId,
      f.assignmentId,
      f.userId,
      uploadId,
    );
    expect(
      (
        await service.bindSource(
          f.attemptId,
          f.assignmentId,
          f.userId,
          uploadId,
        )
      ).id,
    ).toBe(source.id);
    await expect(
      service.bindSource(g.attemptId, g.assignmentId, g.userId, uploadId),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      save(g, {
        operationId: randomUUID(),
        expectedRevision: 0,
        answers: [{ questionId: 1, sourceIds: [source.id] }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    await save(f, {
      operationId: randomUUID(),
      expectedRevision: 0,
      answers: [{ questionId: 1, sourceIds: [source.id] }],
    });
    const frozen = await submit(f, {
      operationId: randomUUID(),
      expectedRevision: 1,
    });
    expect(
      (frozen.answers as { sources: { storageKey: string }[] }).sources[0]
        .storageKey,
    ).toBe("synthetic/long.pdf");
    await prisma.fileUpload.update({
      where: { uploadId },
      data: { storageKey: "changed.pdf" },
    });
    expect(
      (await service.loadForGrading(f.attemptId, f.assignmentId, f.userId))
        .updateDto.responsesForQuestions[0].learnerFileResponse[0].key,
    ).toBe("synthetic/long.pdf");
  });
  it("database rejects evidence mutation and rolls failed transactions back", async () => {
    const f = await fixture();
    const record = await submit(f, {
      operationId: randomUUID(),
      expectedRevision: 0,
    });
    await expect(
      prisma.attemptDefinition.update({
        where: { attemptId: f.attemptId },
        data: { snapshot: {} },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.attemptSubmission.delete({ where: { id: record.id } }),
    ).rejects.toThrow();
    const g = await fixture();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.attemptDraft.update({
          where: { attemptId: g.attemptId },
          data: { revision: 4 },
        });
        await tx.attemptDefinition.update({
          where: { attemptId: g.attemptId },
          data: { snapshot: {} },
        });
      }),
    ).rejects.toThrow();
    expect(
      (
        await prisma.attemptDraft.findUniqueOrThrow({
          where: { attemptId: g.attemptId },
        })
      ).revision,
    ).toBe(0);
  });
  it("keeps legacy attempts explicit, without guessing historical definitions", async () => {
    const f = await fixture();
    const legacy = await prisma.assignmentAttempt.create({
      data: {
        assignmentId: f.assignmentId,
        userId: f.userId,
        submitted: false,
        questionOrder: [999999],
      },
    });
    expect(
      await service.loadForGrading(legacy.id, f.assignmentId, f.userId),
    ).toBeUndefined();
    await expect(
      service.read(legacy.id, f.assignmentId, f.userId),
    ).rejects.toMatchObject({ status: 409 });
    await expect(service.assertLane(legacy.id, true)).rejects.toMatchObject({
      status: 409,
    });
    await expect(service.assertLegacy(f.attemptId)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("preserves false and zero through save, submit and reload", async () => {
    const f = await fixture("TRUE_FALSE");
    await save(f, {
      operationId: randomUUID(),
      expectedRevision: 0,
      answers: [{ questionId: 1, boolean: false, number: 0 }],
    });
    await submit(f, { operationId: randomUUID(), expectedRevision: 1 });
    const loaded = await service.loadForGrading(
      f.attemptId,
      f.assignmentId,
      f.userId,
    );
    expect(loaded.updateDto.responsesForQuestions[0].learnerAnswerChoice).toBe(
      false,
    );
    expect(loaded.updateDto.responsesForQuestions[0].learnerTextResponse).toBe(
      "0",
    );
  });
  it("retains pre-migration active/completed attempts with missing historical questions", async () => {
    const legacy = await prisma.assignmentAttempt.findMany({
      where: { userId: { startsWith: "migration-legacy-" } },
    });
    expect(legacy).toHaveLength(2);
    expect(legacy.find((a) => a.submitted).grade).toBe(0.5);
    for (const attempt of legacy)
      expect(
        await service.loadForGrading(
          attempt.id,
          attempt.assignmentId,
          attempt.userId,
        ),
      ).toBeUndefined();
  });

  it("creates, resumes, snapshots, grades and reloads a real choice attempt after republishing", async () => {
    const assignment = await prisma.assignment.create({
      data: {
        name: "Full journey",
        type: "AI_GRADED",
        published: true,
        questionOrder: [],
        showAssignmentScore: true,
      },
    });
    const question = await prisma.question.create({
      data: {
        assignmentId: assignment.id,
        question: "Original question",
        type: "SINGLE_CORRECT",
        totalPoints: 2,
        gradingContextQuestionIds: [],
        choices: [
          { choice: '"0"', isCorrect: true, points: 2 },
          { choice: "0", isCorrect: false, points: 0 },
        ],
      },
    });
    await prisma.assignment.update({
      where: { id: assignment.id },
      data: { questionOrder: [question.id] },
    });
    const logger = {
      child: () => logger,
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const factory = {
      getGradingStrategy: jest.fn(() => {
        throw new Error("Legacy grading must not run");
      }),
    };
    const responseService = new QuestionResponseService(
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
      factory as never,
      {
        parallelEnabled: false,
        schedule: (_key: string, callback: () => unknown) => callback(),
      } as never,
      logger as never,
    );
    const submissions = new AttemptSubmissionService(
      prisma as unknown as PrismaService,
      { validateNewAttempt: jest.fn() } as never,
      {} as never,
      {} as never,
      responseService,
      {} as never,
      new QuestionVariantService(prisma as unknown as PrismaService),
      {} as never,
      service,
    );
    const session = {
      userId: "journey-learner",
      role: UserRole.LEARNER,
      assignmentId: assignment.id,
      groupId: "synthetic",
    };
    const oldAllowlist = process.env.ATTEMPT_SNAPSHOT_ASSIGNMENT_IDS;
    process.env.ATTEMPT_SNAPSHOT_ASSIGNMENT_IDS = String(assignment.id);
    try {
      const operationId = randomUUID();
      const [created, retry] = await Promise.all([
        submissions.createAssignmentAttempt(
          assignment.id,
          session,
          true,
          operationId,
        ),
        submissions.createAssignmentAttempt(
          assignment.id,
          session,
          true,
          operationId,
        ),
      ]);
      expect(created.id).toBe(retry.id);
      const initial = await service.read(
        created.id,
        assignment.id,
        session.userId,
      );
      const choice = initial.definition.questions[0].choices.find(
        (c) => c.choice === '"0"',
      );
      await service.save(created.id, assignment.id, session.userId, {
        operationId: randomUUID(),
        expectedRevision: 0,
        answers: [{ questionId: question.id, choiceIds: [choice.id] }],
      });
      await prisma.question.update({
        where: { id: question.id },
        data: { question: "Changed", totalPoints: 100, choices: [] },
      });
      await prisma.assignment.update({
        where: { id: assignment.id },
        data: { instructions: "Changed", showAssignmentScore: false },
      });
      const frozen = await service.submit(
        created.id,
        assignment.id,
        session.userId,
        { operationId: randomUUID(), expectedRevision: 1 },
      );
      // A legacy write cannot fabricate a grade or insert a response for this attempt.
      await expect(
        prisma.assignmentAttempt.update({
          where: { id: created.id },
          data: { grade: 0, submitted: true },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.questionResponse.create({
          data: {
            assignmentAttemptId: created.id,
            questionId: question.id,
            learnerResponse: "forged",
            points: 0,
            feedback: [],
          },
        }),
      ).rejects.toThrow();
      const request = { userSession: session } as UserSessionRequest;
      jest
        .spyOn(responseService, "commitAttemptWithResponses")
        .mockRejectedValueOnce(new Error("synthetic failure before commit"));
      await expect(
        submissions.updateAssignmentAttempt(
          created.id,
          assignment.id,
          { submitted: true, responsesForQuestions: [], language: "en" },
          "",
          false,
          request,
        ),
      ).rejects.toThrow("synthetic failure before commit");
      expect(
        await prisma.questionResponse.count({
          where: { assignmentAttemptId: created.id },
        }),
      ).toBe(0);
      expect(
        (await service.read(created.id, assignment.id, session.userId))
          .submission.id,
      ).toBe(frozen.id);
      const result = await submissions.updateAssignmentAttempt(
        created.id,
        assignment.id,
        { submitted: true, responsesForQuestions: [], language: "en" },
        "",
        false,
        request,
      );
      expect(result.grade).toBe(1);
      expect(result.totalPossiblePoints).toBe(2);
      const saved = await prisma.assignmentAttempt.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(saved.resultSubmissionId).toBe(frozen.id);
      expect(
        await prisma.questionResponse.count({
          where: { assignmentAttemptId: created.id },
        }),
      ).toBe(1);
      const retriedResult = await submissions.updateAssignmentAttempt(
        created.id,
        assignment.id,
        { submitted: true, responsesForQuestions: [], language: "en" },
        "",
        false,
        request,
      );
      expect(retriedResult).toEqual(result);
      expect(
        (
          await submissions.createAssignmentAttempt(
            assignment.id,
            session,
            true,
            operationId,
          )
        ).id,
      ).toBe(created.id);
      expect(
        (await service.read(created.id, assignment.id, session.userId)).result
          .grade,
      ).toBe(1);
      await prisma.question.update({
        where: { id: question.id },
        data: {
          totalPoints: 2,
          choices: [{ choice: "New", isCorrect: true, points: 2 }],
        },
      });
      const retake = await submissions.createAssignmentAttempt(
        assignment.id,
        session,
        true,
        randomUUID(),
      );
      expect(retake.id).not.toBe(created.id);
      expect(
        (await service.read(created.id, assignment.id, session.userId))
          .submission.id,
      ).toBe(frozen.id);
      process.env.ATTEMPT_SNAPSHOT_ASSIGNMENT_IDS = "";
      expect(
        (
          await submissions.createAssignmentAttempt(
            assignment.id,
            session,
            true,
            operationId,
          )
        ).id,
      ).toBe(created.id);
      expect(factory.getGradingStrategy).not.toHaveBeenCalled();
    } finally {
      if (oldAllowlist === undefined)
        delete process.env.ATTEMPT_SNAPSHOT_ASSIGNMENT_IDS;
      else process.env.ATTEMPT_SNAPSHOT_ASSIGNMENT_IDS = oldAllowlist;
    }
  });
  it("captures exact version, selected variant, rubric and shuffled choices from the publication adapter", async () => {
    const assignment = await prisma.assignment.create({
      data: {
        name: "Variant capture",
        type: "AI_GRADED",
        published: true,
        questionOrder: [],
      },
    });
    const choices = [
      { choice: "B", isCorrect: false, points: 0 },
      { choice: "A", isCorrect: true, points: 2 },
    ];
    const question = await prisma.question.create({
      data: {
        assignmentId: assignment.id,
        question: "Base",
        type: "SINGLE_CORRECT",
        totalPoints: 2,
        choices,
        gradingContextQuestionIds: [],
      },
    });
    const version = await prisma.assignmentVersion.create({
      data: {
        assignmentId: assignment.id,
        versionNumber: "1.0.0",
        name: "v1",
        type: "AI_GRADED",
        createdBy: "synthetic-author",
        questionOrder: [question.id],
      },
    });
    const qv = await prisma.questionVersion.create({
      data: {
        assignmentVersionId: version.id,
        questionId: question.id,
        question: "v1 question",
        type: "SINGLE_CORRECT",
        totalPoints: 2,
        choices,
        gradingContextQuestionIds: [],
      },
    });
    const variant = await prisma.questionVariant.create({
      data: {
        questionId: question.id,
        variantContent: "Selected wording",
        variantType: "REWORDED",
        choices,
        scoring: { type: "LOSS_PER_MISTAKE" },
      },
    });
    const attempt = await prisma.assignmentAttempt.create({
      data: {
        assignmentId: assignment.id,
        assignmentVersionId: version.id,
        userId: "synthetic-learner",
        submitted: false,
        questionOrder: [question.id],
      },
    });
    await prisma.assignmentAttemptQuestionVariant.create({
      data: {
        assignmentAttemptId: attempt.id,
        questionId: question.id,
        questionVariantId: variant.id,
        randomizedChoices: JSON.stringify(choices),
      },
    });
    const dto = {
      ...question,
      variants: [
        { ...variant, choices, scoring: { type: "LOSS_PER_MISTAKE" } },
      ],
    };
    // Even a mutable variant edited between adapter read and capture cannot change the selected definition.
    await prisma.questionVariant.update({
      where: { id: variant.id },
      data: { variantContent: "Later wording", scoring: {} },
    });
    await prisma.$transaction((tx) =>
      service.capture(
        tx,
        attempt.id,
        version.id,
        { name: version.name, showQuestions: true },
        [dto] as never,
        [qv],
      ),
    );
    const record = await prisma.attemptDefinition.findUniqueOrThrow({
      where: { attemptId: attempt.id },
    });
    const captured = record.snapshot as unknown as AttemptDefinitionV1;
    expect(captured.assignmentVersionId).toBe(version.id);
    expect(captured.questions[0]).toMatchObject({
      versionId: qv.id,
      variantId: variant.id,
      question: "Selected wording",
      configuration: { scoring: { type: "LOSS_PER_MISTAKE" } },
    });
    expect(captured.questions[0].choices.map((c) => c.choice)).toEqual([
      "B",
      "A",
    ]);
    await prisma.questionVersion.update({
      where: { id: qv.id },
      data: { question: "Republished" },
    });
    expect(
      (await service.read(attempt.id, assignment.id, attempt.userId)).definition
        .questions[0].question,
    ).toBe("Selected wording");
  });

  it("rejects pending or foreign uploads and expired draft mutations", async () => {
    const f = await fixture("UPLOAD");
    const pending = await prisma.fileUpload.create({
      data: {
        uploadId: randomUUID(),
        userId: f.userId,
        storageKey: "pending.pdf",
        bucket: "local",
        uploadType: "learner",
      },
    });
    const foreign = await prisma.fileUpload.create({
      data: {
        uploadId: randomUUID(),
        userId: "other-user",
        storageKey: "foreign.pdf",
        bucket: "local",
        uploadType: "learner",
        status: "COMPLETED",
      },
    });
    for (const upload of [pending, foreign])
      await expect(
        service.bindSource(
          f.attemptId,
          f.assignmentId,
          f.userId,
          upload.uploadId,
        ),
      ).rejects.toMatchObject({ status: 404 });
    await prisma.assignmentAttempt.update({
      where: { id: f.attemptId },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      save(f, { operationId: randomUUID(), expectedRevision: 0, answers: [] }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      submit(f, { operationId: randomUUID(), expectedRevision: 0 }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
