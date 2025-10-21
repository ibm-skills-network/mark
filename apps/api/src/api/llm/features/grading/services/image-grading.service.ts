/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable unicorn/no-null */
/* eslint-disable unicorn/number-literal-case */
import { PromptTemplate } from "@langchain/core/prompts";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { StructuredOutputParser } from "langchain/output_parsers";
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
import { IImageGradingService } from "../interfaces/image-grading.interface";

interface ProcessedImageData {
  buffer: Buffer;
  mimeType: string;
  size: number;
  base64: string;
}

@Injectable()
export class ImageGradingService implements IImageGradingService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(MODERATION_SERVICE)
    private readonly moderationService: IModerationService,
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

    await this.moderateContent(learnerResponse);

    const primaryImage = await this.getPrimaryImageForGrading(
      topImageData,
      topBucket,
      topKey,
      learnerImages,
    );

    const maxTotalPoints = this.calculateMaxPoints(
      scoringCriteria,
      totalPoints,
    );
    this.logger.info(
      `Calculated max total points: ${maxTotalPoints} for assignment ${assignmentId}`,
    );

    // Define output schema with AEEG structure
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
   - For each rubric, explain why you selected that specific criterion level
   - Reference specific visual elements that justify your scoring
   - Connect image qualities directly to the rubric descriptions
   - Be transparent about both strengths and weaknesses
   - Justify why higher criterion levels were not achieved
   - Ensure the total points equal the sum of all rubric scores

4. GUIDE: Offer concrete suggestions for improvement
   - Provide specific techniques to improve image quality
   - Suggest composition or technical improvements
   - Recommend creative approaches relevant to the assignment
   - Offer practical tips for meeting higher criterion levels
   - Include resources or methods for developing photography/image creation skills

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
      // Resolve model assigned to image grading (fallback to vision-capable default)
      const modelKey = await this.llmResolver.getModelKeyWithFallback(
        "image_grading",
        "gpt-4.1-mini",
      );
      this.logger.debug(
        `Using model ${modelKey} for image_grading feature (assignment ${assignmentId})`,
      );

      const llmOut = await this.promptProcessor.processPromptWithImage(
        gradingPrompt,
        primaryImage.base64,
        assignmentId,
        AIUsageType.ASSIGNMENT_GRADING,
        modelKey,
      );

      const parsed = await parser.parse(llmOut);

      // Validate and cap points if needed
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

      // Combine the AEEG components into comprehensive feedback
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

  // Keep all the existing helper methods unchanged
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

  private async moderateContent(learnerResponse: any): Promise<void> {
    const contentToModerate =
      typeof learnerResponse === "string"
        ? learnerResponse
        : JSON.stringify(learnerResponse);

    const isValid =
      await this.moderationService.validateContent(contentToModerate);
    if (!isValid) {
      throw new HttpException(
        "Learner response blocked",
        HttpStatus.BAD_REQUEST,
      );
    }
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
  ): Promise<ProcessedImageData> {
    try {
      this.logger.debug(`Fetching image from storage: ${bucket}/${key}`);

      const object = await this.s3Service.getObject({
        Bucket: bucket,
        Key: key,
      });

      const buffer = Buffer.isBuffer(object.Body)
        ? object.Body
        : await this.streamToBuffer(object.Body as NodeJS.ReadableStream);

      const mimeType =
        this.detectImageMimeType(buffer, key) ?? "application/octet-stream";
      const base64 = `data:${mimeType};base64,${buffer.toString("base64")}`;

      return { buffer, mimeType, size: buffer.length, base64 };
    } catch (error) {
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

    let buffer: Buffer;
    let base64: string;

    if (typeof imageData === "string") {
      if (imageData.startsWith("data:")) {
        base64 = imageData;
        const base64Data = imageData.split(",")[1];
        buffer = Buffer.from(base64Data, "base64");
      } else {
        buffer = Buffer.from(imageData, "base64");
        const mimeType = this.detectImageMimeType(buffer);
        base64 = `data:${mimeType || "image/jpeg"};base64,${imageData}`;
      }
    } else {
      buffer = imageData;
      const mimeType = this.detectImageMimeType(buffer);
      base64 = `data:${mimeType || "image/jpeg"};base64,${buffer.toString(
        "base64",
      )}`;
    }

    const mimeType = this.detectImageMimeType(buffer);
    if (!mimeType) {
      throw new HttpException(
        "Invalid image format provided",
        HttpStatus.BAD_REQUEST,
      );
    }

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

  private detectImageMimeType(
    buffer: Buffer,
    filename?: string,
  ): string | null {
    if (filename) {
      const extension = filename.split(".").pop()?.toLowerCase();
      const extensionToMime: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        bmp: "image/bmp",
        webp: "image/webp",
        tiff: "image/tiff",
        svg: "image/svg+xml",
      };

      if (extension && extensionToMime[extension]) {
        return extensionToMime[extension];
      }
    }

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

    if (firstBytes[0] === 0x42 && firstBytes[1] === 0x4d) {
      return "image/bmp";
    }

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

    return null;
  }
}
