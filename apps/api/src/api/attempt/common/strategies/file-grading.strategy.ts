/* eslint-disable @typescript-eslint/require-await */
import { BadRequestException, Injectable } from "@nestjs/common";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { AttemptHelper } from "src/api/assignment/attempt/helper/attempts.helper";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { FileUploadQuestionEvaluateModel } from "src/api/llm/model/file.based.question.evaluate.model";
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
    private readonly fileContentExtractionService: FileContentExtractionService,
    protected readonly localizationService: LocalizationService,
    protected readonly gradingAuditService: GradingAuditService,
  ) {
    super(localizationService, gradingAuditService);
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

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(gradingModel, responseDto);

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
        const language = this.detectProgrammingLanguage(
          extracted.filename,
          extracted.content,
        );
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
  private detectProgrammingLanguage(filename: string, content: string): string {
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
}
