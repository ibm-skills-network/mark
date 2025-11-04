/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/require-await */
import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import {
  ChoiceBasedFeedbackDto,
  CreateQuestionResponseAttemptResponseDto,
  GeneralFeedbackDto,
  TrueFalseBasedFeedbackDto,
} from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { AttemptHelper } from "src/api/assignment/attempt/helper/attempts.helper";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { FileUploadQuestionEvaluateModel } from "src/api/llm/model/file.based.question.evaluate.model";
import { Logger } from "winston";
import { IGradingJudgeService } from "../../../llm/features/grading/interfaces/grading-judge.interface";
import { GRADING_JUDGE_SERVICE } from "../../../llm/llm.constants";
import {
  FILE_CONTENT_EXTRACTION_SERVICE,
  GRADING_AUDIT_SERVICE,
} from "../../attempt.constants";
import {
  ExtractedFileContent,
  FileContentExtractionService,
} from "../../services/file-content-extraction";
import { GradingAuditService } from "../../services/question-response/grading-audit.service";
import { LearnerFileUpload } from "../interfaces/attempt.interface";
import { GradingContext } from "../interfaces/grading-context.interface";
import { LocalizationService } from "../utils/localization.service";
import { AbstractGradingStrategy } from "./abstract-grading.strategy";

@Injectable()
export class FileGradingStrategy extends AbstractGradingStrategy<
  LearnerFileUpload[]
> {
  constructor(
    private readonly llmFacadeService: LlmFacadeService,
    @Inject(FILE_CONTENT_EXTRACTION_SERVICE)
    private readonly fileContentExtractionService: FileContentExtractionService,
    protected readonly localizationService: LocalizationService,
    @Inject(GRADING_AUDIT_SERVICE)
    protected readonly gradingAuditService: GradingAuditService,
    @Optional()
    @Inject(GRADING_JUDGE_SERVICE)
    protected readonly gradingJudgeService?: IGradingJudgeService,
    @Optional() @Inject(WINSTON_MODULE_PROVIDER) parentLogger?: Logger,
  ) {
    super(
      localizationService,
      gradingAuditService,
      undefined,
      gradingJudgeService,
      parentLogger,
    );
  }

  /**
   * Validate that the request contains valid file uploads
   */
  async validateResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<boolean> {
    if (
      !requestDto.learnerFileResponse ||
      requestDto.learnerFileResponse.length === 0
    ) {
      throw new BadRequestException(
        this.localizationService.getLocalizedString(
          "expectedFileResponse",
          requestDto.language,
        ),
      );
    }

    for (const file of requestDto.learnerFileResponse) {
      const hasStorageMetadata = file.key && file.bucket && file.filename;
      const hasGithubMetadata = file.githubUrl && file.filename;

      if (!hasStorageMetadata && !hasGithubMetadata) {
        console.error(
          `Invalid file metadata for ${file.filename || "unknown file"}:`,
          file,
        );
        throw new BadRequestException(
          `Invalid file metadata for ${file.filename || "unknown file"}`,
        );
      }
    }

    return true;
  }

  /**
   * Extract the file response from the request
   */
  async extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<LearnerFileUpload[]> {
    return requestDto.learnerFileResponse;
  }

  /**
   * Grade the file response using LLM with extracted content
   */
  async gradeResponse(
    question: QuestionDto,
    learnerResponse: LearnerFileUpload[],
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    const extractedFiles =
      await this.fileContentExtractionService.extractContentFromFiles(
        learnerResponse,
      );

    const processedFiles = await this.processExtractedFiles(
      extractedFiles,
      learnerResponse,
    );

    const fileUploadQuestionEvaluateModel = new FileUploadQuestionEvaluateModel(
      question.question,
      context.questionAnswerContext,
      context.assignmentInstructions,
      processedFiles,
      question.totalPoints,
      question.scoring?.type ?? "",
      question.scoring,
      question.type,
      question.responseType ?? "OTHER",
    );

    const gradingModel = await this.llmFacadeService.gradeFileBasedQuestion(
      fileUploadQuestionEvaluateModel,
      context.assignmentId,
      context.language,
    );

    let responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(gradingModel, responseDto);

    let rubricSum = 0;

    if (Array.isArray(responseDto.metadata?.rubricScores)) {
      for (const score of responseDto.metadata.rubricScores) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
        const points = score.pointsAwarded ?? score.points ?? score.score ?? 0;
        if (typeof points === "number") {
          rubricSum += points;
        }
      }

      if (rubricSum === responseDto.totalPoints) {
        this.logger?.info("Math is already consistent in FileGradingStrategy", {
          questionId: question.id,
          totalPoints: responseDto.totalPoints,
          rubricSum,
        });
      } else {
        this.logger?.warn(
          "Mathematical inconsistency detected - correcting total points",
          {
            questionId: question.id,
            originalTotal: responseDto.totalPoints,
            rubricSum,
            rubricScores: responseDto.metadata.rubricScores,
          },
        );

        const originalTotal = responseDto.totalPoints;
        responseDto.totalPoints = rubricSum;
        responseDto.metadata.mathCorrected = true;
        responseDto.metadata.originalTotal = originalTotal;

        this.logger?.info("Applied math correction in FileGradingStrategy", {
          questionId: question.id,
          correctedFrom: originalTotal,
          correctedTo: rubricSum,
        });
      }
    }

    responseDto = await this.iterativeGradingWithJudge(
      question,
      learnerResponse,
      responseDto,
      context,
    );

    responseDto.metadata = {
      ...responseDto.metadata,
      fileCount: learnerResponse.length,
      fileTypes: [
        ...new Set(
          extractedFiles.map(
            (file) =>
              file.filename.split(".").pop()?.toLowerCase() || "unknown",
          ),
        ),
      ],
      totalFileSize: extractedFiles.reduce(
        (sum, file) => sum + (file.metadata?.size || 0),
        0,
      ),
      extractionStatus: this.getExtractionStatus(extractedFiles),
    };

    try {
      await this.recordGrading(
        question,
        {
          learnerFileResponse: learnerResponse,
        } as CreateQuestionResponseAttemptRequestDto,
        responseDto,
        context,
        "FileGradingStrategy",
      );
    } catch (error) {
      this.logger?.error("Grading audit failed but continuing with grading", {
        questionId: question.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      responseDto.metadata = {
        ...responseDto.metadata,
        auditFailure: {
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        },
      };
    }

    return responseDto;
  }

  /**
   * Process extracted files and combine with original metadata
   */
  private async processExtractedFiles(
    extractedFiles: ExtractedFileContent[],
    originalFiles: LearnerFileUpload[],
  ): Promise<LearnerFileUpload[]> {
    return extractedFiles.map((extracted, index) => {
      const original = originalFiles[index];

      return {
        ...original,
        content: extracted.content,
        extractedText: extracted.extractedText,
        contentSummary: this.generateContentSummary(extracted),
        metadata: {
          ...extracted.metadata,
          originalContent: original.content,
          extractionMethod: this.getExtractionMethod(extracted.filename),
        },
      };
    });
  }

  /**
   * Generate a content summary for the extracted file
   */
  private generateContentSummary(extracted: ExtractedFileContent): string {
    const fileExtension =
      extracted.filename.split(".").pop()?.toLowerCase() || "";
    const contentLength = extracted.content.length;
    const hasCode = this.detectCodeContent(extracted.content);

    let summary = `${extracted.filename} (${fileExtension.toUpperCase()})`;

    if (contentLength > 0) {
      summary += ` - ${contentLength} characters`;

      if (hasCode) {
        const language = this.detectProgrammingLanguage(extracted.filename);
        summary += `, ${language} code detected`;
      }

      if (
        extracted.extractedText &&
        extracted.extractedText !== extracted.content
      ) {
        summary += `, with extracted text content`;
      }
    } else {
      summary += " - empty or binary file";
    }

    return summary;
  }

  /**
   * Detect if content contains code
   */
  private detectCodeContent(content: string): boolean {
    const codePatterns = [
      /function\s+\w+\s*\(/,
      /class\s+\w+/,
      /import\s+.*from/,
      /\w+\s*=\s*\w+\s*=>/,
      /#include\s*</,
      /public\s+class/,
      /def\s+\w+\s*\(/,
      /\$\w+\s*=/,
      /document\.\w+/,
      /console\.\w+/,
    ];

    return codePatterns.some((pattern) => pattern.test(content));
  }

  /**
   * Detect programming language from filename and content
   */
  private detectProgrammingLanguage(filename: string): string {
    const extension = filename.split(".").pop()?.toLowerCase() || "";

    const languageMap: Record<string, string> = {
      js: "JavaScript",
      ts: "TypeScript",
      tsx: "TypeScript React",
      jsx: "JavaScript React",
      py: "Python",
      java: "Java",
      cpp: "C++",
      c: "C",
      cs: "C#",
      php: "PHP",
      rb: "Ruby",
      go: "Go",
      rs: "Rust",
      swift: "Swift",
      kt: "Kotlin",
      scala: "Scala",
      html: "HTML",
      css: "CSS",
      scss: "SCSS",
      sql: "SQL",
    };

    return languageMap[extension] || "Unknown";
  }

  /**
   * Get extraction method used for the file
   */
  private getExtractionMethod(filename: string): string {
    const extension = filename.split(".").pop()?.toLowerCase() || "";

    if (
      ["txt", "js", "ts", "py", "html", "css", "json", "xml"].includes(
        extension,
      )
    ) {
      return "plain-text";
    } else if (["pdf"].includes(extension)) {
      return "pdf-extraction";
    } else if (["docx", "doc"].includes(extension)) {
      return "word-extraction";
    } else if (["xlsx", "xls", "csv"].includes(extension)) {
      return "spreadsheet-extraction";
    } else if (["jpg", "png", "gif"].includes(extension)) {
      return "ocr-extraction";
    } else {
      return "binary-fallback";
    }
  }

  /**
   * Get extraction status summary
   */
  private getExtractionStatus(extractedFiles: ExtractedFileContent[]): {
    successful: number;
    failed: number;
    partial: number;
  } {
    let successful = 0;
    let failed = 0;
    let partial = 0;

    for (const file of extractedFiles) {
      if (file.content.startsWith("[ERROR:")) {
        failed++;
      } else if (
        file.content.startsWith("[") &&
        file.content.includes("extraction requires")
      ) {
        partial++;
      } else {
        successful++;
      }
    }

    return { successful, failed, partial };
  }

  /**
   * Create a summary of learner response for judge validation
   */
  private createLearnerResponseSummary(
    learnerResponse: LearnerFileUpload[],
  ): string {
    const fileNames = learnerResponse.map((file) => file.filename).join(", ");
    const contentSummary = learnerResponse
      .map(
        (file) => `${file.filename} - ${file.content?.length || 0} characters`,
      )
      .join("; ");

    return `Files uploaded: ${fileNames}. Content: ${contentSummary}`;
  }

  /**
   * Iteratively improve grading with judge validation
   * Preserves initial rubric scores and only adjusts feedback to prevent math inconsistencies
   */
  private async iterativeGradingWithJudge(
    question: QuestionDto,
    learnerResponse: LearnerFileUpload[],
    initialResponseDto: CreateQuestionResponseAttemptResponseDto,
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    const maxAttempts = 3;
    let currentResponseDto = initialResponseDto;
    let attempt = 1;
    let previousJudgeFeedback = "";

    const originalRubricScores = currentResponseDto.metadata?.rubricScores
      ? JSON.parse(JSON.stringify(currentResponseDto.metadata.rubricScores))
      : [];

    if (!this.gradingJudgeService) {
      this.logger?.debug("Judge service not available for iterative grading", {
        questionId: question.id,
      });
      return currentResponseDto;
    }

    while (attempt <= maxAttempts) {
      this.logger?.info(`Judge validation attempt ${attempt}/${maxAttempts}`, {
        questionId: question.id,
        currentPoints: currentResponseDto.totalPoints,
        maxPoints: question.totalPoints,
      });

      try {
        this.logger?.debug("Debug: Rubric scores for judge validation", {
          questionId: question.id,
          attempt,
          hasMetadata: !!currentResponseDto.metadata,
          metadataKeys: currentResponseDto.metadata
            ? Object.keys(currentResponseDto.metadata)
            : [],
          rubricScoresLength:
            currentResponseDto.metadata?.rubricScores?.length || 0,
          rubricScores: currentResponseDto.metadata?.rubricScores || [],
        });

        const judgeResult = await this.gradingJudgeService.validateGrading({
          question: question.question,
          learnerResponse: this.createLearnerResponseSummary(learnerResponse),
          scoringCriteria: question.scoring,
          proposedGrading: {
            points: currentResponseDto.totalPoints,
            maxPoints: question.totalPoints,
            feedback: JSON.stringify(currentResponseDto.feedback),
            rubricScores: currentResponseDto.metadata?.rubricScores || [],
          },
          assignmentId: context.assignmentId,
        });

        if (judgeResult.approved) {
          this.logger?.info(`Judge approved grading on attempt ${attempt}`, {
            questionId: question.id,
            finalPoints: currentResponseDto.totalPoints,
            attempts: attempt,
          });

          currentResponseDto.metadata = {
            ...currentResponseDto.metadata,
            judgeValidated: true,
            judgeApproved: true,
            validationAttempts: attempt,
            judgeFeedback: judgeResult.feedback,
          };

          return currentResponseDto;
        }

        const judgeFeedback = this.formatJudgeFeedback(
          judgeResult,
          previousJudgeFeedback,
        );
        previousJudgeFeedback = judgeResult.feedback;

        this.logger?.warn(`Judge rejected grading on attempt ${attempt}`, {
          questionId: question.id,
          issues: judgeResult.issues,
          suggestedPoints: judgeResult.corrections?.points,
          judgeFeedback: judgeResult.feedback,
        });

        if (attempt === maxAttempts) {
          this.logger?.warn(
            "Max attempts reached, applying judge corrections",
            {
              questionId: question.id,
              originalPoints: currentResponseDto.totalPoints,
              judgePoints: judgeResult.corrections?.points,
            },
          );

          if (judgeResult.corrections?.points !== undefined) {
            currentResponseDto.totalPoints = judgeResult.corrections.points;
          }
          if (judgeResult.corrections?.feedback) {
            currentResponseDto.feedback = [
              {
                feedback: judgeResult.corrections.feedback,
              },
            ];
          }

          currentResponseDto.metadata = {
            ...currentResponseDto.metadata,
            judgeValidated: true,
            judgeApproved: false,
            validationAttempts: attempt,
            judgeFeedback: judgeResult.feedback,
            judgeOverride: true,
            judgeIssues: judgeResult.issues,
          };

          return currentResponseDto;
        }

        this.logger?.info("Adjusting feedback only, preserving rubric scores", {
          questionId: question.id,
          attempt: attempt + 1,
          judgeFeedback: judgeFeedback,
          preservedRubricCount: originalRubricScores.length,
        });

        const improvedResponseDto =
          new CreateQuestionResponseAttemptResponseDto();

        let correctTotal = 0;

        for (const score of originalRubricScores) {
          const points =
            score.pointsAwarded ?? score.points ?? score.score ?? 0;
          if (typeof points === "number") {
            correctTotal += points;
          }
        }

        improvedResponseDto.totalPoints = correctTotal;
        improvedResponseDto.metadata = {
          ...currentResponseDto.metadata,
          rubricScores: originalRubricScores,
          judgeIterationAttempt: attempt,
          preservedRubricScores: true,
          mathCorrectedInJudge: true,
        };

        const enhancedFeedback = this.createEnhancedFeedback(
          currentResponseDto.feedback,
          judgeFeedback,
        );
        improvedResponseDto.feedback = enhancedFeedback;

        currentResponseDto = improvedResponseDto;
        attempt++;
      } catch (error) {
        this.logger?.error(`Judge validation failed on attempt ${attempt}`, {
          questionId: question.id,
          error: error instanceof Error ? error.message : String(error),
        });

        currentResponseDto.metadata = {
          ...currentResponseDto.metadata,
          judgeValidated: false,
          validationError:
            error instanceof Error ? error.message : String(error),
          validationAttempts: attempt,
        };

        return currentResponseDto;
      }
    }

    return currentResponseDto;
  }

  /**
   * Create enhanced feedback without changing rubric scores
   */
  private createEnhancedFeedback(
    originalFeedback:
      | ChoiceBasedFeedbackDto[]
      | GeneralFeedbackDto[]
      | TrueFalseBasedFeedbackDto[],
    judgeFeedback: string,
  ): any[] {
    try {
      const enhancedFeedback = [...(originalFeedback || [])];

      enhancedFeedback.push({
        feedback: `**Additional Feedback Based on Quality Review:**\n${judgeFeedback}`,
      });

      return enhancedFeedback;
    } catch (error) {
      this.logger?.warn("Failed to enhance feedback, using original", {
        error: error instanceof Error ? error.message : String(error),
      });
      return originalFeedback || [];
    }
  }

  /**
   * Format judge feedback for re-grading
   */
  private formatJudgeFeedback(
    judgeResult: {
      issues?: string[];
      feedback?: string;
      corrections?: {
        points?: number;
        feedback?: string;
      };
      approved?: boolean;
      validationAttempts?: number;
      judgeFeedback?: string;
      judgeIssues?: string[];
      judgeOverride?: boolean;
    },
    previousFeedback: string,
  ): string {
    let feedback = `Previous grading was rejected by the judge. Issues identified:\n`;

    if (Array.isArray(judgeResult.issues)) {
      feedback +=
        judgeResult.issues
          .map((issue: string, index: number) => `${index + 1}. ${issue}`)
          .join("\n") + "\n";
    }

    if (judgeResult.feedback) {
      feedback += `\nJudge feedback: ${judgeResult.feedback}\n`;
    }

    if (judgeResult.corrections?.points !== undefined) {
      feedback += `\nSuggested points: ${judgeResult.corrections.points}\n`;
    }

    if (previousFeedback) {
      feedback += `\nPrevious feedback: ${previousFeedback}\n`;
    }

    feedback += `\nPlease revise the grading to address these issues and ensure it aligns with the rubric.`;

    return feedback;
  }
}
