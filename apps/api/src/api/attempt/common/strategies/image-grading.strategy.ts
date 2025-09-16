/* eslint-disable @typescript-eslint/require-await */
import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { QuestionType, ResponseType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { AttemptHelper } from "src/api/assignment/attempt/helper/attempts.helper";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { ScoringType } from "src/api/assignment/question/dto/create.update.question.request.dto";
import { ImageGradingService } from "src/api/llm/features/grading/services/image-grading.service";
import {
  ImageAnalysisResult,
  ImageBasedQuestionEvaluateModel,
  LearnerImageUpload,
} from "src/api/llm/model/image.based.evalutate.model";
import { ImageBasedQuestionResponseModel } from "src/api/llm/model/image.based.response.model";
import { Logger } from "winston";
import { GRADING_AUDIT_SERVICE } from "../../attempt.constants";
import { GradingAuditService } from "../../services/question-response/grading-audit.service";
import { GradingContext } from "../interfaces/grading-context.interface";
import { LocalizationService } from "../utils/localization.service";
import { AbstractGradingStrategy } from "./abstract-grading.strategy";

// Interface for raw image upload data from request
interface RawImageUpload {
  filename: string;
  imageData?: string;
  content?: string; // legacy field name for imageData
  imageKey?: string;
  key?: string; // legacy field name for imageKey
  imageBucket?: string;
  bucket?: string; // legacy field name for imageBucket
  imageUrl?: string;
  mimeType?: string;
  fileType?: string; // legacy field name for mimeType
  imageAnalysisResult?: ImageAnalysisResult;
}

@Injectable()
export class ImageGradingStrategy extends AbstractGradingStrategy<
  LearnerImageUpload[]
> {
  constructor(
    private readonly imageGradingService: ImageGradingService,
    protected readonly localizationService: LocalizationService,
    @Inject(GRADING_AUDIT_SERVICE)
    protected readonly gradingAuditService: GradingAuditService,
    @Optional() @Inject(WINSTON_MODULE_PROVIDER) parentLogger?: Logger,
  ) {
    super(
      localizationService,
      gradingAuditService,
      undefined,
      undefined,
      parentLogger,
    );
  }

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
          "expectedImageResponse",
          requestDto.language,
        ),
      );
    }

    console.log(
      `Validating ${requestDto.learnerFileResponse.length} images for question ${question.id}`,
    );

    // Validate each image
    for (const image of requestDto.learnerFileResponse) {
      this.validateSingleImage(image as RawImageUpload);
    }

    return true;
  }

  async extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<LearnerImageUpload[]> {
    if (
      !requestDto.learnerFileResponse ||
      requestDto.learnerFileResponse.length === 0
    ) {
      throw new BadRequestException("No images provided for grading");
    }

    const learnerImages: LearnerImageUpload[] = [];

    for (const image of requestDto.learnerFileResponse) {
      const rawImage = image as RawImageUpload;

      if (!rawImage.filename) {
        throw new BadRequestException("Image filename is required");
      }

      // Handle both new and legacy field names
      const imageData = rawImage.imageData ?? rawImage.content;
      const imageKey = rawImage.imageKey ?? rawImage.key;
      const imageBucket = rawImage.imageBucket ?? rawImage.bucket;

      const learnerImage: LearnerImageUpload = {
        filename: rawImage.filename,
        imageUrl: rawImage.imageUrl || "",
        // Only set imageData if it's not the "InCos" placeholder
        imageData: imageData && imageData !== "InCos" ? imageData : "",
        imageBucket: imageBucket,
        imageKey: imageKey,
        mimeType:
          rawImage.mimeType ||
          rawImage.fileType ||
          this.getMimeTypeFromFilename(rawImage.filename),
        imageAnalysisResult:
          rawImage.imageAnalysisResult || this.createDefaultAnalysisResult(),
      };

      learnerImages.push(learnerImage);
    }

    console.log(`Extracted ${learnerImages.length} images for grading`);
    return learnerImages;
  }

  async gradeResponse(
    question: QuestionDto,
    learnerResponse: LearnerImageUpload[],
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    if (!learnerResponse || learnerResponse.length === 0) {
      throw new BadRequestException("No valid images found for grading");
    }

    const textualResponse = this.extractTextualResponse(learnerResponse);

    console.log(
      `Grading question ${question.id} with ${learnerResponse.length} images`,
    );

    const primaryImage = learnerResponse[0];
    const imageBasedQuestionEvaluateModel = new ImageBasedQuestionEvaluateModel(
      question.question,
      context.questionAnswerContext ?? [],
      context.assignmentInstructions ?? "",
      learnerResponse,
      question.totalPoints,
      question.scoring?.type ?? "POINTS",
      question.scoring ?? { type: ScoringType.CRITERIA_BASED, rubrics: [] },
      question.type ?? QuestionType.UPLOAD,
      question.responseType ?? ResponseType.OTHER,
      primaryImage.imageData,
      textualResponse,
    );

    // Grade using the image grading service
    const gradingResult =
      await this.imageGradingService.gradeImageBasedQuestion(
        imageBasedQuestionEvaluateModel,
        context.assignmentId,
      );

    // Validate the grading result
    const validatedResult = this.validateGradingConsistencyImage(
      gradingResult,
      question,
    );

    // Create response DTO
    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(validatedResult, responseDto);

    // Enhanced metadata
    responseDto.metadata = {
      ...responseDto.metadata,
      imageCount: learnerResponse.length,
      primaryImageFilename: primaryImage.filename,
      imageFormats: learnerResponse.map((img) =>
        this.getImageFormat(img.filename),
      ),
      totalImageSize: this.calculateTotalImageSize(learnerResponse),
      gradingTimestamp: new Date().toISOString(),
      hasTextualResponse: Boolean(textualResponse),
      gradingValidated: true,
      maxPossiblePoints: question.totalPoints,
      scoringType: question.scoring?.type || "POINTS",
    };

    console.log(
      `Successfully graded question ${question.id} - awarded ${responseDto.totalPoints}/${question.totalPoints} points`,
    );

    await this.recordGrading(
      question,
      {
        learnerFileResponse: learnerResponse,
      } as CreateQuestionResponseAttemptRequestDto,
      responseDto,
      context,
      "ImageGradingStrategy",
    );

    return responseDto;
  }
  private validateGradingConsistencyImage(
    response: ImageBasedQuestionResponseModel,
    question: QuestionDto,
  ): ImageBasedQuestionResponseModel {
    const points = response.points || 0;
    const feedback = response.feedback || "";
    const maxPoints = question.totalPoints || 0;

    // Ensure points are within valid range
    const validatedPoints = Math.min(Math.max(points, 0), maxPoints);

    // Check if feedback mentions specific point values
    const pointsInFeedback = this.extractPointsFromFeedback(feedback);

    if (pointsInFeedback.length > 0) {
      const totalPointsInFeedback = pointsInFeedback.reduce(
        (sum, p) => sum + p,
        0,
      );

      // If there's a significant discrepancy, log it and potentially adjust
      if (Math.abs(totalPointsInFeedback - validatedPoints) > 1) {
        console.warn(
          `Grading inconsistency detected: feedback mentions ${totalPointsInFeedback} points but grade is ${validatedPoints}`,
        );

        // If the feedback points are more reasonable, use those
        if (totalPointsInFeedback <= maxPoints && totalPointsInFeedback >= 0) {
          return {
            points: totalPointsInFeedback,
            feedback: this.enhanceFeedbackConsistency(
              feedback,
              totalPointsInFeedback,
              maxPoints,
            ),
          };
        }
      }
    }

    // Enhance feedback to ensure it's consistent with the points awarded
    const enhancedFeedback = this.enhanceFeedbackConsistency(
      feedback,
      validatedPoints,
      maxPoints,
    );

    return {
      points: validatedPoints,
      feedback: enhancedFeedback,
    };
  }
  private extractPointsFromFeedback(feedback: string): number[] {
    const points: number[] = [];

    // Look for patterns specifically for final scores, avoiding intermediate scores
    const patterns = [
      /(?:total\s*score|final\s*score|overall\s*score):\s*(\d+)/gi,
      /(?:awarded|final\s*grade):\s*(\d+)\s*(?:points?|pts?)?$/gi,
      /^(?:score|total):\s*(\d+)\s*(?:\/\s*\d+)?/gm, // Line starting with score
      /(\d+)\s*(?:points?|pts?)\s*(?:out\s*of|\/)\s*\d+\s*(?:total|maximum)?$/gi, // Final score format
    ];

    for (const pattern of patterns) {
      const matches = feedback.matchAll(pattern);
      for (const match of matches) {
        const point = Number.parseInt(match[1], 10);
        if (!Number.isNaN(point) && point >= 0) {
          points.push(point);
        }
      }
    }

    // If no specific final score patterns found, avoid parsing intermediate scores
    // to prevent the false positive warnings

    return points;
  }

  private enhanceFeedbackConsistency(
    originalFeedback: string,
    awardedPoints: number,
    maxPoints: number,
  ): string {
    let enhancedFeedback = originalFeedback;

    // If feedback doesn't clearly state the final score, add it
    const hasScoreMention =
      /(?:total|final|score|awarded).*?(\d+).*?(?:points?|\/)/i.test(
        originalFeedback,
      );

    if (!hasScoreMention) {
      enhancedFeedback += `\n\nFinal Score: ${awardedPoints}/${maxPoints} points`;
    }

    // Add percentage if helpful
    const percentage = Math.round((awardedPoints / maxPoints) * 100);
    if (
      !enhancedFeedback.includes("%") &&
      !enhancedFeedback.includes("percent")
    ) {
      enhancedFeedback += ` (${percentage}%)`;
    }

    // Ensure the feedback tone matches the score
    const scoreRatio = awardedPoints / maxPoints;
    if (scoreRatio >= 0.9 && !this.containsPositiveLanguage(originalFeedback)) {
      enhancedFeedback = "Excellent work! " + enhancedFeedback;
    } else if (
      scoreRatio <= 0.5 &&
      !this.containsImprovementLanguage(originalFeedback)
    ) {
      enhancedFeedback +=
        " Consider reviewing the requirements and resubmitting with the missing elements.";
    }

    return enhancedFeedback;
  }

  private containsPositiveLanguage(feedback: string): boolean {
    const positiveWords = [
      "excellent",
      "great",
      "good",
      "well done",
      "perfect",
      "outstanding",
      "impressive",
    ];
    return positiveWords.some((word) => feedback.toLowerCase().includes(word));
  }

  private containsImprovementLanguage(feedback: string): boolean {
    const improvementWords = [
      "improve",
      "missing",
      "lacks",
      "needs",
      "consider",
      "should",
      "could",
    ];
    return improvementWords.some((word) =>
      feedback.toLowerCase().includes(word),
    );
  }
  private validateSingleImage(image: RawImageUpload): void {
    // Handle both new and legacy field names
    const imageData = image.imageData ?? image.content;
    const imageKey = image.imageKey ?? image.key;
    const imageBucket = image.imageBucket ?? image.bucket;

    // "InCos" means no direct content, should use storage reference
    const hasDirectContent = Boolean(
      (imageData && imageData !== "InCos") || image.imageUrl,
    );
    const hasCOSReference = Boolean(imageKey && imageBucket);

    console.log(`Validating image ${image.filename}:`, {
      imageData: imageData
        ? imageData === "InCos"
          ? "InCos (no direct content)"
          : "has content"
        : "none",
      imageUrl: image.imageUrl || "none",
      imageKey: imageKey || "none",
      imageBucket: imageBucket || "none",
      hasDirectContent,
      hasCOSReference,
    });

    if (!hasDirectContent && !hasCOSReference) {
      throw new BadRequestException(
        `Invalid image metadata for ${image.filename}: provide either content/imageUrl or key+bucket`,
      );
    }

    if (!this.isValidImageFormat(image.filename)) {
      throw new BadRequestException(
        `Unsupported image format for ${image.filename}`,
      );
    }

    // Validate file size if available (skip "InCos" placeholder)
    if (
      imageData &&
      imageData !== "InCos" &&
      this.isBase64TooLarge(imageData)
    ) {
      throw new BadRequestException(
        `Image ${image.filename} exceeds maximum size limit`,
      );
    }
  }

  private extractTextualResponse(
    learnerResponse: LearnerImageUpload[],
  ): string {
    // Extract any detected text from image analysis
    const detectedTexts = learnerResponse
      .flatMap((img) => img.imageAnalysisResult?.detectedText || [])
      .map((textInfo) => textInfo.text)
      .filter((text) => text && text.trim().length > 0);

    return detectedTexts.join(" ").trim();
  }

  private createDefaultAnalysisResult(): ImageAnalysisResult {
    return {
      width: 0,
      height: 0,
      aspectRatio: 0,
      fileSize: 0,
      dominantColors: [],
      detectedObjects: [],
      detectedText: [],
      sceneType: "unknown",
      rawDescription: "",
    };
  }

  private isValidImageFormat(filename: string): boolean {
    console.log(`Checking image format for filename: ${filename}`);
    const supportedFormats = [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "bmp",
      "webp",
      "tiff",
    ];
    const extension = filename.split(".").pop()?.toLowerCase() || "";
    return supportedFormats.includes(extension);
  }

  private getMimeTypeFromFilename(filename: string): string {
    const extension = filename.split(".").pop()?.toLowerCase() || "";
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      bmp: "image/bmp",
      webp: "image/webp",
      tiff: "image/tiff",
      svg: "image/svg+xml",
    };

    return mimeMap[extension] || "image/jpeg";
  }

  private getImageFormat(filename: string): string {
    return filename.split(".").pop()?.toLowerCase() || "unknown";
  }

  private calculateTotalImageSize(images: LearnerImageUpload[]): number {
    let total = 0;
    for (const img of images) {
      if (img.imageData) {
        const base64Data = img.imageData.replace(
          /^data:image\/[a-z]+;base64,/,
          "",
        );
        total += Math.floor((base64Data.length * 3) / 4);
      } else {
        total += img.imageAnalysisResult?.fileSize || 0;
      }
    }
    return total;
  }

  private isBase64TooLarge(base64Data: string): boolean {
    const maxSizeMB = 20;
    const sizeInBytes = Math.floor((base64Data.length * 3) / 4);
    return sizeInBytes > maxSizeMB * 1024 * 1024;
  }
}
