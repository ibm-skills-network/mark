/**
 * Evidence-Based Grading Service
 *
 * Implements criterion-by-criterion grading with mandatory evidence citations.
 * Enforces:
 * - Evidence-first: Citations BEFORE decisions
 * - Determinism: Same input → same grade
 * - Traceability: Every score maps to specific content
 * - Rubric alignment: Only exact points from criteria
 * - No LLM drift: Mechanical aggregation
 */

import { PromptTemplate } from "@langchain/core/prompts";
import { Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { StructuredOutputParser } from "langchain/output_parsers";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { z } from "zod";
import {
  CanonicalSubmission,
  ContentBlock,
  CriterionGradingResult,
  EvidenceCitation,
  EvidenceBasedGradingResult,
} from "src/api/attempt/services/structured-content.models";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { PROMPT_PROCESSOR } from "../../../llm.constants";
import { ImageDescriptionService } from "./image-description.service";
import { HighlightingGeneratorService } from "./highlighting-generator.service";

/**
 * Single rubric criterion
 */
export interface RubricCriterion {
  id: string;
  rubricQuestion: string;
  description: string;
  criteria: {
    description: string;
    points: number;
  }[];
  maxPoints: number;
}

/**
 * Decision categories (not points)
 */
type Decision = "meets" | "partially_meets" | "does_not_meet";

/**
 * Evidence-first LLM output schema
 */
const EvidenceOutputSchema = z.object({
  evidence: z
    .array(
      z.object({
        blockId: z.string().describe("Block ID where evidence was found"),
        quote: z
          .string()
          .min(1)
          .describe(
            "Exact verbatim quote from the submission (can be short headings or titles)",
          ),
        page: z.number().describe("Page number where evidence appears"),
        relevance: z
          .string()
          .optional()
          .describe("Brief explanation of why this evidence matters"),
      }),
    )
    .min(1)
    .describe("MUST provide at least one piece of evidence"),

  decision: z
    .enum(["meets", "partially_meets", "does_not_meet"])
    .describe("Does the submission meet this criterion?"),

  pointsAwarded: z
    .number()
    .int()
    .min(0)
    .describe("EXACT points from rubric criterion (integer only)"),

  rationale: z
    .string()
    .min(20)
    .describe(
      "Justification referencing specific evidence by blockId. Must cite evidence.",
    ),
});

type EvidenceOutput = z.infer<typeof EvidenceOutputSchema>;

@Injectable()
export class EvidenceBasedGradingService {
  private readonly logger: Logger;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    private readonly imageDescriptionService: ImageDescriptionService,
    private readonly highlightingGenerator: HighlightingGeneratorService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: EvidenceBasedGradingService.name,
    });
  }

  /**
   * Grade entire submission using evidence-based approach
   * Grades ONE criterion at a time, then aggregates mechanically
   */
  async gradeSubmission(
    submission: CanonicalSubmission,
    criteria: RubricCriterion[],
    questionText: string,
    assignmentId: number,
    language = "en",
  ): Promise<EvidenceBasedGradingResult> {
    this.logger.debug(
      `Starting evidence-based grading for ${submission.submissionId}: ${criteria.length} criteria`,
    );

    await this.describeImagesInSubmission(
      submission,
      criteria,
      questionText,
      assignmentId,
    );

    const criteriaResults: CriterionGradingResult[] = [];
    let totalPoints = 0;
    let maxPossiblePoints = 0;

    for (const criterion of criteria) {
      try {
        this.logger.debug(
          `Grading criterion: ${criterion.rubricQuestion} (max ${criterion.maxPoints} points)`,
        );

        const result = await this.gradeOneCriterion(
          submission,
          criterion,
          questionText,
          assignmentId,
          language,
        );

        criteriaResults.push(result);
        totalPoints += result.pointsAwarded;
        maxPossiblePoints += result.maxPoints;

        this.logger.debug(
          `Criterion complete: ${result.pointsAwarded}/${result.maxPoints} points`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to grade criterion ${criterion.id}: ${error instanceof Error ? error.message : String(error)}`,
        );

        criteriaResults.push({
          criterionId: criterion.id,
          rubricQuestion: criterion.rubricQuestion,
          pointsAwarded: 0,
          maxPoints: criterion.maxPoints,
          evidence: [],
          rationale: `Grading failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          decision: "does_not_meet",
          gradedAt: new Date().toISOString(),
        });

        maxPossiblePoints += criterion.maxPoints;
      }
    }

    this.logger.debug(
      `Grading complete: ${totalPoints}/${maxPossiblePoints} points (${criteriaResults.length} criteria)`,
    );

    const feedback = this.generateFeedbackFromResults(criteriaResults);

    this.logger.debug(
      `Calling highlighting generator with ${criteriaResults.length} criteria`,
    );
    const highlighting =
      this.highlightingGenerator.generateHighlightsFromEvidence(
        submission,
        criteriaResults,
      );

    this.logger.info(
      `Evidence-based grading complete. Highlighting generated: ` +
        `pages=${Object.keys(highlighting.pages).length}, ` +
        `blockHighlights=${Object.keys(highlighting.blockHighlights).length}`,
    );

    return {
      submissionId: submission.submissionId,
      totalPoints,
      maxPossiblePoints,
      criteriaResults,
      feedback,
      highlighting,
      metadata: {
        gradedAt: new Date().toISOString(),
        modelUsed: "gpt-4o-mini",
        determinismChecksum: submission.metadata.checksum,
      },
    };
  }

  /**
   * Grade a single criterion with evidence-first approach
   * This is the core grading unit
   */
  private async gradeOneCriterion(
    submission: CanonicalSubmission,
    criterion: RubricCriterion,
    questionText: string,
    assignmentId: number,
    language: string,
  ): Promise<CriterionGradingResult> {
    const submissionContext = this.buildSubmissionContext(submission);

    const parser = StructuredOutputParser.fromZodSchema(EvidenceOutputSchema);
    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: `You are grading a single criterion from a rubric. You MUST provide evidence before making any decision.

QUESTION:
{question}

CRITERION TO EVALUATE:
{criterion_name}
{criterion_description}

ALLOWED POINTS:
{allowed_points_list}

SUBMISSION CONTENT:
{submission_context}

GRADING PROCESS (FOLLOW IN ORDER):

1. FIND EVIDENCE
   - Search the submission for content relevant to this criterion
   - Quote EXACT text from the submission (verbatim, no paraphrasing)
   - Note the blockId and page number for each piece of evidence
   - You MUST find at least one piece of evidence

2. MAKE DECISION
   - Based ONLY on the evidence you found, decide:
     * "meets" - Criterion fully satisfied
     * "partially_meets" - Some elements present but incomplete
     * "does_not_meet" - Criterion not satisfied
   - Do NOT use any external knowledge
   - Do NOT make assumptions about missing content

3. ASSIGN POINTS
   - Select EXACTLY ONE criterion level from the allowed points
   - Award the EXACT points for that level (no interpolation, no decimals)
   - The points must match one of: {allowed_points_list}

4. WRITE RATIONALE
   - Provide constructive, learner-focused feedback that references evidence by blockId
   - Focus on what the learner DID or DID NOT include in their submission
   - If fully met: Point out what specific content was found (e.g., "Block p1b3 includes X, and block p2b7 shows Y")
   - If partially met: State what was found AND what specific elements are missing (e.g., "Block p1b3 addresses X, but lacks coverage of Y and Z")
   - If not met: Explain what specific content is absent (e.g., "No evidence found for X or Y in the submission")
   - Be specific about gaps: name the missing concepts, explanations, or details
   - Frame as actionable guidance when applicable: "The submission should include..." or "Consider adding..."
   - Do NOT state criterion requirements or start with "Criterion requires..."
   - Focus on the work itself, not what the rubric asks for

FORBIDDEN PHRASES AND PATTERNS:
- "good effort", "shows promise", "could improve", "partial credit"
- "Criterion requires...", "The rubric expects...", "According to the criterion..."
- Subjective praise or encouragement
Use specific, evidence-based language focused on what is present or absent in the submission.

OUTPUT REQUIREMENTS:
- evidence: Array of citations (minimum 1 required)
- decision: Must be one of: meets, partially_meets, does_not_meet
- pointsAwarded: Must be from allowed points: {allowed_points_list}
- rationale: Must reference blockIds from evidence

LANGUAGE: {language}

{format_instructions}`,
      inputVariables: [],
      partialVariables: {
        question: () => questionText,
        criterion_name: () => criterion.rubricQuestion,
        criterion_description: () => this.formatCriterionDescription(criterion),
        allowed_points_list: () =>
          criterion.criteria.map((c) => `${c.points} points`).join(", "),
        submission_context: () => submissionContext,
        language: () => language,
        format_instructions: () => formatInstructions,
      },
    });

    this.logger.debug(`Calling LLM for criterion: ${criterion.rubricQuestion}`);

    const response = await this.promptProcessor.processPromptForFeature(
      prompt,
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
      "file_grading",
      "gpt-4o-mini",
    );

    let parsedOutput: EvidenceOutput;
    try {
      parsedOutput = await parser.parse(response);
    } catch (parseError) {
      this.logger.error(
        `Failed to parse LLM response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      );
      throw new Error(
        `LLM returned invalid format for criterion ${criterion.id}`,
      );
    }

    const allowedPoints = criterion.criteria.map((c) => c.points);
    if (!allowedPoints.includes(parsedOutput.pointsAwarded)) {
      this.logger.warn(
        `LLM awarded invalid points (${parsedOutput.pointsAwarded}). Allowed: ${allowedPoints.join(", ")}. Capping to nearest.`,
      );

      parsedOutput.pointsAwarded = this.findNearestAllowedPoints(
        parsedOutput.pointsAwarded,
        allowedPoints,
      );
    }

    const validatedEvidence = this.validateEvidence(
      parsedOutput.evidence,
      submission,
    );

    const result: CriterionGradingResult = {
      criterionId: criterion.id,
      rubricQuestion: criterion.rubricQuestion,
      pointsAwarded: parsedOutput.pointsAwarded,
      maxPoints: criterion.maxPoints,
      evidence: validatedEvidence,
      rationale: parsedOutput.rationale,
      decision: parsedOutput.decision,
      gradedAt: new Date().toISOString(),
    };

    return result;
  }

  /**
   * Describe all images in the submission using criterion-aware descriptions
   * This is called once at the start of grading (Option A)
   */
  private async describeImagesInSubmission(
    submission: CanonicalSubmission,
    criteria: RubricCriterion[],
    questionText: string,
    assignmentId: number,
  ): Promise<void> {
    const allBlocks = submission.pages.flatMap((p) => p.blocks);
    const imageBlocks = allBlocks.filter(
      (b) => b.type === "image" && b.imageData,
    );

    if (imageBlocks.length === 0) {
      this.logger.debug("No images found in submission");
      return;
    }

    this.logger.debug(
      `Found ${imageBlocks.length} images in submission, generating criterion-aware descriptions`,
    );

    const criteriaContext = criteria.map((c) => c.rubricQuestion).join(", ");

    const descriptionsMap =
      await this.imageDescriptionService.describeImagesForGrading(
        imageBlocks,
        criteriaContext,
        questionText,
        assignmentId,
      );

    let updatedCount = 0;
    for (const page of submission.pages) {
      for (const block of page.blocks) {
        if (block.type === "image" && descriptionsMap.has(block.blockId)) {
          block.imageDescription = descriptionsMap.get(block.blockId);
          updatedCount++;
        }
      }
    }

    this.logger.debug(
      `Updated ${updatedCount} image blocks with criterion-aware descriptions`,
    );
  }

  /**
   * Build submission context for LLM
   * Format all blocks with their IDs for evidence citation
   */
  private buildSubmissionContext(submission: CanonicalSubmission): string {
    let context = `Submission: ${submission.submissionId}\n`;
    context += `Pages: ${submission.metadata.pageCount}, Blocks: ${submission.metadata.blockCount}\n\n`;

    for (const page of submission.pages) {
      context += `--- Page ${page.pageNumber} ---\n\n`;

      for (const block of page.blocks) {
        const typeLabel = block.type === "paragraph" ? "" : `[${block.type}] `;

        if (block.type === "image" && block.imageDescription) {
          context += `[${block.blockId}] ${typeLabel}${block.text}\n`;
          context += `Description: ${block.imageDescription}\n\n`;
        } else {
          context += `[${block.blockId}] ${typeLabel}${block.text}\n\n`;
        }
      }
    }

    return context;
  }

  /**
   * Format criterion description for prompt
   */
  private formatCriterionDescription(criterion: RubricCriterion): string {
    let desc = criterion.description ? `${criterion.description}\n\n` : "";
    desc += "Point levels:\n";

    for (const level of criterion.criteria.sort(
      (a, b) => b.points - a.points,
    )) {
      desc += `- ${level.points} points: ${level.description}\n`;
    }

    return desc;
  }

  /**
   * Find nearest allowed points value
   */
  private findNearestAllowedPoints(awarded: number, allowed: number[]): number {
    let nearest = allowed[0] ?? 0;
    for (const current of allowed) {
      if (Math.abs(current - awarded) < Math.abs(nearest - awarded)) {
        nearest = current;
      }
    }
    return nearest;
  }

  /**
   * Validate evidence citations reference real blocks
   */
  private validateEvidence(
    evidence: EvidenceOutput["evidence"],
    submission: CanonicalSubmission,
  ): EvidenceCitation[] {
    const allBlocks = submission.pages.flatMap((p) => p.blocks);
    const blockMap = new Map<string, ContentBlock>(
      allBlocks.map((b) => [b.blockId, b]),
    );

    return evidence.map((event) => {
      const block = blockMap.get(event.blockId);

      if (!block) {
        this.logger.warn(
          `Evidence references non-existent block: ${event.blockId}`,
        );
      }

      const quoteFound =
        block &&
        (block.text.includes(event.quote) ||
          this.fuzzyMatch(block.text, event.quote));

      if (block && !quoteFound) {
        this.logger.warn(
          `Evidence quote not found in block ${event.blockId}: "${event.quote.slice(0, 50)}..."`,
        );
      }

      return {
        blockId: event.blockId,
        quote: event.quote,
        page: event.page,
        relevance: event.relevance,
      };
    });
  }

  /**
   * Fuzzy match for quote validation (handles minor LLM paraphrasing)
   */
  private fuzzyMatch(text: string, quote: string): boolean {
    const normText = this.normalizeForMatch(text);
    const normQuote = this.normalizeForMatch(quote);

    return normText.includes(normQuote);
  }

  private normalizeForMatch(content: string): string {
    return content
      .toLowerCase()
      .replaceAll(/[^\s\w]/g, "")
      .replaceAll(/\s+/g, " ")
      .trim();
  }

  /**
   * Generate feedback AFTER grading (not before)
   * This uses actual evidence and rationales to create specific, actionable feedback
   * Optimized for student readability - concise, direct, and actionable
   */
  private generateFeedbackFromResults(
    results: CriterionGradingResult[],
  ): EvidenceBasedGradingResult["feedback"] {
    const metCriteria = results.filter((r) => r.decision === "meets");
    const partialCriteria = results.filter(
      (r) => r.decision === "partially_meets",
    );
    const unmetCriteria = results.filter((r) => r.decision === "does_not_meet");

    const totalCriteria = results.length;
    let totalPoints = 0;
    let maxPoints = 0;
    for (const result of results) {
      totalPoints += result.pointsAwarded;
      maxPoints += result.maxPoints;
    }
    const percentage = Math.round((totalPoints / maxPoints) * 100);

    let overallAssessment = "";
    if (percentage >= 90) {
      overallAssessment = `Excellent submission! You earned ${totalPoints}/${maxPoints} points (${percentage}%), meeting ${metCriteria.length}/${totalCriteria} criteria.`;
    } else if (percentage >= 75) {
      overallAssessment = `Good work! You earned ${totalPoints}/${maxPoints} points (${percentage}%). ${metCriteria.length} criteria met fully, ${partialCriteria.length + unmetCriteria.length} need improvement.`;
    } else if (percentage >= 60) {
      overallAssessment = `You earned ${totalPoints}/${maxPoints} points (${percentage}%). Your submission covers the basics but needs more depth in ${partialCriteria.length + unmetCriteria.length} areas.`;
    } else {
      overallAssessment = `You earned ${totalPoints}/${maxPoints} points (${percentage}%). Your submission needs significant development - only ${metCriteria.length}/${totalCriteria} criteria met.`;
    }

    const summary = overallAssessment;

    const strengths = metCriteria.map((r) => {
      const shortName =
        r.rubricQuestion.length > 80
          ? r.rubricQuestion.slice(0, 77) + "..."
          : r.rubricQuestion;
      const cleanRationale = r.rationale
        .replaceAll(/\(p\d+b\d+\)/g, "")
        .replace(/evidence found:.*$/i, "")
        .trim();
      const conciseRationale =
        cleanRationale.length > 150
          ? cleanRationale.slice(0, 147) + "..."
          : cleanRationale;
      return `${shortName}: ${conciseRationale} (${r.pointsAwarded}/${r.maxPoints} pts)`;
    });

    const improvements = [...partialCriteria, ...unmetCriteria].map((r) => {
      const shortName =
        r.rubricQuestion.length > 80
          ? r.rubricQuestion.slice(0, 77) + "..."
          : r.rubricQuestion;
      const cleanRationale = r.rationale
        .replaceAll(/\(p\d+b\d+\)/g, "")
        .replace(/current content:.*$/i, "")
        .trim();
      const conciseRationale =
        cleanRationale.length > 150
          ? cleanRationale.slice(0, 147) + "..."
          : cleanRationale;

      let guidance = "";
      if (r.decision === "does_not_meet") {
        guidance = " Add this missing content to improve your grade.";
      } else if (r.decision === "partially_meets") {
        guidance = " Expand with more detail to earn full credit.";
      }

      return `${shortName}: ${conciseRationale}${guidance} (${r.pointsAwarded}/${r.maxPoints} pts)`;
    });

    return {
      summary,
      strengths,
      improvements,
    };
  }

  /**
   * Summarize evidence citations for a criterion
   */
  private summarizeEvidence(evidence: EvidenceCitation[]): string {
    if (!evidence || evidence.length === 0) {
      return "";
    }

    const pageReferences = [
      ...new Set(evidence.map((citation) => citation.page)),
    ].sort((a, b) => a - b);
    const pageText =
      pageReferences.length === 1
        ? `on page ${pageReferences[0]}`
        : `on pages ${pageReferences.join(", ")}`;

    const sampleQuote = evidence[0]?.quote;
    if (sampleQuote && sampleQuote.length > 20) {
      const shortQuote =
        sampleQuote.length > 60
          ? `"${sampleQuote.slice(0, 60)}..."`
          : `"${sampleQuote}"`;
      return `${pageText} (e.g., ${shortQuote})`;
    }

    return pageText;
  }

  /**
   * Generate analysis with specific evidence references
   */
  private generateAnalysisWithEvidence(
    results: CriterionGradingResult[],
    metCriteria: CriterionGradingResult[],
    partialCriteria: CriterionGradingResult[],
    unmetCriteria: CriterionGradingResult[],
  ): string {
    const totalCriteria = results.length;

    const metExamples = metCriteria.slice(0, 2).map((criterion) => {
      const shortName =
        criterion.rubricQuestion.length > 50
          ? criterion.rubricQuestion.slice(0, 50) + "..."
          : criterion.rubricQuestion;
      const pages = [
        ...new Set(criterion.evidence.map((citation) => citation.page)),
      ];
      return `${shortName} (pages ${pages.join(", ")})`;
    });

    const unmetExamples = unmetCriteria.slice(0, 2).map((c) => {
      const shortName =
        c.rubricQuestion.length > 50
          ? c.rubricQuestion.slice(0, 50) + "..."
          : c.rubricQuestion;
      return shortName;
    });

    if (metCriteria.length === totalCriteria) {
      return `Your submission comprehensively addresses all ${totalCriteria} grading criteria. Strong evidence was found throughout the document, including detailed content for ${metExamples.join(" and ")}.`;
    } else if (metCriteria.length >= totalCriteria * 0.7) {
      const foundText =
        metExamples.length > 0
          ? `, including strong content for ${metExamples.join(" and ")}`
          : "";
      const missingText =
        unmetExamples.length > 0
          ? ` However, ${unmetExamples.join(" and ")} ${unmetExamples.length === 1 ? "lacks" : "lack"} sufficient detail or evidence.`
          : "";
      return `Your submission addresses ${metCriteria.length} of ${totalCriteria} criteria${foundText}.${missingText}`;
    } else if (metCriteria.length >= totalCriteria * 0.4) {
      return `Your submission shows partial completion with ${metCriteria.length}/${totalCriteria} criteria fully addressed. Key gaps include ${unmetExamples.join(", ")} and ${partialCriteria.length} other ${partialCriteria.length === 1 ? "area" : "areas"} needing more depth.`;
    } else {
      return `Your submission has significant gaps, with only ${metCriteria.length}/${totalCriteria} criteria adequately addressed. Most sections, including ${unmetExamples.join(", ")}, need substantial development with supporting evidence and detail.`;
    }
  }

  /**
   * Generate evaluation with specific scoring breakdown
   */
  private generateEvaluationWithSpecifics(
    results: CriterionGradingResult[],
    totalPoints: number,
    maxPoints: number,
  ): string {
    const percentage = Math.round((totalPoints / maxPoints) * 100);

    const sortedByPoints = [...results].sort((a, b) => {
      const aPercent = (a.pointsAwarded / a.maxPoints) * 100;
      const bPercent = (b.pointsAwarded / b.maxPoints) * 100;
      return bPercent - aPercent;
    });

    const topScoring = sortedByPoints
      .slice(0, 2)
      .filter((r) => r.pointsAwarded === r.maxPoints);
    const lowScoring = sortedByPoints
      .slice(-2)
      .filter((r) => r.pointsAwarded < r.maxPoints);

    let topText = "";
    if (topScoring.length > 0) {
      const topNames = topScoring
        .map((r) => {
          const shortName =
            r.rubricQuestion.length > 40
              ? r.rubricQuestion.slice(0, 40) + "..."
              : r.rubricQuestion;
          return `"${shortName}"`;
        })
        .join(" and ");
      topText = ` Strongest areas: ${topNames}.`;
    }

    let lowText = "";
    if (lowScoring.length > 0) {
      const lowNames = lowScoring
        .map((r) => {
          const shortName =
            r.rubricQuestion.length > 40
              ? r.rubricQuestion.slice(0, 40) + "..."
              : r.rubricQuestion;
          return `"${shortName}" (${r.pointsAwarded}/${r.maxPoints})`;
        })
        .join(" and ");
      lowText = ` Areas needing improvement: ${lowNames}.`;
    }

    return `Your submission earned ${totalPoints}/${maxPoints} points (${percentage}%).${topText}${lowText}`;
  }

  /**
   * Generate explanation with actual evidence examples
   */
  private generateExplanationWithEvidence(
    results: CriterionGradingResult[],
  ): string {
    const examples: string[] = [];

    for (const result of results.slice(0, 5)) {
      const shortName =
        result.rubricQuestion.length > 45
          ? result.rubricQuestion.slice(0, 45) + "..."
          : result.rubricQuestion;

      if (result.decision === "meets") {
        const evidenceReference = this.summarizeEvidence(result.evidence);
        examples.push(
          `${shortName}: Full ${result.pointsAwarded} points awarded${evidenceReference ? ` - found ${evidenceReference}` : ""}.`,
        );
      } else if (result.decision === "partially_meets") {
        examples.push(
          `${shortName}: Partial credit (${result.pointsAwarded}/${result.maxPoints}) - ${result.rationale.slice(0, 80)}${result.rationale.length > 80 ? "..." : ""}`,
        );
      } else if (examples.length < 3) {
        examples.push(
          `${shortName}: Not awarded (${result.pointsAwarded}/${result.maxPoints}) - ${result.rationale.slice(0, 80)}${result.rationale.length > 80 ? "..." : ""}`,
        );
      }
    }

    const remaining = results.length - 5;
    if (remaining > 0) {
      examples.push(
        `Plus ${remaining} additional ${remaining === 1 ? "criterion" : "criteria"} evaluated.`,
      );
    }

    return examples.join(" ");
  }

  /**
   * Generate guidance with specific actionable steps
   */
  private generateGuidanceWithSpecifics(
    partialCriteria: CriterionGradingResult[],
    unmetCriteria: CriterionGradingResult[],
  ): string {
    if (partialCriteria.length === 0 && unmetCriteria.length === 0) {
      return "Excellent work! Your submission demonstrates strong evidence and detail across all criteria. Continue this thorough approach in future assignments.";
    }

    const suggestions: string[] = [];

    if (unmetCriteria.length > 0) {
      for (const criterion of unmetCriteria.slice(0, 2)) {
        const shortName =
          criterion.rubricQuestion.length > 50
            ? criterion.rubricQuestion.slice(0, 50) + "..."
            : criterion.rubricQuestion;

        const specificGuidance =
          criterion.rationale.includes("missing") ||
          criterion.rationale.includes("lack")
            ? criterion.rationale.slice(0, 100)
            : `Add detailed content for ${shortName}`;

        suggestions.push(specificGuidance);
      }
    }

    if (partialCriteria.length > 0) {
      for (const criterion of partialCriteria.slice(0, 2)) {
        const shortName =
          criterion.rubricQuestion.length > 50
            ? criterion.rubricQuestion.slice(0, 50) + "..."
            : criterion.rubricQuestion;

        suggestions.push(
          `Expand ${shortName} with more comprehensive detail and examples.`,
        );
      }
    }

    if (unmetCriteria.length > 2 || partialCriteria.length > 2) {
      suggestions.push(
        `Review all ${unmetCriteria.length + partialCriteria.length} areas flagged for improvement to ensure complete coverage.`,
      );
    }

    return suggestions.join(" ");
  }
}
