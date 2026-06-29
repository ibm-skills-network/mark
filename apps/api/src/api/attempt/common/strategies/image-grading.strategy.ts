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
import { UnsupportedImageFormatError } from "src/api/llm/features/grading/errors/unsupported-image-format.error";
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
        this.logger?.warn(
          `Grading inconsistency detected: feedback mentions ${totalPointsInFeedback} points but grade is ${validatedPoints}`,
          {
            feedback_points: totalPointsInFeedback,
            grade_points: validatedPoints,
            max_points: maxPoints,
          },
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

    // For inline base64 (Path-A) images, sniff the real magic bytes so an
    // unsupported format that the vision model can neither grade nor convert
    // (HEIC, SVG, or unrecognizable data) is rejected with a fast 400 at
    // submission time rather than burning a grading job on a deterministic
    // failure. COS/key-only entries have no inline bytes here and are sniffed
    // later, at grade time.
    if (imageData && imageData !== "InCos") {
      const detectedFormat = this.sniffRejectedFormat(imageData);
      if (detectedFormat) {
        // Throw the typed learner-facing error, not a BadRequestException.
        // validateResponse also runs at grade time (inside
        // gradeQuestionNoSave); a BadRequestException there is not a
        // LearnerFacingGradingError, so it gets wrapped and retried instead of
        // failing terminally with the learner message. Every boundary
        // (autosave 400, gradeQuestionNoSave passthrough, worker terminal
        // no-retry) already translates this typed error correctly.
        throw new UnsupportedImageFormatError({
          filename: image.filename,
          detectedFormat,
          reason: "unsupported format detected at submission",
        });
      }
    }
  }

  // Inspects the leading bytes of an inline base64 data URL and returns the
  // detected MIME type only when it is one the grading pipeline must reject
  // (heic/svg/unrecognized). Convertible formats (bmp/tiff/avif) and the
  // directly-gradable raster formats (jpeg/png/gif/webp) return undefined so
  // they pass validation and are handled downstream. Mirrors the magic-byte
  // logic in ImageGradingService; the duplication is intentional — this is the
  // submission-layer guard and stays decoupled from the grading service.
  private sniffRejectedFormat(imageData: string): string | undefined {
    const markerIndex = imageData.indexOf(";base64,");
    // Only data URLs carry the marker and decodable bytes. Anything else
    // (raw key references, opaque placeholders) is left for the grade-time
    // detector — there is nothing to sniff here.
    if (markerIndex === -1) {
      return undefined;
    }

    // The signature fits well within the first chunk; decode a small prefix
    // rather than the whole payload.
    const base64Prefix = imageData.slice(markerIndex + 8, markerIndex + 8 + 96);
    let header: Buffer;
    try {
      header = Buffer.from(base64Prefix, "base64");
    } catch {
      // Undecodable base64 is itself an unrecognized format.
      return "unknown";
    }

    if (header.length < 4) {
      return "unknown";
    }

    const detected = this.detectMimeFromBytes(header);

    // Directly-gradable or convertible formats pass; only the reject set and
    // unrecognized data are surfaced.
    const passes =
      detected === "image/jpeg" ||
      detected === "image/png" ||
      detected === "image/gif" ||
      detected === "image/webp" ||
      detected === "image/bmp" ||
      detected === "image/tiff" ||
      detected === "image/avif";
    if (passes) {
      return undefined;
    }

    return detected ?? "unknown";
  }

  // Magic-byte sniffing over a decoded header buffer. Recognizes the raster
  // formats the grading pipeline can pass through (jpeg/png/gif/webp) or
  // convert (bmp/tiff/avif), plus the ones it must reject (heic/svg).
  private detectMimeFromBytes(buffer: Buffer): string | null {
    if (buffer.length < 4) return null;

    const firstBytes = buffer.subarray(0, 12);

    if (firstBytes[0] === 0xFF && firstBytes[1] === 0xD8) {
      return "image/jpeg";
    }

    if (
      firstBytes[0] === 0x89 &&
      firstBytes[1] === 0x50 &&
      firstBytes[2] === 0x4E &&
      firstBytes[3] === 0x47
    ) {
      return "image/png";
    }

    if (
      firstBytes[0] === 0x47 &&
      firstBytes[1] === 0x49 &&
      firstBytes[2] === 0x46
    ) {
      return "image/gif";
    }

    // WEBP is a RIFF container — check before BMP/TIFF.
    if (
      firstBytes[0] === 0x52 &&
      firstBytes[1] === 0x49 &&
      firstBytes[2] === 0x46 &&
      firstBytes[3] === 0x46 &&
      firstBytes[8] === 0x57 &&
      firstBytes[9] === 0x45 &&
      firstBytes[10] === 0x42 &&
      firstBytes[11] === 0x50
    ) {
      return "image/webp";
    }

    if (firstBytes[0] === 0x42 && firstBytes[1] === 0x4D) {
      return "image/bmp";
    }

    // TIFF: little-endian "II*\0" or big-endian "MM\0*".
    if (
      (firstBytes[0] === 0x49 &&
        firstBytes[1] === 0x49 &&
        firstBytes[2] === 0x2A &&
        firstBytes[3] === 0x00) ||
      (firstBytes[0] === 0x4D &&
        firstBytes[1] === 0x4D &&
        firstBytes[2] === 0x00 &&
        firstBytes[3] === 0x2A)
    ) {
      return "image/tiff";
    }

    // ISO-BMFF (HEIC/AVIF): "ftyp" box at offset 4, brand at offset 8.
    if (
      firstBytes[4] === 0x66 &&
      firstBytes[5] === 0x74 &&
      firstBytes[6] === 0x79 &&
      firstBytes[7] === 0x70
    ) {
      const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
      if (
        brand.includes("heic") ||
        brand.includes("heix") ||
        brand.includes("hevc") ||
        brand.includes("mif1") ||
        brand.includes("msf1")
      ) {
        return "image/heic";
      }
      if (brand.includes("avif") || brand.includes("avis")) {
        return "image/avif";
      }
    }

    // SVG: leading whitespace, an optional XML prolog, then an "<svg" tag.
    if (this.looksLikeSvg(buffer)) {
      return "image/svg+xml";
    }

    return null;
  }

  private looksLikeSvg(buffer: Buffer): boolean {
    const head = buffer
      .subarray(0, 512)
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .trimStart();
    const withoutProlog = head.startsWith("<?xml")
      ? head.slice(head.indexOf("?>") + 2).trimStart()
      : head;
    return /^<svg[\s>]/i.test(withoutProlog) || withoutProlog.startsWith("<svg");
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
