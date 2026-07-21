import { PromptTemplate } from "@langchain/core/prompts";
import { Inject, Injectable } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { ITokenCounter } from "../../../core/interfaces/token-counter.interface";
import { PROMPT_PROCESSOR, TOKEN_COUNTER } from "../../../llm.constants";

/**
 * Shared token-budgeting machinery used by graders to keep prompts inside a
 * model's context window. Extracted from FileGradingService so that text
 * grading (and any future grader) can reuse the same chunk/summarize/compress
 * pipeline and context-window registry without duplicating it.
 */
@Injectable()
export class ContentSummarizationService {
  private readonly logger: Logger;
  private readonly contextWindowByModel: Record<string, number> = {
    "gpt-5-mini": 128_000,
    "gpt-5.4-mini-2026-03-17": 400_000,
    "gpt-5.4-nano-2026-03-17": 400_000,
    "gpt-5o-mini": 128_000,
    "gpt-5": 128_000,
    "gpt-4o-mini": 128_000,
    "gpt-4o": 128_000,
    "gpt-4.1-mini": 128_000,
    "gpt-4.1": 128_000,
  };
  private readonly defaultContextWindow = 32_000;
  private readonly contextSafetyRatio = 0.8;
  private readonly minimumChunkTokens = 4000;
  private readonly maximumChunkTokens = 20_000;
  // Upper bound on how many chunks we will issue LLM summarize calls for. Chunk
  // count scales linearly with input size, so without a ceiling an adversarially
  // large submission could fan out into hundreds of calls. Beyond this we keep
  // the first MAX_SUMMARY_CHUNKS and disclose the omission instead.
  private static readonly MAX_SUMMARY_CHUNKS = 25;

  constructor(
    @Inject(TOKEN_COUNTER)
    private readonly tokenCounter: ITokenCounter,
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: ContentSummarizationService.name,
    });
  }

  /**
   * Look up the raw context window (in tokens) for a model key, falling back to
   * the default window when the model is unknown.
   */
  getContextWindow(modelKey: string): number {
    const normalized = modelKey.toLowerCase();
    const matchKey = Object.keys(this.contextWindowByModel).find((key) =>
      normalized.includes(key),
    );
    return matchKey
      ? this.contextWindowByModel[matchKey]
      : this.defaultContextWindow;
  }

  /**
   * The usable token budget for a model: its context window scaled down by the
   * safety ratio to leave room for the model's own response.
   */
  getSafeContextLimit(modelKey: string): number {
    return Math.floor(
      this.getContextWindow(modelKey) * this.contextSafetyRatio,
    );
  }

  /**
   * Size each summarization chunk relative to the available budget: roughly a
   * fifth of the target, clamped between the minimum and maximum chunk sizes.
   * Shared by every grader so the chunking math lives in exactly one place.
   */
  getChunkTokenLimit(targetTokens: number): number {
    return Math.max(
      this.minimumChunkTokens,
      Math.min(this.maximumChunkTokens, Math.floor(targetTokens * 0.2)),
    );
  }

  /**
   * Count tokens for a text using the configured tokenizer.
   */
  countTokens(text: string, modelKey?: string): number {
    return this.tokenCounter.countTokens(text, modelKey);
  }

  /**
   * Split text into chunks that each stay within the token cap. Uses a
   * char-per-token heuristic to size the initial slice, then trims by measured
   * token count when the slice overshoots.
   */
  splitTextIntoChunks(
    text: string,
    maxTokens: number,
    modelKey?: string,
  ): string[] {
    const chunks: string[] = [];
    const approxCharsPerToken = 4;
    const maxChars = Math.max(1000, maxTokens * approxCharsPerToken);
    let start = 0;

    while (start < text.length) {
      let end = Math.min(text.length, start + maxChars);
      let chunk = text.slice(start, end);
      let tokenCount = this.tokenCounter.countTokens(chunk, modelKey);

      if (tokenCount > maxTokens) {
        const ratio = Math.max(0.2, maxTokens / tokenCount);
        end = Math.min(text.length, start + Math.floor(chunk.length * ratio));
        chunk = text.slice(start, end);
        tokenCount = this.tokenCounter.countTokens(chunk, modelKey);
      }

      if (chunk.length === 0) {
        break;
      }

      chunks.push(chunk);
      start = end;
    }

    return chunks;
  }

  /**
   * Truncate text to a token budget, returning a prefix of the input whose token
   * count is at or below the limit.
   */
  truncateToTokenLimit(
    text: string,
    maxTokens: number,
    modelKey?: string,
  ): string {
    if (!text) return "";
    if (this.tokenCounter.countTokens(text, modelKey) <= maxTokens) {
      return text;
    }

    const approxCharsPerToken = 4;
    let end = Math.max(1000, maxTokens * approxCharsPerToken);
    end = Math.min(text.length, end);
    let truncated = text.slice(0, end);

    while (
      truncated.length > 0 &&
      this.tokenCounter.countTokens(truncated, modelKey) > maxTokens
    ) {
      end = Math.floor(end * 0.9);
      truncated = text.slice(0, end);
    }

    return truncated;
  }

  /**
   * Summarize a single content chunk into concise grading notes via the LLM.
   * Generalized from file grading: `label` stands in for the source filename and
   * the caller supplies the usage type and feature key. `criteriaText`, when
   * supplied, renders a SCORING CRITERIA block so callers that grade against a
   * rubric (e.g. file grading) get the same prompt they always did.
   */
  async summarizeChunk(arguments_: {
    chunk: string;
    label: string;
    questionText: string;
    modelKey: string;
    assignmentId: number;
    usageType: AIUsageType;
    feature: string;
    criteriaText?: string;
    language?: string;
  }): Promise<string> {
    const {
      chunk,
      label,
      questionText,
      modelKey,
      assignmentId,
      usageType,
      feature,
      criteriaText,
      language,
    } = arguments_;

    const criteriaBlock =
      criteriaText === undefined
        ? ""
        : `SCORING CRITERIA:
${criteriaText}

`;

    const prompt = new PromptTemplate({
      template: `You are condensing a learner submission chunk to help grading.

QUESTION:
{question}

{scoring_criteria}FILE: {label}

CONTENT CHUNK:
{chunk}

LANGUAGE: {language}

Write a concise summary (max 200 words) highlighting evidence relevant to the rubric and any missing elements. Use short bullet points.`,
      inputVariables: [],
      partialVariables: {
        question: () => questionText,
        scoring_criteria: () => criteriaBlock,
        label: () => label,
        chunk: () => chunk,
        language: () => language ?? "en",
      },
    });

    return await this.promptProcessor.processPromptForFeature(
      prompt,
      assignmentId,
      usageType,
      feature,
      modelKey,
    );
  }

  /**
   * Compress grading notes into a shorter summary within a target token budget.
   * Generalized from file grading. `questionText`/`criteriaText`, when supplied,
   * render the QUESTION and SCORING CRITERIA blocks so rubric-based callers (e.g.
   * file grading) get the same prompt they always did.
   */
  async compressSummary(arguments_: {
    summary: string;
    label: string;
    modelKey: string;
    assignmentId: number;
    usageType: AIUsageType;
    feature: string;
    targetTokens: number;
    questionText?: string;
    criteriaText?: string;
    language?: string;
  }): Promise<string> {
    const {
      summary,
      label,
      modelKey,
      assignmentId,
      usageType,
      feature,
      targetTokens,
      questionText,
      criteriaText,
      language,
    } = arguments_;

    const cappedSummary = this.truncateToTokenLimit(
      summary,
      Math.max(targetTokens * 2, 4000),
      modelKey,
    );

    const questionBlock =
      questionText === undefined
        ? ""
        : `QUESTION:
${questionText}

`;
    const criteriaBlock =
      criteriaText === undefined
        ? ""
        : `SCORING CRITERIA:
${criteriaText}

`;

    const prompt = new PromptTemplate({
      template: `You are compressing grading notes into a shorter summary.

{question}{scoring_criteria}NOTES:
{summary}

LANGUAGE: {language}

Return a concise summary (max 300 words) focused on evidence and gaps.`,
      inputVariables: [],
      partialVariables: {
        question: () => questionBlock,
        scoring_criteria: () => criteriaBlock,
        summary: () => cappedSummary,
        language: () => language ?? "en",
      },
    });

    try {
      const compressed = await this.promptProcessor.processPromptForFeature(
        prompt,
        assignmentId,
        usageType,
        feature,
        modelKey,
      );

      return this.truncateToTokenLimit(compressed, targetTokens, modelKey);
    } catch (error) {
      this.logger.warn(
        `Summary compression failed for ${label}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.truncateToTokenLimit(summary, targetTokens, modelKey);
    }
  }

  /**
   * Budget a single text to fit within `targetTokens`. Under budget: returns the
   * text unchanged. Over budget: chunk -> summarize each chunk -> join ->
   * compress if still over -> truncate as the final guard. Mirrors what file
   * grading does per file, generalized to operate on one piece of content.
   */
  async summarizeTextToBudget(arguments_: {
    text: string;
    label: string;
    questionText: string;
    modelKey: string;
    assignmentId: number;
    usageType: AIUsageType;
    feature: string;
    targetTokens: number;
    language?: string;
  }): Promise<{
    text: string;
    summarized: boolean;
    originalTokens: number;
    finalTokens: number;
  }> {
    const {
      text,
      label,
      questionText,
      modelKey,
      assignmentId,
      usageType,
      feature,
      targetTokens,
      language,
    } = arguments_;

    const originalTokens = this.tokenCounter.countTokens(text, modelKey);

    // Fail fast on a non-positive budget BEFORE issuing any LLM call. This
    // happens when the prompt's fixed overhead (rubric, instructions, format)
    // already exceeds the model's safe context limit, leaving no room for
    // content. Summarizing here would burn the entire chunk-summarization
    // budget and then truncate to "", which the grader would grade as the
    // submission. Throwing fails the attempt deterministically instead.
    if (targetTokens <= 0) {
      this.logger.error("content.summarization.invalid.budget", {
        label,
        targetTokens,
        originalTokens,
      });
      throw new Error(
        `Cannot summarize ${label}: the prompt's fixed overhead leaves no token budget for content.`,
      );
    }

    if (originalTokens <= targetTokens) {
      return {
        text,
        summarized: false,
        originalTokens,
        finalTokens: originalTokens,
      };
    }

    const chunkTokenLimit = this.getChunkTokenLimit(targetTokens);

    const allChunks = this.splitTextIntoChunks(text, chunkTokenLimit, modelKey);
    const cappedAtMaxChunks =
      allChunks.length > ContentSummarizationService.MAX_SUMMARY_CHUNKS;
    const chunks = cappedAtMaxChunks
      ? allChunks.slice(0, ContentSummarizationService.MAX_SUMMARY_CHUNKS)
      : allChunks;

    this.logger.warn("content.summarization.engaged", {
      label,
      originalTokens,
      targetTokens,
      chunkCount: allChunks.length,
      cappedAtMaxChunks,
    });

    const chunkSummaries: string[] = [];

    for (const chunk of chunks) {
      try {
        const summary = await this.summarizeChunk({
          chunk,
          label,
          questionText,
          modelKey,
          assignmentId,
          usageType,
          feature,
          language,
        });
        chunkSummaries.push(summary.trim());
      } catch (error) {
        this.logger.warn(
          `Chunk summarization failed for ${label}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        chunkSummaries.push(this.truncateToTokenLimit(chunk, 1200, modelKey));
      }
    }

    // Disclose the truncation to the grader without spending an LLM call on the
    // dropped tail.
    if (cappedAtMaxChunks) {
      chunkSummaries.push(
        "[remaining content omitted: input exceeded the summarization ceiling]",
      );
    }

    let summaryText = chunkSummaries.filter(Boolean).join("\n");

    if (this.tokenCounter.countTokens(summaryText, modelKey) > targetTokens) {
      summaryText = await this.compressSummary({
        summary: summaryText,
        label,
        modelKey,
        assignmentId,
        usageType,
        feature,
        targetTokens,
        language,
      });
    }

    summaryText = this.truncateToTokenLimit(
      summaryText,
      targetTokens,
      modelKey,
    );

    const finalTokens = this.tokenCounter.countTokens(summaryText, modelKey);

    return {
      text: summaryText,
      summarized: true,
      originalTokens,
      finalTokens,
    };
  }
}
