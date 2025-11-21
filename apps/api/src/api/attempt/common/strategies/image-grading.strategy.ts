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

interface RawImageUpload {
  filename: string;
  imageData?: string;
  content?: string;
  imageKey?: string;
  key?: string;
  imageBucket?: string;
  bucket?: string;
  imageUrl?: string;
  mimeType?: string;
  fileType?: string;
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

      const imageData = rawImage.imageData ?? rawImage.content;
      const imageKey = rawImage.imageKey ?? rawImage.key;
      const imageBucket = rawImage.imageBucket ?? rawImage.bucket;

      const learnerImage: LearnerImageUpload = {
        filename: rawImage.filename,
        imageUrl: rawImage.imageUrl || "",
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

    const gradingResult =
      await this.imageGradingService.gradeImageBasedQuestion(
        imageBasedQuestionEvaluateModel,
        context.assignmentId,
      );

    const validatedResult = this.validateGradingConsistencyImage(
      gradingResult,
      question,
    );

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(validatedResult, responseDto);

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

    const validatedPoints = Math.min(Math.max(points, 0), maxPoints);

    const pointsInFeedback = this.extractPointsFromFeedback(feedback);

    if (pointsInFeedback.length > 0) {
      const totalPointsInFeedback = pointsInFeedback.reduce(
        (sum, p) => sum + p,
        0,
      );

      if (Math.abs(totalPointsInFeedback - validatedPoints) > 1) {
        console.warn(
          `Grading inconsistency detected: feedback mentions ${totalPointsInFeedback} points but grade is ${validatedPoints}`,
        );

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

    const patterns = [
      /(?:total\s*score|final\s*score|overall\s*score):\s*(\d+)/gi,
      /(?:awarded|final\s*grade):\s*(\d+)\s*(?:points?|pts?)?$/gi,
      /^(?:score|total):\s*(\d+)\s*(?:\/\s*\d+)?/gm,
      /(\d+)\s*(?:points?|pts?)\s*(?:out\s*of|\/)\s*\d+\s*(?:total|maximum)?$/gi,
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

    return points;
  }

  private enhanceFeedbackConsistency(
    originalFeedback: string,
    awardedPoints: number,
    maxPoints: number,
  ): string {
    let enhancedFeedback = originalFeedback;

    const hasScoreMention =
      /(?:total|final|score|awarded).*?(\d+).*?(?:points?|\/)/i.test(
        originalFeedback,
      );

    if (!hasScoreMention) {
      enhancedFeedback += `\n\nFinal Score: ${awardedPoints}/${maxPoints} points`;
    }

    const percentage = Math.round((awardedPoints / maxPoints) * 100);
    if (
      !enhancedFeedback.includes("%") &&
      !enhancedFeedback.includes("percent")
    ) {
      enhancedFeedback += ` (${percentage}%)`;
    }

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
    const imageData = image.imageData ?? image.content;
    const imageKey = image.imageKey ?? image.key;
    const imageBucket = image.imageBucket ?? image.bucket;

    const hasDirectContent = Boolean(
      (imageData && imageData !== "InCos") || image.imageUrl,
    );
    const hasCOSReference = Boolean(imageKey && imageBucket);

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
