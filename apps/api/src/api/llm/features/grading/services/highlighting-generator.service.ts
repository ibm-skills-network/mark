/**
 * Highlighting Generator Service
 * Converts grading evidence into visual highlights for learner responses
 */

import { Injectable, Inject } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  TextHighlight,
  HighlightLevel,
  ResponseHighlighting,
  FileHighlighting,
} from "../../../model/highlighting.model";
import {
  EvidenceCitation,
  CriterionGradingResult,
  CanonicalSubmission,
  ContentBlock,
} from "../../../../attempt/services/structured-content.models";

@Injectable()
export class HighlightingGeneratorService {
  private readonly logger: Logger;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger) {
    this.logger = parentLogger.child({
      context: HighlightingGeneratorService.name,
    });
  }

  /**
   * Generate highlights from evidence-based grading results
   */
  generateHighlightsFromEvidence(
    submission: CanonicalSubmission,
    criteriaResults: CriterionGradingResult[],
  ): FileHighlighting {
    this.logger.debug(
      `Generating highlights for ${criteriaResults.length} criteria`,
    );

    // Count total evidence across all criteria
    const totalEvidence = criteriaResults.reduce(
      (sum, c) => sum + c.evidence.length,
      0,
    );
    this.logger.debug(`Total evidence citations to process: ${totalEvidence}`);

    const blockHighlights = new Map<string, TextHighlight[]>();
    const pageHighlights = new Map<number, ResponseHighlighting>();

    for (const criterion of criteriaResults) {
      const level = this.getHighlightLevel(criterion);
      this.logger.debug(
        `Processing criterion ${criterion.criterionId}: ${criterion.evidence.length} evidence items, level=${level}`,
      );

      for (const evidence of criterion.evidence) {
        const highlight = this.createHighlightFromEvidence(
          evidence,
          level,
          criterion,
        );

        if (!blockHighlights.has(evidence.blockId)) {
          blockHighlights.set(evidence.blockId, []);
        }
        const blockGroup = blockHighlights.get(evidence.blockId);
        if (!blockGroup) {
          continue;
        }
        blockGroup.push(highlight);

        if (!pageHighlights.has(evidence.page)) {
          pageHighlights.set(evidence.page, {
            originalText: "",
            highlights: [],
            correctnessScore: 0,
            responseType: "file",
            pageNumber: evidence.page,
          });
        }
        const pageHighlight = pageHighlights.get(evidence.page);
        if (!pageHighlight) {
          continue;
        }
        pageHighlight.highlights.push(highlight);
      }
    }

    for (const page of submission.pages) {
      if (!pageHighlights.has(page.pageNumber)) {
        continue;
      }

      const pageText = page.blocks.map((b) => b.text).join("\n\n");
      const pageData = pageHighlights.get(page.pageNumber);
      if (!pageData) {
        continue;
      }
      pageData.originalText = pageText;

      pageData.correctnessScore = this.calculateCorrectnessScore(
        pageData.highlights,
      );

      this.updateHighlightPositions(pageData.highlights, page.blocks);
    }

    this.logger.debug(
      `Generated highlights for ${pageHighlights.size} pages, ${blockHighlights.size} blocks`,
    );

    // Convert Maps to plain objects for JSON serialization
    const pagesObject: Record<number, ResponseHighlighting> = {};
    for (const [key, value] of pageHighlights.entries()) {
      pagesObject[key] = value;
    }

    const blockHighlightsObject: Record<string, TextHighlight[]> = {};
    for (const [key, value] of blockHighlights.entries()) {
      blockHighlightsObject[key] = value;
    }

    const result: FileHighlighting = {
      filename: submission.submissionId,
      pages: pagesObject,
      blockHighlights: blockHighlightsObject,
    };

    this.logger.info(
      `Final highlighting result: filename="${result.filename}", ` +
        `pages=${Object.keys(result.pages).length}, ` +
        `blockHighlights=${Object.keys(result.blockHighlights).length}, ` +
        `totalHighlights=${Object.values(result.pages).reduce((sum, p) => sum + p.highlights.length, 0)}`,
    );

    return result;
  }

  /**
   * Generate highlights for text-based responses
   */
  generateHighlightsForText(
    responseText: string,
    gradingFeedback: string,
  ): ResponseHighlighting {
    const highlights: TextHighlight[] = [];

    const quotePattern = /"([^"]+)"/g;
    let match: RegExpExecArray | null;

    while ((match = quotePattern.exec(gradingFeedback)) !== null) {
      const quotedText = match[1];
      const position = responseText.indexOf(quotedText);

      if (position !== -1) {
        const level = this.inferLevelFromContext(match.input, match.index);

        highlights.push({
          start: position,
          end: position + quotedText.length,
          text: quotedText,
          level,
          comment: this.extractCommentForQuote(match.input, match.index),
        });
      }
    }

    return {
      originalText: responseText,
      highlights,
      correctnessScore: this.calculateCorrectnessScore(highlights),
      responseType: "text",
    };
  }

  /**
   * Determine highlight level from criterion result
   */
  private getHighlightLevel(criterion: CriterionGradingResult): HighlightLevel {
    const percentageAwarded =
      criterion.maxPoints > 0
        ? (criterion.pointsAwarded / criterion.maxPoints) * 100
        : 0;

    if (criterion.decision === "meets" || percentageAwarded >= 90) {
      return HighlightLevel.CORRECT;
    } else if (
      criterion.decision === "partially_meets" ||
      percentageAwarded >= 40
    ) {
      return HighlightLevel.PARTIAL;
    } else {
      return HighlightLevel.INCORRECT;
    }
  }

  /**
   * Create highlight from evidence citation
   */
  private createHighlightFromEvidence(
    evidence: EvidenceCitation,
    level: HighlightLevel,
    criterion: CriterionGradingResult,
  ): TextHighlight {
    return {
      start: 0,
      end: evidence.quote.length,
      text: evidence.quote,
      level,
      comment: this.buildCommentFromCriterion(criterion, evidence),
      criterionId: criterion.criterionId,
      evidenceId: evidence.blockId,
    };
  }

  /**
   * Build AI comment for a highlight
   */
  private buildCommentFromCriterion(
    criterion: CriterionGradingResult,
    evidence: EvidenceCitation,
  ): string {
    const scoreText = `${criterion.pointsAwarded}/${criterion.maxPoints} points`;

    if (criterion.decision === "meets") {
      return `[CORRECT] **${criterion.rubricQuestion}** (${scoreText}): ${evidence.relevance || criterion.rationale}`;
    } else if (criterion.decision === "partially_meets") {
      return `[PARTIAL] **${criterion.rubricQuestion}** (${scoreText}): ${criterion.rationale}`;
    } else {
      return `[INCORRECT] **${criterion.rubricQuestion}** (${scoreText}): ${criterion.rationale}`;
    }
  }

  /**
   * Update highlight positions based on block positions in full text
   */
  private updateHighlightPositions(
    highlights: TextHighlight[],
    blocks: ContentBlock[],
  ): void {
    let currentPosition = 0;

    for (const block of blocks) {
      const blockText = block.text;

      for (const highlight of highlights) {
        if (highlight.evidenceId === block.blockId) {
          const quotePosition = blockText.indexOf(highlight.text);

          if (quotePosition !== -1) {
            highlight.start = currentPosition + quotePosition;
            highlight.end = highlight.start + highlight.text.length;
          }
        }
      }

      currentPosition += blockText.length + 2;
    }
  }

  /**
   * Calculate overall correctness score from highlights
   */
  private calculateCorrectnessScore(highlights: TextHighlight[]): number {
    if (highlights.length === 0) return 0;

    const scores = highlights.map((h) => {
      switch (h.level) {
        case HighlightLevel.CORRECT: {
          return 100;
        }
        case HighlightLevel.PARTIAL: {
          return 50;
        }
        case HighlightLevel.INCORRECT: {
          return 0;
        }
        default: {
          return 50;
        }
      }
    });

    return (
      scores.reduce<number>((sum, score) => sum + score, 0) / scores.length
    );
  }

  /**
   * Infer highlight level from feedback context
   */
  private inferLevelFromContext(
    text: string,
    position: number,
  ): HighlightLevel {
    const contextBefore = text.slice(Math.max(0, position - 100), position);
    const contextAfter = text.slice(
      position,
      Math.min(text.length, position + 100),
    );

    const context = (contextBefore + contextAfter).toLowerCase();

    if (
      context.includes("correct") ||
      context.includes("excellent") ||
      context.includes("well done") ||
      context.includes("strong")
    ) {
      return HighlightLevel.CORRECT;
    } else if (
      context.includes("incorrect") ||
      context.includes("wrong") ||
      context.includes("missing") ||
      context.includes("error")
    ) {
      return HighlightLevel.INCORRECT;
    } else if (
      context.includes("partial") ||
      context.includes("could improve") ||
      context.includes("consider")
    ) {
      return HighlightLevel.PARTIAL;
    }

    return HighlightLevel.NEUTRAL;
  }

  /**
   * Extract comment for quoted text from feedback
   */
  private extractCommentForQuote(text: string, quotePosition: number): string {
    const sentenceStart = text.lastIndexOf(".", quotePosition - 50);
    const sentenceEnd = text.indexOf(".", quotePosition + 50);

    const start = sentenceStart === -1 ? 0 : sentenceStart + 1;
    const end = sentenceEnd === -1 ? text.length : sentenceEnd + 1;

    return text.slice(start, end).trim();
  }
}
