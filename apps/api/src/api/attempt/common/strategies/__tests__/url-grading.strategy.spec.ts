import {
  SourceProcessingError,
  RetryableProcessingError,
} from "../../../../llm/features/grading/errors/source-processing.error";
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { GithubRateLimitedError } from "src/api/llm/features/grading/errors/github-rate-limited.error";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { Logger } from "winston";
import * as githubContentFetch from "src/api/attempt/common/utils/github-content-fetch.util";
import { GradingAuditService } from "../../../services/question-response/grading-audit.service";
import { GRADING_AUDIT_SERVICE } from "../../../attempt.constants";
import { LocalizationService } from "../../utils/localization.service";
import { UrlGradingStrategy } from "../url-grading.strategy";

jest.mock("src/api/attempt/common/utils/github-content-fetch.util");

const mockedFetch =
  githubContentFetch.fetchUrlContentForGrading as jest.MockedFunction<
    typeof githubContentFetch.fetchUrlContentForGrading
  >;

describe("UrlGradingStrategy - Type Safety Tests", () => {
  let strategy: UrlGradingStrategy;
  let localizationService: jest.Mocked<LocalizationService>;
  let llmFacadeService: jest.Mocked<LlmFacadeService>;
  let gradingAuditService: jest.Mocked<GradingAuditService>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(async () => {
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<Logger>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UrlGradingStrategy,
        {
          provide: LlmFacadeService,
          useValue: {
            gradeUrlBasedQuestion: jest.fn(),
          },
        },
        {
          provide: LocalizationService,
          useValue: {
            getLocalizedString: jest.fn((key: string) => {
              const messages: Record<string, string> = {
                expectedUrlResponse:
                  "Expected a URL response, but did not receive one.",
                invalidUrl: "Invalid URL",
              };
              return messages[key] || key;
            }),
          },
        },
        {
          provide: GRADING_AUDIT_SERVICE,
          useValue: {
            recordGrading: jest.fn(),
          },
        },
        {
          provide: "winston",
          useValue: mockLogger,
        },
      ],
    }).compile();

    strategy = module.get<UrlGradingStrategy>(UrlGradingStrategy);
    localizationService = module.get(LocalizationService);
    llmFacadeService = module.get(LlmFacadeService);
    gradingAuditService = module.get(GRADING_AUDIT_SERVICE);
  });

  describe("validateResponse - Type Safety", () => {
    const mockQuestion: QuestionDto = {
      id: 1,
      question: "Test question",
      type: "URL" as any,
      totalPoints: 10,
    } as QuestionDto;

    it("should handle null learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: null,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle undefined learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: undefined,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle number as learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: 12_345,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle object as learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: { url: "https://example.com" },
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle array as learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: ["https://example.com"],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle boolean as learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: true,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle empty string learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: "",
        language: "en",
      } as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle whitespace-only string learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: "   ",
        language: "en",
      } as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should accept valid URL string", async () => {
      const requestDto = {
        learnerUrlResponse: "https://example.com",
        language: "en",
      } as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(mockQuestion, requestDto);
      expect(result).toBe(true);
    });

    it("accepts a non-empty response and defers URL validity to grading time", async () => {
      // Format validity is no longer a hard validation gate: an unparseable
      // URL must be graded 0-with-feedback in gradeResponse, not thrown here
      // (a throw fails the whole grading job and leaves the attempt ungraded).
      const requestDto = {
        learnerUrlResponse: "not a valid url",
        language: "en",
      } as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).resolves.toBe(true);
    });
  });

  describe("gradeResponse - invalid URL handling", () => {
    const mockQuestion: QuestionDto = {
      id: 1,
      question: "Submit your project URL",
      type: "URL" as any,
      totalPoints: 10,
    } as QuestionDto;

    const context = {
      language: "en",
      assignmentId: 1,
      questionAnswerContext: "",
      assignmentInstructions: "",
    } as any;

    it("reports an unparseable URL as fixable instead of scoring it or fetching", async () => {
      await expect(
        strategy.gradeResponse(mockQuestion, "script.js", context),
      ).rejects.toMatchObject({
        name: "SourceProcessingError",
        code: "url_invalid",
        source: { kind: "url", url: "script.js" },
      });
      // Must short-circuit before any LLM grading call.
      expect(llmFacadeService.gradeUrlBasedQuestion).not.toHaveBeenCalled();
    });
  });

  describe("extractLearnerResponse - Type Safety", () => {
    it("should throw error for null learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: null,
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw error for undefined learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: undefined,
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw error for number learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: 123,
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw error for object learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: { url: "test" },
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should trim valid string learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: "  https://example.com  ",
      } as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toBe("https://example.com");
    });

    it("adds the scheme a learner left off so the URL can be fetched", async () => {
      const requestDto = {
        learnerUrlResponse:
          " github.com/owner/repo/blob/main/final_project/router/general.js ",
      } as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toBe(
        "https://github.com/owner/repo/blob/main/final_project/router/general.js",
      );
    });

    it("leaves a value that cannot be normalized alone for grading to report", async () => {
      const requestDto = {
        learnerUrlResponse: "  dgtj  ",
      } as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toBe("dgtj");
    });
  });

  describe("UrlGradingStrategy - GitHub fetch behavior", () => {
    const mockQuestion: QuestionDto = {
      id: 1,
      question: "Submit your project URL",
      type: "URL" as any,
      totalPoints: 10,
    } as QuestionDto;

    const context = {
      language: "en",
      assignmentId: 42,
      questionAnswerContext: [],
      assignmentInstructions: "",
    } as any;

    beforeEach(() => {
      mockedFetch.mockReset();
    });

    it("delegates to the shared fetchUrlContentForGrading helper", async () => {
      mockedFetch.mockResolvedValue({ body: "# Readme", isFunctional: true });
      llmFacadeService.gradeUrlBasedQuestion.mockResolvedValue({
        points: 8,
        feedback: "Good work",
        gradingRationale: "Looks complete",
      } as any);

      await strategy.gradeResponse(
        mockQuestion,
        "https://github.com/octocat/hello-world",
        context,
      );

      expect(mockedFetch).toHaveBeenCalledWith(
        "https://github.com/octocat/hello-world",
        expect.objectContaining({ assignmentId: 42, questionId: 1 }),
      );
    });

    it("blocks scoring when required URL content cannot be fetched", async () => {
      mockedFetch.mockResolvedValue({ body: "", isFunctional: false });
      await expect(
        strategy.gradeResponse(
          mockQuestion,
          "https://learner-portfolio.dev/work",
          context,
        ),
      ).rejects.toBeInstanceOf(SourceProcessingError);
      expect(llmFacadeService.gradeUrlBasedQuestion).not.toHaveBeenCalled();
      expect(gradingAuditService.recordGrading).not.toHaveBeenCalled();
    });

    it.each(["readme", "repository_metadata", "repository_page"] as const)(
      "blocks REPO grading based only on %s evidence",
      async (evidenceKind) => {
        mockedFetch.mockResolvedValue({
          body: "Repository description",
          isFunctional: true,
          evidenceKind,
        });
        await expect(
          strategy.gradeResponse(
            { ...mockQuestion, responseType: "REPO" } as QuestionDto,
            "https://github.com/acme/repo",
            context,
          ),
        ).rejects.toMatchObject({ reason: "insufficient_source_evidence" });
        expect(llmFacadeService.gradeUrlBasedQuestion).not.toHaveBeenCalled();
      },
    );

    it("blocks an unexpected fetch exception rather than awarding fallback credit", async () => {
      mockedFetch.mockRejectedValue(new Error("fetch failed"));
      await expect(
        strategy.gradeResponse(
          mockQuestion,
          "https://learner-portfolio.dev/work",
          context,
        ),
      ).rejects.toBeInstanceOf(RetryableProcessingError);
      expect(llmFacadeService.gradeUrlBasedQuestion).not.toHaveBeenCalled();
    });

    it("fetches a schemeless github link instead of scoring it zero", async () => {
      mockedFetch.mockResolvedValue({
        body: "const express = require('express');",
        isFunctional: true,
      });
      llmFacadeService.gradeUrlBasedQuestion.mockResolvedValue({
        points: 8,
        feedback: "Good work",
        gradingRationale: "Looks complete",
      } as any);

      const result = await strategy.gradeResponse(
        mockQuestion,
        "github.com/owner/repo/blob/main/router/general.js",
        context,
      );

      expect(mockedFetch).toHaveBeenCalledWith(
        "https://github.com/owner/repo/blob/main/router/general.js",
        expect.objectContaining({ assignmentId: 42, questionId: 1 }),
      );
      expect(result.totalPoints).toBe(8);
      expect(JSON.stringify(result)).not.toMatch(/invalid url/i);
    });

    it("fetches a link pasted with surrounding whitespace", async () => {
      mockedFetch.mockResolvedValue({ body: "# Readme", isFunctional: true });
      llmFacadeService.gradeUrlBasedQuestion.mockResolvedValue({
        points: 5,
        feedback: "ok",
        gradingRationale: "ok",
      } as any);

      await strategy.gradeResponse(
        mockQuestion,
        " https://github.com/octocat/hello-world\n",
        context,
      );

      expect(mockedFetch).toHaveBeenCalledWith(
        "https://github.com/octocat/hello-world",
        expect.anything(),
      );
    });

    it("reports an unusable value as an invalid address without calling the fetch", async () => {
      await expect(
        strategy.gradeResponse(mockQuestion, "dgtj", context),
      ).rejects.toMatchObject({ code: "url_invalid" });
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it("propagates GithubRateLimitedError instead of grading a silent 0", async () => {
      mockedFetch.mockRejectedValue(
        new GithubRateLimitedError({
          owner: "octocat",
          repo: "hello-world",
          requestUrl: "https://api.github.com/repos/octocat/hello-world",
        }),
      );

      await expect(
        strategy.gradeResponse(
          mockQuestion,
          "https://github.com/octocat/hello-world",
          context,
        ),
      ).rejects.toThrow(GithubRateLimitedError);
      expect(llmFacadeService.gradeUrlBasedQuestion).not.toHaveBeenCalled();
    });

    it("passes fetched text to the grader as-is, not JSON-encoded", async () => {
      const body = 'class A {\n    String s = "x";\n}';
      mockedFetch.mockResolvedValue({ body, isFunctional: true });
      llmFacadeService.gradeUrlBasedQuestion.mockResolvedValue({
        points: 8,
        feedback: "ok",
      } as any);

      await strategy.gradeResponse(
        mockQuestion,
        "https://github.com/acme/shop/blob/main/A.java",
        context,
      );

      expect(
        llmFacadeService.gradeUrlBasedQuestion.mock.calls[0][0].urlBody,
      ).toBe(body);
    });

    it("JSON-encodes a body that is not a string", async () => {
      const body = { cells: [] };
      mockedFetch.mockResolvedValue({ body, isFunctional: true } as any);
      llmFacadeService.gradeUrlBasedQuestion.mockResolvedValue({
        points: 8,
        feedback: "ok",
      } as any);

      await strategy.gradeResponse(
        mockQuestion,
        "https://github.com/acme/shop/blob/main/a.ipynb",
        context,
      );

      expect(
        llmFacadeService.gradeUrlBasedQuestion.mock.calls[0][0].urlBody,
      ).toBe('{"cells":[]}');
    });

    it("retries provider failures without awarding fallback credit", async () => {
      mockedFetch.mockResolvedValue({ body: "class A {}", isFunctional: true });
      llmFacadeService.gradeUrlBasedQuestion.mockRejectedValue(
        new Error("model unavailable"),
      );
      await expect(
        strategy.gradeResponse(
          mockQuestion,
          "https://learner-portfolio.dev/work",
          context,
        ),
      ).rejects.toBeInstanceOf(RetryableProcessingError);
      expect(gradingAuditService.recordGrading).not.toHaveBeenCalled();
    });

    describe("issue codes for links that can't be graded as submitted", () => {
      const question = {
        id: 7924,
        question: "Submit the link to your README",
        type: "URL" as any,
        totalPoints: 10,
      } as QuestionDto;
      const context = {
        language: "en",
        assignmentId: 2561,
        attemptId: 1877610,
        questionAnswerContext: [],
        assignmentInstructions: "",
      } as any;

      beforeEach(() => {
        mockedFetch.mockReset();
      });

      it.each([
        "https://github.com/<your-username>/<your-repo-name>/blob/main/README.md",
        "https://github.com/YOUR-USERNAME/simple-interest-calculator/blob/main/README.md",
        "https://github.com/YOUR-GITHUB-USERNAME/expressBookReviews/blob/main/final_project/router/general.js",
        "https://github.com/VOTRE_USER/expressBookReview/blob/main/router/general.js",
        "https://github.com/johndoe/simple-interest-calculator",
        "https://github.com/your-username/your-repository/blob/main/CODE_OF_CONDUCT.md",
      ])("flags the placeholder in %s without fetching", async (url) => {
        await expect(
          strategy.gradeResponse(question, url, context),
        ).rejects.toMatchObject({
          name: "SourceProcessingError",
          code: "url_placeholder",
        });
        expect(mockedFetch).not.toHaveBeenCalled();
      });

      it.each([
        "https://github.com/users/dustinjbabcock/projects/1/views/1",
        "https://github.com/guranisusmitha-stack/simple-interest-calculator/new/main",
        "https://github.com/o/r/issues",
        "https://github.com/o/r/pulls",
        "https://github.com/o/r/compare/main...dev",
        "https://github.com/orgs/acme/projects/3",
      ])("flags %s as a page we can't grade", async (url) => {
        await expect(
          strategy.gradeResponse(question, url, context),
        ).rejects.toMatchObject({ code: "url_unsupported" });
        expect(mockedFetch).not.toHaveBeenCalled();
      });

      it("still fetches a single issue", async () => {
        mockedFetch.mockResolvedValue({
          body: "Issue body",
          isFunctional: true,
        });
        llmFacadeService.gradeUrlBasedQuestion.mockResolvedValue({
          points: 1,
          feedback: "ok",
          gradingRationale: "ok",
        } as any);
        await strategy.gradeResponse(
          question,
          "https://github.com/o/r/issues/12",
          context,
        );
        expect(mockedFetch).toHaveBeenCalled();
      });

      it("tells the learner a 404 may be a private repository and names the link", async () => {
        mockedFetch.mockResolvedValue({
          body: "",
          isFunctional: false,
          failure: { code: "url_unreachable", httpStatus: 404 },
        });
        const url =
          "https://github.com/Blaziton456/e-plantScience/blob/main/README.md";
        const error = await strategy
          .gradeResponse(question, url, context)
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SourceProcessingError);
        const issue = (error as SourceProcessingError).toIssue(question.id);
        expect(issue).toMatchObject({
          questionId: 7924,
          code: "url_unreachable",
          retryable: false,
          source: { kind: "url", url, httpStatus: 404 },
        });
        expect(issue.message).toContain(url);
        expect(issue.message).toMatch(/private/i);
        expect(issue.message).toMatch(/public/i);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          "grading.source_processing.blocked",
          expect.objectContaining({
            attemptId: 1877610,
            assignmentId: 2561,
            questionId: 7924,
            code: "url_unreachable",
            host: "github.com",
            httpStatus: 404,
          }),
        );
      });

      it("passes the fetcher's blocked/empty classification through", async () => {
        mockedFetch.mockResolvedValue({
          body: "",
          isFunctional: false,
          failure: { code: "url_blocked", httpStatus: 403 },
        });
        await expect(
          strategy.gradeResponse(
            question,
            "https://www.indeed.com/q-Cyber-Security-Specialist-jobs.html",
            context,
          ),
        ).rejects.toMatchObject({
          code: "url_blocked",
          source: { httpStatus: 403 },
        });
      });

      it("says a missing course starter repository should be the learner's own copy", async () => {
        mockedFetch.mockResolvedValue({
          body: "",
          isFunctional: false,
          failure: { code: "url_unreachable", httpStatus: 404 },
        });
        const error = await strategy
          .gradeResponse(
            question,
            "https://github.com/ibm-developer-skills-network/github-final-project/blob/main/README.md",
            context,
          )
          .catch((caught: unknown) => caught as SourceProcessingError);
        expect(error.code).toBe("url_template_repo");
        expect(error.toIssue(question.id).message).toMatch(
          /starter repository.*your own copy/i,
        );
      });

      it("grades a readable starter-repository link as before", async () => {
        mockedFetch.mockResolvedValue({
          body: "# Starter",
          isFunctional: true,
        });
        llmFacadeService.gradeUrlBasedQuestion.mockResolvedValue({
          points: 0,
          feedback: "This is the template",
          gradingRationale: "template",
        } as any);
        await expect(
          strategy.gradeResponse(
            question,
            "https://github.com/ibm-developer-skills-network/github-final-project/blob/main/README.md",
            context,
          ),
        ).resolves.toBeDefined();
      });

      it("annotates a transient fetch failure with the question and the learner's link", async () => {
        const transient = new GithubRateLimitedError({
          owner: "o",
          repo: "r",
          requestUrl: "https://api.github.com/repos/o/r",
        });
        mockedFetch.mockRejectedValue(transient);
        await expect(
          strategy.gradeResponse(question, "https://github.com/o/r", context),
        ).rejects.toBe(transient);
        expect(transient.questionId).toBe(7924);
        expect(transient.learnerUrl).toBe("https://github.com/o/r");
      });

      it("only checks the source, without a model call, once the attempt is already blocked", async () => {
        mockedFetch.mockResolvedValue({ body: "code", isFunctional: true });
        const result = await strategy.gradeResponse(
          question,
          "https://github.com/o/r/blob/main/a.py",
          { ...context, sourceCheckOnly: true },
        );
        expect(result).toBeDefined();
        expect(llmFacadeService.gradeUrlBasedQuestion).not.toHaveBeenCalled();
        expect(gradingAuditService.recordGrading).not.toHaveBeenCalled();
      });
    });
  });
});
