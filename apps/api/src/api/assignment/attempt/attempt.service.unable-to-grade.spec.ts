import { HttpService } from "@nestjs/axios";
import { HttpStatus } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { UserRole } from "../../../auth/interfaces/user.session.interface";
import { AllExceptionsFilter } from "../../../common/filters/all-exceptions.filter";
import { PrismaService } from "../../../database/prisma.service";
import { GradingKillSwitchService } from "../../ai-feature-flags/grading-kill-switch.service";
import { LtiGradeSyncService } from "../../attempt/services/lti-grade-sync.service";
import { SourceProcessingError } from "../../llm/features/grading/errors/source-processing.error";
import { UnsupportedImageFormatError } from "../../llm/features/grading/errors/unsupported-image-format.error";
import { LlmFacadeService } from "../../llm/llm-facade.service";
import { QuestionService } from "../question/question.service";
import { AssignmentServiceV1 } from "../v1/services/assignment.service";
import { AttemptServiceV1 } from "./attempt.service";

describe("AttemptServiceV1 — learner-fixable grading failures", () => {
  let service: AttemptServiceV1;
  const childLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptServiceV1,
        { provide: PrismaService, useValue: {} },
        { provide: HttpService, useValue: {} },
        { provide: LlmFacadeService, useValue: {} },
        { provide: QuestionService, useValue: {} },
        { provide: AssignmentServiceV1, useValue: {} },
        { provide: LtiGradeSyncService, useValue: {} },
        { provide: GradingKillSwitchService, useValue: {} },
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: { child: () => childLogger },
        },
      ],
    }).compile();
    service = module.get(AttemptServiceV1);
    jest.clearAllMocks();
  });

  function submitQuestions(): Promise<unknown> {
    return (
      service as unknown as {
        submitQuestions: (...args: unknown[]) => Promise<unknown>;
      }
    ).submitQuestions(
      [{ id: 11 }, { id: 12 }, { id: 13 }],
      555,
      UserRole.LEARNER,
      77,
      "en",
    );
  }

  it("answers 422 with every blocked question instead of a 500", async () => {
    jest
      .spyOn(service, "createQuestionResponse")
      .mockImplementation(async (_attemptId, questionId) => {
        if (questionId === 11) {
          throw new SourceProcessingError("url_fetch_failed", "url", {
            code: "url_unreachable",
            questionId: 11,
            source: {
              kind: "url",
              url: "https://github.com/o/private-repo",
              httpStatus: 404,
            },
          });
        }
        if (questionId === 13) {
          throw new UnsupportedImageFormatError({
            filename: "Packet capture.pcapng.png",
            reason: "unrecognized data",
          });
        }
        return {} as never;
      });

    const error = await submitQuestions().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SourceProcessingError);
    expect((error as SourceProcessingError).issues).toEqual([
      expect.objectContaining({ questionId: 11, code: "url_unreachable" }),
      expect.objectContaining({
        questionId: 13,
        code: "file_unsupported_type",
      }),
    ]);

    const filter = new AllExceptionsFilter(
      { child: () => ({ error: jest.fn(), warn: jest.fn() }) } as never,
      { getStats: () => ({ state: "CLOSED" }) } as never,
    );
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
      headersSent: false,
    };
    const request = {
      method: "PATCH",
      originalUrl: "/api/v1/assignments/77/attempts/555",
      body: undefined,
      get: jest.fn().mockReturnValue(undefined),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    };
    filter.catch(error, host as never);

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "SourceProcessingError",
        retryable: false,
        failure: {
          kind: "unable_to_grade",
          issues: [
            expect.objectContaining({
              questionId: 11,
              code: "url_unreachable",
              source: {
                kind: "url",
                url: "https://github.com/o/private-repo",
                httpStatus: 404,
              },
            }),
            expect.objectContaining({ questionId: 13 }),
          ],
        },
      }),
    );
  });

  it("keeps a 500 for failures that are ours", async () => {
    jest
      .spyOn(service, "createQuestionResponse")
      .mockRejectedValue(new TypeError("bug"));

    await expect(submitQuestions()).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    });
  });
});
