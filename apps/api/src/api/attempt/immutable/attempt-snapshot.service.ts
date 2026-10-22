/* eslint-disable unicorn/no-null */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import {
  attemptDefinitionSchema,
  DraftAnswer,
  learnerDefinition,
  normalizeDraftAnswers,
  saveDraftSchema,
  submitDraftSchema,
} from "backend-contracts";
import { PrismaService } from "../../../database/prisma.service";
import { LearnerUpdateAssignmentAttemptRequestDto } from "../../assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import { QuestionDto } from "../../assignment/dto/update.questions.request.dto";

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
// Stable key ordering makes retries independent of JSON object property order.
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function parsedArray(value: unknown): Record<string, unknown>[] {
  try {
    const parsed: unknown =
      typeof value === "string" ? JSON.parse(value) : value;
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (item) => !item || typeof item !== "object" || Array.isArray(item),
      )
    )
      throw new Error("Invalid published choices");
    return parsed as Record<string, unknown>[];
  } catch {
    throw new UnprocessableEntityException("Invalid published choices");
  }
}

@Injectable()
export class AttemptSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  /** Empty by default. Existing attempts never change lanes when this list changes. */
  enabled(assignmentId: number): boolean {
    return (process.env.ATTEMPT_SNAPSHOT_ASSIGNMENT_IDS ?? "")
      .split(",")
      .includes(String(assignmentId));
  }

  async capture(
    tx: Prisma.TransactionClient,
    attemptId: number,
    assignmentVersionId: number | null,
    assignment: Record<string, unknown>,
    questions: QuestionDto[],
    versions: { id: number; questionId: number | null }[],
  ) {
    const picks = await tx.assignmentAttemptQuestionVariant.findMany({
      where: { assignmentAttemptId: attemptId },
    });
    const parsed = attemptDefinitionSchema.safeParse({
      schemaVersion: 1,
      assignmentVersionId,
      assignment,
      questions: questions.map((question) => {
        const pick = picks.find((p) => p.questionId === question.id);
        if (!pick)
          throw new BadRequestException("Missing selected question variant");
        const variant = question.variants?.find(
          (v) => v.id === pick.questionVariantId,
        );
        if (pick.questionVariantId && !variant)
          throw new UnprocessableEntityException(
            "Selected variant is absent from the published adapter",
          );
        const configuration = {
          ...question,
          ...(variant
            ? {
                question: variant.variantContent,
                scoring: variant.scoring ?? question.scoring,
                answer: question.answer,
                maxWords: variant.maxWords ?? question.maxWords,
                maxCharacters: variant.maxCharacters ?? question.maxCharacters,
              }
            : {}),
        };
        // Variant pools are mutable and are not part of a selected definition.
        delete configuration.variants;
        return {
          id: question.id,
          versionId:
            versions.find((v) => (v.questionId ?? v.id) === question.id)?.id ??
            null,
          variantId: pick.questionVariantId,
          question: configuration.question,
          type: question.type,
          totalPoints: question.totalPoints,
          configuration: json(configuration),
          choices: parsedArray(pick.randomizedChoices ?? []).map((raw) => {
            const choice = raw ;
            return {
              id: randomUUID(),
              choice: choice.choice,
              isCorrect: choice.isCorrect,
              points: choice.points,
              ...(choice.feedback === undefined
                ? {}
                : { feedback: choice.feedback }),
            };
          }),
        };
      }),
    });
    if (!parsed.success)
      throw new UnprocessableEntityException(
        "Published attempt definition is invalid",
      );
    const snapshot = parsed.data;
    if (snapshot.questions.reduce((sum, q) => sum + q.totalPoints, 0) <= 0)
      throw new UnprocessableEntityException(
        "Published assignment must have positive available points",
      );
    await tx.attemptDefinition.create({
      data: { attemptId, snapshot: json(snapshot) },
    });
    await tx.attemptDraft.create({ data: { attemptId, answers: [] } });
  }

  async assertLane(
    attemptId: number,
    snapshotContract: boolean,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const pinned = !!(await tx.attemptDefinition.findUnique({
      where: { attemptId },
    }));
    if (pinned !== snapshotContract)
      throw new ConflictException(
        "Resume this attempt using its original API contract",
      );
  }

  async assertLegacy(attemptId: number) {
    if (
      await this.prisma.attemptDefinition.findUnique({ where: { attemptId } })
    )
      throw new ConflictException(
        "Use the revision-aware snapshot API for this attempt",
      );
  }

  async loadForGrading(
    attemptId: number,
    assignmentId: number,
    userId: string,
  ) {
    const record = await this.prisma.attemptDefinition.findUnique({
      where: { attemptId },
    });
    if (!record) return;
    const attempt = await this.prisma.assignmentAttempt.findFirst({
      where: { id: attemptId, assignmentId, userId },
    });
    if (!attempt) throw new NotFoundException("Attempt not found");
    const submission = await this.prisma.attemptSubmission.findUnique({
      where: { attemptId },
    });
    if (!submission)
      throw new ConflictException("Submit a persisted draft revision first");
    const definition = attemptDefinitionSchema.parse(record.snapshot);
    const snapshot = submission.answers as unknown as {
      answers: DraftAnswer[];
      sources: { id: string; storageKey: string; bucket: string }[];
    };
    const responses = definition.questions.map((question) => {
      const answer = snapshot.answers.find((a) => a.questionId === question.id);
      return {
        id: question.id,
        ...(answer?.choiceIds === undefined
          ? {}
          : { learnerChoices: answer.choiceIds }),
        ...(answer?.boolean === undefined
          ? {}
          : { learnerAnswerChoice: answer.boolean }),
        ...(answer?.text === undefined && answer?.number === undefined
          ? {}
          : { learnerTextResponse: answer.text ?? String(answer.number) }),
        ...(answer?.sourceIds?.length
          ? {
              learnerFileResponse: answer.sourceIds.map((id) => {
                const source = snapshot.sources.find((s) => s.id === id);
                if (!source)
                  throw new BadRequestException("Submission source is missing");
                return {
                  key: source.storageKey,
                  bucket: source.bucket,
                  filename: source.storageKey.split("/").at(-1),
                };
              }),
            }
          : {}),
      };
    });
    return {
      attempt,
      definition,
      submission,
      updateDto: {
        submitted: true,
        language:
          typeof definition.assignment.languageCode === "string"
            ? definition.assignment.languageCode
            : "en",
        responsesForQuestions: responses,
      } as LearnerUpdateAssignmentAttemptRequestDto,
    };
  }

  private async lock(
    tx: Prisma.TransactionClient,
    attemptId: number,
    assignmentId: number,
    userId: string,
  ) {
    // The same row lock serializes every draft, source-binding and submit command.
    await tx.$queryRaw`SELECT id FROM "AssignmentAttempt" WHERE id = ${attemptId} FOR UPDATE`;
    const attempt = await tx.assignmentAttempt.findFirst({
      where: { id: attemptId, assignmentId, userId },
    });
    if (!attempt) throw new NotFoundException("Attempt not found");
    const definition = await tx.attemptDefinition.findUnique({
      where: { attemptId },
    });
    if (!definition)
      throw new ConflictException("This attempt uses the legacy API");
    return {
      attempt,
      definition: attemptDefinitionSchema.parse(definition.snapshot),
    };
  }

  private writable(
    attempt: { submitted: boolean; expiresAt: Date | null },
    submitted: boolean,
  ) {
    if (attempt.submitted || submitted)
      throw new ConflictException(
        "The submission is immutable; start a new attempt",
      );
    if (attempt.expiresAt && attempt.expiresAt <= new Date())
      throw new ConflictException("Attempt has expired");
  }

  async read(attemptId: number, assignmentId: number, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { attempt, definition } = await this.lock(
        tx,
        attemptId,
        assignmentId,
        userId,
      );
      const draft = await tx.attemptDraft.findUniqueOrThrow({
        where: { attemptId },
      });
      const submission = await tx.attemptSubmission.findUnique({
        where: { attemptId },
      });
      const responses = attempt.submitted
        ? await tx.questionResponse.findMany({
            where: { assignmentAttemptId: attemptId },
          })
        : [];
      const result = attempt.submitted
        ? {
            submissionId: attempt.resultSubmissionId,
            grade:
              definition.assignment.showAssignmentScore === true
                ? attempt.grade
                : undefined,
            questions: responses.map((r) => ({
              questionId: r.questionId,
              points:
                definition.assignment.showQuestionScore === true
                  ? r.points
                  : undefined,
              feedback:
                definition.assignment.showSubmissionFeedback === true &&
                definition.assignment.correctAnswerVisibility === "ALWAYS"
                  ? r.feedback
                  : undefined,
            })),
          }
        : null;
      const projected = learnerDefinition(definition);
      if (attempt.submitted && definition.assignment.showQuestions !== true)
        projected.questions = [];
      return { definition: projected, draft, submission, result };
    });
  }

  async save(
    attemptId: number,
    assignmentId: number,
    userId: string,
    input: unknown,
  ) {
    const result = saveDraftSchema.safeParse(input);
    if (!result.success) throw new BadRequestException("Invalid draft command");
    const command = result.data;
    const hash = createHash("sha256").update(canonical(command)).digest("hex");
    return this.prisma.$transaction(async (tx) => {
      const { attempt, definition } = await this.lock(
        tx,
        attemptId,
        assignmentId,
        userId,
      );
      const receipt = await tx.attemptDraftOperation.findUnique({
        where: {
          attemptId_operationId: {
            attemptId,
            operationId: command.operationId,
          },
        },
      });
      if (receipt) {
        if (receipt.requestHash !== hash)
          throw new ConflictException(
            "Operation ID was reused with a different request",
          );
        return {
          attemptId,
          revision: receipt.revision,
          operationId: receipt.operationId,
        };
      }
      this.writable(
        attempt,
        !!(await tx.attemptSubmission.findUnique({ where: { attemptId } })),
      );
      const draft = await tx.attemptDraft.findUniqueOrThrow({
        where: { attemptId },
      });
      if (draft.revision !== command.expectedRevision)
        throw new ConflictException({
          code: "DRAFT_CONFLICT",
          revision: draft.revision,
        });
      let answers: DraftAnswer[];
      try {
        answers = normalizeDraftAnswers(definition, command.answers);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      const sourceIds = answers.flatMap((a) => a.sourceIds ?? []);
      const sources = await tx.attemptSource.findMany({
        where: { attemptId, id: { in: sourceIds } },
      });
      if (new Set(sourceIds).size !== sources.length)
        throw new BadRequestException(
          "A source does not belong to this attempt",
        );
      const revision = draft.revision + 1;
      await tx.attemptDraft.update({
        where: { attemptId },
        data: { revision, answers: json(answers) },
      });
      await tx.attemptDraftOperation.create({
        data: {
          attemptId,
          operationId: command.operationId,
          requestHash: hash,
          revision,
        },
      });
      return { attemptId, revision, operationId: command.operationId };
    });
  }

  async submit(
    attemptId: number,
    assignmentId: number,
    userId: string,
    input: unknown,
  ) {
    const result = submitDraftSchema.safeParse(input);
    if (!result.success)
      throw new BadRequestException("Invalid submission command");
    const command = result.data;
    return this.prisma.$transaction(async (tx) => {
      const { attempt, definition } = await this.lock(
        tx,
        attemptId,
        assignmentId,
        userId,
      );
      const previous = await tx.attemptSubmission.findUnique({
        where: { attemptId },
      });
      if (previous) {
        if (
          previous.operationId === command.operationId &&
          previous.draftRevision === command.expectedRevision
        )
          return previous;
        throw new ConflictException(
          "This attempt already has an immutable submission",
        );
      }
      this.writable(attempt, false);
      const draft = await tx.attemptDraft.findUniqueOrThrow({
        where: { attemptId },
      });
      if (draft.revision !== command.expectedRevision)
        throw new ConflictException({
          code: "DRAFT_CONFLICT",
          revision: draft.revision,
        });
      const answers = normalizeDraftAnswers(
        definition,
        draft.answers as DraftAnswer[],
      );
      if (definition.assignment.requireAllQuestions === true) {
        const optional = definition.assignment.optionalQuestionIds as
          | number[]
          | undefined;
        for (const question of definition.questions) {
          const answer = answers.find((a) => a.questionId === question.id);
          if (
            !optional?.includes(question.id) &&
            (!answer || !this.answered(answer))
          )
            throw new BadRequestException(
              "Answer all required questions before submitting",
            );
        }
      }
      // Source rows are immutable, but include their keys in this record as explicit evidence.
      const sourceIds = answers.flatMap((a) => a.sourceIds ?? []);
      const sources = await tx.attemptSource.findMany({
        where: { attemptId, id: { in: sourceIds } },
      });
      if (new Set(sourceIds).size !== sources.length)
        throw new BadRequestException("Invalid submission source");
      return tx.attemptSubmission.create({
        data: {
          attemptId,
          operationId: command.operationId,
          draftRevision: draft.revision,
          answers: json({ answers, sources }),
        },
      });
    });
  }

  private answered(answer: DraftAnswer): boolean {
    return !!(
      answer.choiceIds?.length ||
      answer.sourceIds?.length ||
      answer.text?.trim() ||
      answer.boolean !== undefined ||
      answer.number !== undefined
    );
  }

  async bindSource(
    attemptId: number,
    assignmentId: number,
    userId: string,
    uploadId: string,
  ) {
    if (typeof uploadId !== "string" || !uploadId || uploadId.length > 1024)
      throw new BadRequestException("Invalid upload ID");
    return this.prisma.$transaction(async (tx) => {
      const { attempt } = await this.lock(tx, attemptId, assignmentId, userId);
      this.writable(
        attempt,
        !!(await tx.attemptSubmission.findUnique({ where: { attemptId } })),
      );
      // Serialize bindings across attempts too. The upload ID is globally unique.
      await tx.$queryRaw`SELECT id FROM "FileUpload" WHERE "uploadId" = ${uploadId} FOR UPDATE`;
      const upload = await tx.fileUpload.findFirst({
        where: { uploadId, userId, status: "COMPLETED" },
      });
      if (!upload) throw new NotFoundException("Completed upload not found");
      const existing = await tx.attemptSource.findUnique({
        where: { uploadId },
      });
      if (existing) {
        if (existing.attemptId !== attemptId)
          throw new ConflictException("Upload belongs to another attempt");
        return existing;
      }
      return tx.attemptSource.create({
        data: {
          attemptId,
          uploadId,
          storageKey: upload.storageKey,
          bucket: upload.bucket,
        },
      });
    });
  }
}
