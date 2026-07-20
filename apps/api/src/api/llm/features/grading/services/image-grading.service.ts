/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable unicorn/no-null */
/* eslint-disable unicorn/number-literal-case */
import { PromptTemplate } from "@langchain/core/prompts";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import sharp from "sharp";
import { StructuredOutputParser } from "@langchain/classic/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { ScoringDto } from "src/api/assignment/dto/update.questions.request.dto";
import { S3Service } from "src/api/files/services/s3.service";
import {
  ImageBasedQuestionEvaluateModel,
  LearnerImageUpload,
} from "src/api/llm/model/image.based.evalutate.model";
import { ImageBasedQuestionResponseModel } from "src/api/llm/model/image.based.response.model";
import { Logger } from "winston";
import { z } from "zod";
import { IModerationService } from "../../../core/interfaces/moderation.interface";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import {
  LLM_RESOLVER_SERVICE,
  MODERATION_SERVICE,
  PROMPT_PROCESSOR,
} from "../../../llm.constants";
import { LLMResolverService } from "../../../core/services/llm-resolver.service";
import { UnsupportedImageFormatError } from "../errors/unsupported-image-format.error";
import { IImageGradingService } from "../interfaces/image-grading.interface";
import { EvidenceChunkingService } from "./evidence-chunking.service";
import { CriterionEvidencePipelineService } from "./criterion-evidence-pipeline.service";
import { RubricCriterion } from "../types/criterion-evidence.types";
import { MODERATION_BLOCK_FEEDBACK } from "../constants";

interface ProcessedImageData {
  buffer: Buffer;
  mimeType: string;
  size: number;
  base64: string;
}

@Injectable()
export class ImageGradingService implements IImageGradingService {
  private readonly logger: Logger;

  // Upper bound on the bytes handed to sharp for format conversion. Convertible
  // formats (bmp/tiff/avif) above this are rejected rather than decoded, so a
  // hostile or accidental large file cannot drive unbounded decoder allocation.
  private static readonly MAX_CONVERTIBLE_IMAGE_BYTES = 50 * 1024 * 1024;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
    private readonly chunkingService: EvidenceChunkingService,
    private readonly evidencePipeline: CriterionEvidencePipelineService,
    @Inject(LLM_RESOLVER_SERVICE)
    private readonly llmResolver: LLMResolverService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
    private readonly s3Service: S3Service,
  ) {
    this.logger = parentLogger.child({ context: ImageGradingService.name });
  }

  async gradeImageBasedQuestion(
    model: ImageBasedQuestionEvaluateModel,
    assignmentId: number,
  ): Promise<ImageBasedQuestionResponseModel> {
    const {
      question,
      imageData: topImageData,
      imageBucket: topBucket,
      imageKey: topKey,
      learnerResponse,
      totalPoints,
      scoringCriteriaType,
      scoringCriteria,
      previousQuestionsAnswersContext,
      assignmentInstrctions,
      learnerImageResponse: rawImages,
      safetyIdentifier,
    } = model;

    const learnerImages: LearnerImageUpload[] = this.normalizeLearnerImages(
      rawImages ?? [],
    );

    this.validateInputs(
      question,
      learnerResponse,
      topImageData,
      learnerImages,
      topBucket,
      topKey,
      totalPoints,
    );

    const contentToModerate =
      typeof learnerResponse === "string"
        ? learnerResponse
        : JSON.stringify(learnerResponse);
    // Moderate the uploaded images too — they go to the vision model and
    // were previously never checked. Only URL-shaped or data-URL values
    // are accepted by the moderations endpoint.
    const imageUrlsForModeration = [
      topImageData,
      ...learnerImages.map((img) => img.imageData || img.imageUrl),
    ].filter(
      (url): url is string =>
        !!url && (url.startsWith("http") || url.startsWith("data:")),
    );
    const moderationVerdict = await this.moderationService.assessContent(
      contentToModerate,
      imageUrlsForModeration,
    );
    if (moderationVerdict.action === "block_severe") {
      this.logger.warn("grading.moderation.blocked_severe", {
        assignmentId,
        categories: moderationVerdict.severeCategories,
      });
      return {
        points: 0,
        feedback: MODERATION_BLOCK_FEEDBACK,
      } as ImageBasedQuestionResponseModel;
    }
    if (moderationVerdict.action === "allow_with_log") {
      this.logger.warn("grading.moderation.flagged", {
        assignmentId,
        categories: moderationVerdict.flaggedCategories,
      });
    }

    const maxTotalPoints = this.calculateMaxPoints(
      scoringCriteria,
      totalPoints,
    );
    this.logger.info(
      `Calculated max total points: ${maxTotalPoints} for assignment ${assignmentId}`,
    );

    const rubricCriteria = this.convertToRubricCriteria(scoringCriteria);

    // Criteria-based grading scores against OCR evidence extracted from the
    // learner's images, not the image bytes — so it must not fetch or preflight
    // the primary image. Resolving (and preflighting) the image is deferred
    // below this branch so a COS-stored HEIC still grades here off its text.
    if (scoringCriteriaType === "CRITERIA_BASED" && rubricCriteria.length > 0) {
      const chunks = this.chunkingService.extractFromImages(learnerImages);

      const pipelineResult = await this.evidencePipeline.gradeWithEvidence({
        question,
        criteria: rubricCriteria,
        chunks,
        assignmentId,
        maxConcurrency: 4,
        maxRetries: 3,
        modelOverrides: {
          retrievalModel: "gpt-5-nano",
          gradingModel: "gpt-5-mini",
          judgeModel: "gpt-5-mini",
        },
      });

      return this.buildImageResponseFromPipeline(
        pipelineResult,
        maxTotalPoints,
      );
    }

    // Determine (before fetching) whether the specific source that will
    // resolve as the primary image was already covered by the up-front gate
    // above. The gate only accepts http/data: shaped strings, so it misses
    // two distinct cases that resolve through the exact same precedence as
    // getPrimaryImageForGrading: an image fetched from COS storage
    // (bucket/key, arriving as the "InCos" sentinel), and a learner image
    // submitted as raw/bare base64 with no "data:" prefix — the latter looks
    // "inline" but was filtered out of imageUrlsForModeration and would
    // otherwise reach the vision model unmoderated.
    const primaryNeedsPostResolveModeration =
      !this.primaryImageCoveredByUpfrontModeration(
        topImageData,
        topBucket,
        topKey,
        learnerImages,
      );

    const primaryImage = await this.getPrimaryImageForGrading(
      topImageData,
      topBucket,
      topKey,
      learnerImages,
    );

    if (primaryNeedsPostResolveModeration) {
      const postResolveModerationVerdict =
        await this.moderationService.assessContent("", [primaryImage.base64]);
      if (postResolveModerationVerdict.action === "block_severe") {
        this.logger.warn("grading.moderation.blocked_severe", {
          assignmentId,
          categories: postResolveModerationVerdict.severeCategories,
        });
        return {
          points: 0,
          feedback: MODERATION_BLOCK_FEEDBACK,
        } as ImageBasedQuestionResponseModel;
      }
      if (postResolveModerationVerdict.action === "allow_with_log") {
        this.logger.warn("grading.moderation.flagged", {
          assignmentId,
          categories: postResolveModerationVerdict.flaggedCategories,
        });
      }
    }

    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        points: z
          .number()
          .describe("Total points awarded based on all rubric criteria"),
        feedback: z
          .string()
          .describe(
            "Comprehensive feedback following the AEEG approach (Analyze, Evaluate, Explain, Guide)",
          )
          .optional(),
        analysis: z
          .string()
          .describe(
            "Detailed analysis of what is observed in the submitted image, including technical quality, composition, and content",
          ),
        evaluation: z
          .string()
          .describe(
            "Evaluation of how well the image meets each rubric criterion with specific scores",
          ),
        explanation: z
          .string()
          .describe(
            "Clear reasons for the grade based on specific visual evidence from the image",
          ),
        guidance: z
          .string()
          .describe(
            "Concrete suggestions for improvement in future image submissions",
          ),
        rubricScores: z
          .array(
            z.object({
              rubricQuestion: z.string(),
              pointsAwarded: z.number(),
              maxPoints: z.number(),
              justification: z.string(),
            }),
          )
          .describe("Individual scores for each rubric criterion")
          .optional(),
      }),
    );

    const formatInstructions = parser.getFormatInstructions();
    const templateVariables = {
      question: () => String(question || ""),
      assignment_instructions: () => String(assignmentInstrctions || ""),
      learner_response: () =>
        typeof learnerResponse === "string"
          ? learnerResponse
          : JSON.stringify(learnerResponse || ""),
      previous_questions_and_answers: () =>
        JSON.stringify(previousQuestionsAnswersContext || []),
      total_points: () => String(maxTotalPoints || 0),
      scoring_type: () => scoringCriteriaType,
      scoring_criteria: () => JSON.stringify(scoringCriteria),
      format_instructions: () => formatInstructions,
    };

    const gradingPrompt = new PromptTemplate({
      template: `
You are an expert educator evaluating a student's image submission using the AEEG (Analyze, Evaluate, Explain, Guide) approach.

QUESTION:
{question}

ASSIGNMENT INSTRUCTIONS:
{assignment_instructions}

PREVIOUS QUESTIONS AND ANSWERS:
{previous_questions_and_answers}

LEARNER'S TEXT RESPONSE (if any):
{learner_response}

SCORING INFORMATION:
Total Points Available: {total_points}
Scoring Type: {scoring_type}
Scoring Criteria: {scoring_criteria}

CRITICAL GRADING INSTRUCTIONS:
You MUST grade according to the EXACT rubric provided in the scoring criteria. If the scoring type is "CRITERIA_BASED" with rubrics:
1. Evaluate the image against EACH rubric question provided
2. Award points based ONLY on the criteria descriptions provided for each rubric
3. For images, be particularly strict about quality - basic snapshots should receive low scores
4. For each rubric, select the criterion that best matches the image quality and award those exact points
5. The total points awarded must equal the sum of points from all rubrics
6. NO GRADE INFLATION - high scores only for exceptional, creative, or technically proficient images

GRADING APPROACH (AEEG):

1. ANALYZE: Carefully examine the image and describe what you observe
   - Describe the subject matter and composition of the image
   - Note technical qualities (lighting, focus, clarity, resolution)
   - Identify creative elements or artistic choices
   - Observe how well the image addresses the assignment requirements
   - Assess the level of effort and skill demonstrated
   - Focus analysis on aspects relevant to the rubric criteria

2. EVALUATE: For each rubric question in the scoring criteria:
   - Read the rubric question carefully
   - Examine how the image addresses each criterion
   - Compare the image quality against each criterion level
   - Be strict: basic snapshots get low scores, exceptional work gets high scores
   - Select the criterion that honestly matches the image quality
   - Award the exact points specified for that criterion
   - Do NOT average or adjust points - use the exact values provided

3. EXPLAIN: Provide clear reasons for the grade based on specific visual evidence
   - Focus on what the learner DID or DID NOT include in their image
   - For each rubric, explain what specific visual elements are present or absent
   - If criteria are fully met: Point out what was correctly demonstrated in the image
   - If criteria are partially met: State what was included AND what specific elements are missing
   - If criteria are NOT met: Explain what specific visual qualities or content are absent
   - Reference specific visual elements from the image (e.g., "The composition includes X", "The image lacks Y")
   - Do NOT state criterion requirements or start with "Criterion requires..."
   - Focus on the image itself, not what the rubric asks for
   - Ensure the total points equal the sum of all rubric scores

4. GUIDE: Offer concrete suggestions for improvement
   - Frame as actionable guidance: "The image should include..." or "Consider adding..."
   - Provide specific techniques to improve image quality (e.g., "Add better lighting", "Use rule of thirds")
   - Suggest composition or technical improvements based on what's missing
   - Recommend creative approaches relevant to the assignment
   - Offer practical tips for developing stronger visual content
   - NO encouragement, NO praise - focus on concrete improvement steps

GRADING STANDARDS FOR IMAGES (STRICTLY ENFORCED):
- Exceptional (90-100%): Outstanding creativity, technical excellence, fully meets all requirements
- Good (75-89%): Strong technical quality, good creativity, meets most requirements well
- Satisfactory (60-74%): Acceptable quality, some creativity, meets basic requirements
- Needs Improvement (40-59%): Basic quality, minimal creativity, partially meets requirements
- Poor (0-39%): Low quality, no creativity, doesn't meet requirements, or just a simple snapshot

Remember: Most casual photographs should score in the "Needs Improvement" or "Satisfactory" range unless they demonstrate exceptional qualities.

Make sure your feedback is short and concise.

Respond with a JSON object containing:
- Points awarded (sum of all rubric scores)
- Separate fields for each AEEG component (analysis, evaluation, explanation, guidance)
- If scoring type is CRITERIA_BASED, include rubricScores array with score for each rubric

{format_instructions}
      `.trim(),
      inputVariables: [],
      partialVariables: templateVariables,
    });

    try {
      const modelKey = await this.llmResolver.getModelKeyWithFallback(
        "image_grading",
        "gpt-4.1-mini",
      );
      this.logger.debug(
        `Using model ${modelKey} for image_grading feature (assignment ${assignmentId})`,
      );

      let llmOut: string;
      try {
        llmOut = await this.promptProcessor.processPromptWithImage(
          gradingPrompt,
          primaryImage.base64,
          assignmentId,
          AIUsageType.ASSIGNMENT_GRADING,
          modelKey,
          { safetyIdentifier },
        );
      } catch (visionError) {
        // Only the vision call's own errors can mean the provider rejected the
        // image. Scope the unsupported-format remap to here so a downstream
        // parser exception that merely embeds the words "unsupported image" in
        // echoed LLM output cannot be mistaken for a format rejection.
        if (
          visionError instanceof Error &&
          /unsupported image|invalid_image_format/i.test(visionError.message)
        ) {
          this.logger.warn("image.grading.vision.unsupported", {
            error: visionError.message,
            stack: visionError.stack,
          });
          throw new UnsupportedImageFormatError({
            reason: visionError.message.slice(0, 200),
          });
        }
        throw visionError;
      }

      const parsed = await parser.parse(llmOut);

      let finalPoints = parsed.points;
      if (finalPoints > maxTotalPoints) {
        this.logger.warn(
          `LLM awarded ${finalPoints} points, which exceeds maximum of ${maxTotalPoints}. Capping at maximum.`,
        );
        finalPoints = maxTotalPoints;
      } else if (finalPoints < 0) {
        this.logger.warn(
          `LLM awarded negative points (${finalPoints}). Setting to 0.`,
        );
        finalPoints = 0;
      }

      const aeegFeedback = `
**Analysis:**
${parsed.analysis}

**Evaluation:**
${parsed.evaluation}

**Explanation:**
${parsed.explanation}

**Guidance:**
${parsed.guidance}

**Final Score: ${finalPoints}/${maxTotalPoints} points**
`.trim();

      this.logger.info(
        `Graded image question ${assignmentId} - awarded ${finalPoints}/${maxTotalPoints} points (${Math.round(
          (finalPoints / maxTotalPoints) * 100,
        )}%)`,
      );

      return {
        points: finalPoints,
        feedback: aeegFeedback,
      } as ImageBasedQuestionResponseModel;
    } catch (error) {
      // A format rejection is the learner's to fix, not a system fault:
      // surface it intact so the worker can fail terminally and show the
      // learner-facing message instead of a generic 500.
      if (error instanceof UnsupportedImageFormatError) {
        throw error;
      }

      this.logger.error(
        `Error processing image grading: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      throw new HttpException(
        "Failed to grade image-based question",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private calculateMaxPoints(
    scoringCriteria: ScoringDto,
    totalPoints: number,
  ): number {
    if (!scoringCriteria?.rubrics || !Array.isArray(scoringCriteria.rubrics)) {
      this.logger.debug("No rubrics found, using totalPoints:", totalPoints);
      return totalPoints || 0;
    }

    let sum = 0;
    for (const rubric of scoringCriteria.rubrics) {
      if (Array.isArray(rubric.criteria)) {
        const maxCriteriaPoints = Math.max(
          ...rubric.criteria.map((criterion) => criterion.points || 0),
        );
        sum += maxCriteriaPoints;
        this.logger.debug(
          `Rubric "${rubric.rubricQuestion}" max points: ${maxCriteriaPoints}`,
        );
      }
    }

    this.logger.debug(`Total calculated max points: ${sum}`);
    return sum > 0 ? sum : totalPoints || 0;
  }

  private normalizeLearnerImages(rawImages: unknown[]): LearnerImageUpload[] {
    return rawImages.map((img) => {
      interface ImageAnalysisResult {
        width?: number;
        height?: number;
        aspectRatio?: number;
        fileSize?: number;
      }

      const image = img as {
        filename?: string;
        imageAnalysisResult?: ImageAnalysisResult;
        imageData?: string;
        content?: string;
        imageUrl?: string;
        imageKey?: string;
        key?: string;
        imageBucket?: string;
        bucket?: string;
        mimeType?: string;
        fileType?: string;
      };

      const imageData = image.imageData ?? image.content;
      const imageKey = image.imageKey ?? image.key;
      const imageBucket = image.imageBucket ?? image.bucket;
      const analysis: ImageAnalysisResult = image.imageAnalysisResult ?? {};

      return {
        filename: image.filename ?? "",
        imageAnalysisResult: {
          width: analysis.width ?? 0,
          height: analysis.height ?? 0,
          aspectRatio: analysis.aspectRatio ?? 0,
          fileSize: analysis.fileSize ?? 0,
        },
        imageData: imageData && imageData !== "InCos" ? imageData : "",
        imageUrl: image.imageUrl ?? "",
        imageKey: imageKey ?? "",
        imageBucket: imageBucket ?? "",
        mimeType: image.mimeType ?? image.fileType ?? "",
      };
    });
  }

  private validateInputs(
    question: string,
    learnerResponse: any,
    topImageData: string,
    learnerImages: LearnerImageUpload[],
    topBucket: string,
    topKey: string,
    totalPoints: number,
  ): void {
    if (!question) {
      throw new HttpException("Missing question", HttpStatus.BAD_REQUEST);
    }

    const hasImageData =
      topImageData || learnerImages.length > 0 || (topBucket && topKey);
    if (!learnerResponse && !hasImageData) {
      throw new HttpException(
        "No image or response provided",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (totalPoints == undefined || totalPoints < 0) {
      throw new HttpException("Invalid totalPoints", HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Mirrors the branch selection in getPrimaryImageForGrading, without doing
   * any fetching, purely to know whether the up-front imageUrlsForModeration
   * gate (built earlier from topImageData and each learner image's
   * imageData/imageUrl) already saw the specific value that will resolve as
   * the primary image. That gate only accepts http/data: shaped strings, so
   * it returns false — meaning a post-resolve moderation check is still
   * required — for two cases that share the same resolution branch:
   *  - COS storage (bucket/key): imageData arrives as the "InCos" sentinel
   *    (normalized to "" by normalizeLearnerImages), which fails the filter.
   *  - Raw/bare base64 with no "data:" prefix: a truthy, non-"InCos" string
   *    that still fails the http/data: filter, so it was excluded from the
   *    up-front list even though it resolves as an inline image.
   */
  private primaryImageCoveredByUpfrontModeration(
    topImageData: string,
    topBucket: string,
    topKey: string,
    learnerImages: LearnerImageUpload[],
  ): boolean {
    let source: string | undefined;

    if (topImageData && topImageData !== "InCos") {
      source = topImageData;
    } else if (learnerImages.length > 0) {
      const firstImage = learnerImages[0];
      if (firstImage.imageData && firstImage.imageData !== "InCos") {
        source = firstImage.imageData;
      } else {
        // Resolves via COS storage (bucket/key) — never in the up-front list.
        return false;
      }
    } else {
      // Resolves via COS storage (topBucket/topKey) — never in the up-front
      // list. If neither is set either, there is no valid image source and
      // getPrimaryImageForGrading throws before this value is ever used.
      return !(topBucket && topKey);
    }

    return source.startsWith("http") || source.startsWith("data:");
  }

  private async getPrimaryImageForGrading(
    topImageData: string,
    topBucket: string,
    topKey: string,
    learnerImages: LearnerImageUpload[],
  ): Promise<ProcessedImageData> {
    if (topImageData && topImageData !== "InCos") {
      return await this.processDirectImageData(topImageData);
    }

    if (learnerImages.length > 0) {
      const firstImage = learnerImages[0];

      if (firstImage.imageData && firstImage.imageData !== "InCos") {
        return await this.processDirectImageData(firstImage.imageData);
      }

      if (firstImage.imageBucket && firstImage.imageKey) {
        return await this.fetchImageFromStorage(
          firstImage.imageBucket,
          firstImage.imageKey,
          firstImage.filename || undefined,
        );
      }

      throw new HttpException(
        `Image ${firstImage.filename} has no valid content or storage reference`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (topBucket && topKey) {
      return await this.fetchImageFromStorage(topBucket, topKey);
    }

    throw new HttpException(
      "No valid image source found",
      HttpStatus.BAD_REQUEST,
    );
  }

  private async fetchImageFromStorage(
    bucket: string,
    key: string,
    filename?: string,
  ): Promise<ProcessedImageData> {
    try {
      this.logger.debug(`Fetching image from storage: ${bucket}/${key}`);

      const object = await this.s3Service.getObject({
        Bucket: bucket,
        Key: key,
      });

      const rawBuffer = Buffer.isBuffer(object.Body)
        ? object.Body
        : await this.streamToBuffer(object.Body as NodeJS.ReadableStream);

      // Convert or reject based on the real bytes before encoding, so the
      // data URL sent to the vision model carries a correct, accepted mime.
      // The learner's upload filename (never the opaque storage key) is passed
      // through so a format rejection names a file the learner recognizes.
      const { buffer, mimeType } = await this.preflightImageBuffer(
        rawBuffer,
        filename,
      );
      const base64 = `data:${mimeType};base64,${buffer.toString("base64")}`;

      return { buffer, mimeType, size: buffer.length, base64 };
    } catch (error) {
      // Format rejection is the learner's to fix; surface it intact so the
      // caller can translate it into a learner-facing terminal failure.
      if (error instanceof UnsupportedImageFormatError) {
        throw error;
      }
      this.logger.error(`Failed to fetch image: ${bucket}/${key}`, error);
      throw new HttpException(
        `Could not retrieve image: ${key}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async processDirectImageData(
    imageData: string | Buffer,
  ): Promise<ProcessedImageData> {
    if (
      typeof imageData === "string" &&
      (!imageData || imageData === "InCos")
    ) {
      throw new HttpException(
        "No valid image data provided",
        HttpStatus.BAD_REQUEST,
      );
    }

    // Decode to the raw bytes regardless of how the data arrived. A malformed
    // data URL with no comma yields no base64 segment; coalesce to "" so the
    // empty buffer routes into the typed rejection below instead of throwing a
    // TypeError from Buffer.from(undefined).
    let rawBuffer: Buffer;
    if (typeof imageData === "string") {
      const base64Data = imageData.startsWith("data:")
        ? (imageData.split(",")[1] ?? "")
        : imageData;
      rawBuffer = Buffer.from(base64Data, "base64");
    } else {
      rawBuffer = imageData;
    }

    // Convert or reject from the real bytes, then re-encode the (possibly
    // converted) buffer so the data URL carries the post-preflight mime. No
    // learner filename is available on the direct-data path.
    const { buffer, mimeType } = await this.preflightImageBuffer(rawBuffer);
    const base64 = `data:${mimeType};base64,${buffer.toString("base64")}`;

    return { buffer, mimeType, size: buffer.length, base64 };
  }

  async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      stream.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }

  /**
   * The vision model rejects images past its per-image size/dimension limits —
   * a large lossless PNG screenshot base64-encodes past the provider's cap and
   * comes back as an "unsupported image" error, which the caller then relabels
   * as a format problem and tells the learner to upload a PNG they already
   * uploaded. Downscale oversized pass-through rasters here so the model always
   * receives a within-limits image. Images already within limits, or ones sharp
   * can't process, are returned untouched.
   */
  private async normalizeOversizedImage(
    buffer: Buffer,
    detected: string,
    filename?: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    // Vision providers downscale beyond ~1568px on the long edge anyway; staying
    // under ~4MB keeps the base64 payload below the per-image ceiling.
    const MAX_EDGE_PX = 1568;
    const MAX_BYTES = 4 * 1024 * 1024;
    // Escalating lossy fallback for the rare image that stays over the byte cap
    // even after the dimension clamp — a dense photo or near-incompressible
    // content whose lossless PNG is still too large at 1568px. At that size a
    // JPEG lands well under the cap; the descending steps are a backstop.
    const JPEG_QUALITY_STEPS = [80, 60];

    try {
      const metadata = await sharp(buffer).metadata();
      const longestEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0);
      if (buffer.length <= MAX_BYTES && longestEdge <= MAX_EDGE_PX) {
        return { buffer, mimeType: detected };
      }

      const resized = await sharp(buffer)
        .resize(MAX_EDGE_PX, MAX_EDGE_PX, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();

      // The dimension clamp satisfies the pixel limit but never shrinks the
      // bytes of an image that was already within the edge cap, so a lossless
      // PNG can still exceed the byte ceiling. Re-encode the downscaled raster
      // as JPEG at descending quality until it fits. The lossless PNG is kept
      // for the common case; we go lossy only when losslessness cannot meet the
      // byte cap, where a rejected image would be the alternative.
      if (resized.length > MAX_BYTES) {
        let lossy = resized;
        // Tracks the quality that produced the returned buffer; the loop always
        // overwrites it, starting from the first (highest-quality) step.
        let jpegQuality = JPEG_QUALITY_STEPS[0];
        for (const quality of JPEG_QUALITY_STEPS) {
          // JPEG has no alpha channel; flatten a transparent PNG onto white
          // (the neutral background for a screenshot) so it does not composite
          // onto black.
          lossy = await sharp(resized)
            .flatten({ background: "#ffffff" })
            .jpeg({ quality })
            .toBuffer();
          jpegQuality = quality;
          if (lossy.length <= MAX_BYTES) {
            break;
          }
        }
        this.logger.info("image.grading.downscaled", {
          filename,
          detectedFormat: detected,
          outputFormat: "image/jpeg",
          jpegQuality,
          fromBytes: buffer.length,
          toBytes: lossy.length,
        });
        if (lossy.length > MAX_BYTES) {
          // Not reachable for a 1568px image at these qualities, but never
          // silently hand the model an over-cap image without a trace.
          this.logger.warn("image.grading.downscale.over.cap", {
            filename,
            detectedFormat: detected,
            toBytes: lossy.length,
          });
        }
        return { buffer: lossy, mimeType: "image/jpeg" };
      }

      this.logger.info("image.grading.downscaled", {
        filename,
        detectedFormat: detected,
        outputFormat: "image/png",
        fromBytes: buffer.length,
        toBytes: resized.length,
      });
      return { buffer: resized, mimeType: "image/png" };
    } catch (error) {
      // Fall back to the original bytes rather than newly failing an image that
      // would otherwise have been sent to the model as-is.
      this.logger.warn("image.grading.downscale.failed", {
        filename,
        detectedFormat: detected,
        error: error instanceof Error ? error.message : String(error),
      });
      return { buffer, mimeType: detected };
    }
  }

  /**
   * Magic-byte sniffing only — no filename input. Recognizes the raster
   * formats the grading pipeline can either pass through (jpeg/png/gif/webp)
   * or convert (bmp/tiff/avif), plus the ones it must reject (heic/svg).
   */
  private detectMimeFromBytes(buffer: Buffer): string | null {
    if (buffer.length < 4) return null;

    const firstBytes = buffer.subarray(0, 12);

    if (firstBytes[0] === 0xff && firstBytes[1] === 0xd8) {
      return "image/jpeg";
    }

    if (
      firstBytes[0] === 0x89 &&
      firstBytes[1] === 0x50 &&
      firstBytes[2] === 0x4e &&
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

    // WEBP is a RIFF container: "RIFF" at offset 0 and "WEBP" at offset 8.
    // Its full signature is disjoint from the BMP/TIFF prefixes, so the order
    // relative to them carries no correctness constraint.
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

    if (firstBytes[0] === 0x42 && firstBytes[1] === 0x4d) {
      return "image/bmp";
    }

    // TIFF: little-endian "II*\0" or big-endian "MM\0*".
    if (
      (firstBytes[0] === 0x49 &&
        firstBytes[1] === 0x49 &&
        firstBytes[2] === 0x2a &&
        firstBytes[3] === 0x00) ||
      (firstBytes[0] === 0x4d &&
        firstBytes[1] === 0x4d &&
        firstBytes[2] === 0x00 &&
        firstBytes[3] === 0x2a)
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
    // Inspect only the leading bytes; an SVG root tag appears very early.
    // Strip a leading UTF-8 BOM (U+FEFF), then leading whitespace. trimStart
    // alone treats U+FEFF as whitespace, but the explicit strip documents it.
    const head = buffer
      .subarray(0, 512)
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .trimStart();
    const withoutProlog = head.startsWith("<?xml")
      ? head.slice(head.indexOf("?>") + 2).trimStart()
      : head;
    return (
      /^<svg[\s>]/i.test(withoutProlog) || withoutProlog.startsWith("<svg")
    );
  }

  /**
   * Validates and normalizes an image buffer before it is sent to the vision
   * model. The model accepts only png/jpeg/gif/webp; bmp/tiff/avif are
   * transcoded to PNG, and heic/svg/unrecognizable data are rejected with a
   * typed, learner-facing error (HEIC is rejected rather than converted
   * because the prebuilt sharp binary ships without libheif HEIC decode).
   * Returns the (possibly converted) buffer alongside its post-preflight MIME
   * type so callers can build a correctly-labeled data URL.
   */
  private async preflightImageBuffer(
    buffer: Buffer,
    filename?: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const detected = this.detectMimeFromBytes(buffer);

    if (
      detected === "image/png" ||
      detected === "image/jpeg" ||
      detected === "image/gif" ||
      detected === "image/webp"
    ) {
      return await this.normalizeOversizedImage(buffer, detected, filename);
    }

    if (
      detected === "image/bmp" ||
      detected === "image/tiff" ||
      detected === "image/avif"
    ) {
      // Cap the bytes handed to sharp: a convertible format that is also huge
      // would otherwise let the decoder allocate unbounded memory. Pass-through
      // formats are not capped here — upstream upload limits own those.
      if (buffer.length > ImageGradingService.MAX_CONVERTIBLE_IMAGE_BYTES) {
        this.logger.warn("image.grading.convert.too.large", {
          filename,
          detectedFormat: detected,
          bytes: buffer.length,
        });
        throw new UnsupportedImageFormatError({
          filename,
          detectedFormat: detected,
          reason: "image too large to convert",
        });
      }

      let converted: Buffer;
      try {
        converted = await sharp(buffer).png().toBuffer();
      } catch (error) {
        // A file whose first bytes sniff as a convertible format but whose
        // body is corrupt/truncated makes sharp throw a raw error (also its
        // pixel-limit rejection). Translate it into the same typed, logged,
        // learner-facing failure instead of letting it escape as a 500.
        this.logger.error("image.grading.convert.failed", {
          filename,
          detectedFormat: detected,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw new UnsupportedImageFormatError({
          filename,
          detectedFormat: detected,
          reason: "image data could not be decoded for conversion",
        });
      }

      this.logger.info("image.grading.converted", {
        filename,
        detectedFormat: detected,
      });
      return { buffer: converted, mimeType: "image/png" };
    }

    const detectedFormat = detected ?? "unknown";
    this.logger.warn("image.grading.unsupported", {
      filename,
      detectedFormat,
    });
    throw new UnsupportedImageFormatError({
      filename,
      detectedFormat,
      reason:
        detected === "image/heic"
          ? "HEIC images cannot be graded by the vision model"
          : detected === "image/svg+xml"
            ? "SVG images cannot be graded by the vision model"
            : "Unrecognized image data",
    });
  }

  private convertToRubricCriteria(
    scoringCriteria?: ScoringDto,
  ): RubricCriterion[] {
    if (!scoringCriteria || !Array.isArray(scoringCriteria.rubrics)) {
      return [];
    }

    return scoringCriteria.rubrics.map((rubric, index) => {
      const maxPoints = Math.max(
        ...rubric.criteria.map((criterion) => criterion.points || 0),
      );

      return {
        id: `rubric-${index + 1}`,
        rubricQuestion: rubric.rubricQuestion || `Criterion ${index + 1}`,
        description: rubric.rubricQuestion || `Criterion ${index + 1}`,
        criteria: rubric.criteria.map((criterion) => ({
          description: criterion.description,
          points: criterion.points,
        })),
        maxPoints: maxPoints || 0,
      };
    });
  }

  private buildImageResponseFromPipeline(
    pipelineResult: {
      grades: Array<{
        rubricQuestion: string;
        pointsAwarded: number;
        maxPoints: number;
        rationale: string;
      }>;
      summary: { totalPoints: number; maxPoints: number };
      audit: unknown;
    },
    maxPoints: number,
  ): ImageBasedQuestionResponseModel {
    const feedbackLines = pipelineResult.grades.map(
      (grade) =>
        `**${grade.rubricQuestion}** (${grade.pointsAwarded}/${grade.maxPoints})\n${grade.rationale}`,
    );
    const feedback = feedbackLines.join("\n\n");

    return {
      points: Math.min(pipelineResult.summary.totalPoints, maxPoints),
      feedback,
      aspectFeedback: pipelineResult.grades.map((grade) => ({
        aspect: grade.rubricQuestion,
        score: grade.pointsAwarded,
        maxPoints: grade.maxPoints,
        feedback: grade.rationale,
      })),
      metadata: pipelineResult.audit
        ? {
            gradingAudit: pipelineResult.audit,
          }
        : undefined,
    };
  }
}
