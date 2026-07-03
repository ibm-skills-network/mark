import * as crypto from "node:crypto";
import { PromptTemplate } from "@langchain/core/prompts";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { StructuredOutputParser } from "@langchain/classic/output_parsers";
import { IPromptProcessor } from "../../../core/interfaces/prompt-processor.interface";
import { LLMResolverService } from "../../../core/services/llm-resolver.service";
import { extractStructuredJSON } from "../../../core/utils/structured-json.util";
import { LLM_RESOLVER_SERVICE, PROMPT_PROCESSOR } from "../../../llm.constants";
import {
  CriterionEvidence,
  CriterionEvidenceRequest,
  CriterionEvidenceResponse,
  EvidenceAnchor,
  EvidenceRetrievalStrategy,
  EvidenceValidationSchema,
  ExtractedChunk,
  RubricCriterion,
} from "../types/criterion-evidence.types";
import { ChunkIndex } from "./chunk-index.service";

export interface LlmCallRecorder {
  record: (parameters: {
    purpose: "retrieval" | "validation" | "grading" | "judge";
    model: string;
    prompt: string;
    response: string;
    durationMs: number;
  }) => void;
}

interface RetrievalConfig {
  maxCandidates: number;
  maxEvidence: number;
  minRelevance: number;
  enableLlmValidation: boolean;
  defaultStrategy: EvidenceRetrievalStrategy;
}

@Injectable()
export class CriterionEvidenceRetrievalService {
  private readonly logger = new Logger(CriterionEvidenceRetrievalService.name);
  private readonly cache = new Map<
    string,
    { value: CriterionEvidenceResponse; expiresAt: number }
  >();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly CACHE_MAX_SIZE = 200;
  private readonly config: RetrievalConfig;

  constructor(
    @Inject(PROMPT_PROCESSOR)
    private readonly promptProcessor: IPromptProcessor,
    @Inject(LLM_RESOLVER_SERVICE)
    private readonly llmResolver: LLMResolverService,
  ) {
    this.config = {
      maxCandidates: 18,
      maxEvidence: 6,
      minRelevance: 0.15,
      enableLlmValidation: true,
      defaultStrategy: "search",
    };
  }

  async retrieveEvidence(
    request: CriterionEvidenceRequest,
    index: ChunkIndex,
    recorder?: LlmCallRecorder,
  ): Promise<CriterionEvidenceResponse> {
    const strategy = request.strategy || this.config.defaultStrategy;
    const cacheKey = this.buildCacheKey(request, index);

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    if (cached) {
      this.cache.delete(cacheKey);
    }

    const query = this.buildQuery(request.criterion, request.question);
    const candidates = index.search(query, this.config.maxCandidates);
    const maxEvidence = request.maxEvidence ?? this.config.maxEvidence;

    let reranked: Array<{
      chunk: ExtractedChunk;
      score: number;
      relevance: number;
      combined: number;
    }> = [];

    if (candidates.length > 0) {
      const maxSearchScore = Math.max(...candidates.map((c) => c.score), 1);
      reranked = candidates
        .map((candidate) => {
          const relevance = this.computeRelevanceScore(
            request.criterion,
            candidate.chunk.text,
          );
          const combined =
            (candidate.score / maxSearchScore) * 0.6 + relevance * 0.4;
          return {
            ...candidate,
            relevance,
            combined,
          };
        })
        .filter((candidate) => candidate.relevance >= this.config.minRelevance)
        .sort((a, b) => b.combined - a.combined)
        .slice(0, maxEvidence);
    }

    if (reranked.length === 0) {
      const allChunks = index.getAllChunks();
      const scored = allChunks.map((chunk) => {
        const relevance = this.computeRelevanceScore(
          request.criterion,
          chunk.text,
        );
        return {
          chunk,
          score: 0,
          relevance,
          combined: relevance,
        };
      });

      const aboveThreshold = scored
        .filter((item) => item.relevance >= this.config.minRelevance)
        .sort((a, b) => b.combined - a.combined)
        .slice(0, maxEvidence);

      // Lexical relevance scoring misses genuinely relevant content with no
      // keyword overlap (e.g. numeric spreadsheet cells vs. prose rubric
      // language), so surface the top-scoring corpus chunks as *candidates*
      // here. LLM validation below is the actual relevance judge; its
      // verdict — even an empty one — is trusted as final.
      reranked =
        aboveThreshold.length > 0
          ? aboveThreshold
          : scored
              .sort((a, b) => b.combined - a.combined)
              .slice(0, this.config.maxCandidates);

      this.logger.log(
        `Evidence fallback for criterion ${request.criterion.id}: ` +
          `search=${candidates.length} candidates, reranked=0 after filter; ` +
          `surfaced ${reranked.length} chunks (aboveThreshold=${aboveThreshold.length})`,
      );
    }

    let evidence: CriterionEvidence[];
    let validatedCount = 0;

    if (strategy === "llm" || this.config.enableLlmValidation) {
      // The LLM validator is the actual relevance judge for these candidates
      // (which may include chunks below the lexical relevance threshold).
      // Its verdict is trusted as final — including an empty one, which
      // means none of the candidates actually address this criterion.
      const validation = await this.validateWithLlm(
        request,
        reranked.map((item) => item.chunk),
        recorder,
      );
      if (validation === undefined) {
        evidence = this.mapRerankedCandidatesToEvidence(reranked, maxEvidence);
      } else {
        validatedCount = validation.length;
        evidence = validation.map((item) => ({
          chunkId: item.chunk.chunkId,
          quote: item.chunk.text.slice(0, 220),
          anchor: item.chunk.anchor,
          sourceType: item.chunk.sourceType,
          sourceId: item.chunk.sourceId,
          relevanceScore: item.relevanceScore,
          searchScore: item.searchScore,
          contradiction: item.contradiction,
        }));
      }
    } else {
      evidence = this.mapRerankedCandidatesToEvidence(reranked, maxEvidence);
    }

    const response: CriterionEvidenceResponse = {
      criterionId: request.criterion.id,
      evidence,
      strategyUsed: strategy,
      retrievedAt: new Date().toISOString(),
      debug: {
        candidateCount: candidates.length,
        validatedCount,
      },
    };

    this.evictIfNeeded();
    this.cache.set(cacheKey, {
      value: response,
      expiresAt: Date.now() + CriterionEvidenceRetrievalService.CACHE_TTL_MS,
    });
    return response;
  }

  private mapRerankedCandidatesToEvidence(
    reranked: Array<{
      chunk: ExtractedChunk;
      score: number;
      relevance: number;
    }>,
    maxEvidence: number,
  ): CriterionEvidence[] {
    return reranked.slice(0, maxEvidence).map((item) => ({
      chunkId: item.chunk.chunkId,
      quote: item.chunk.text.slice(0, 220),
      anchor: item.chunk.anchor,
      sourceType: item.chunk.sourceType,
      sourceId: item.chunk.sourceId,
      relevanceScore: item.relevance,
      searchScore: item.score,
    }));
  }

  private evictIfNeeded(): void {
    if (this.cache.size < CriterionEvidenceRetrievalService.CACHE_MAX_SIZE)
      return;
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
    if (this.cache.size >= CriterionEvidenceRetrievalService.CACHE_MAX_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
  }

  private buildCacheKey(
    request: CriterionEvidenceRequest,
    index: ChunkIndex,
  ): string {
    const chunkHashes = index
      .getAllChunks()
      .map((chunk) => chunk.hash)
      .join("|");
    const raw = `${request.question}:${request.criterion.id}:${chunkHashes}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  private buildQuery(criterion: RubricCriterion, question: string): string {
    const criteriaDescriptions = criterion.criteria
      .map((level) => level.description)
      .join(" ");
    return [
      question,
      criterion.rubricQuestion,
      criterion.description,
      criteriaDescriptions,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 600);
  }

  private computeRelevanceScore(
    criterion: RubricCriterion,
    text: string,
  ): number {
    const criterionTokens = this.tokenize(
      `${criterion.rubricQuestion} ${criterion.description} ${criterion.criteria
        .map((level) => level.description)
        .join(" ")}`,
    );
    const chunkTokens = this.tokenize(text);

    if (criterionTokens.size === 0 || chunkTokens.size === 0) {
      return 0;
    }

    let overlap = 0;
    for (const token of criterionTokens) {
      if (chunkTokens.has(token)) overlap += 1;
    }

    return overlap / criterionTokens.size;
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replaceAll(/[^\s\w]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 2),
    );
  }

  private async validateWithLlm(
    request: CriterionEvidenceRequest,
    chunks: ExtractedChunk[],
    recorder?: LlmCallRecorder,
  ): Promise<
    | Array<{
        chunk: ExtractedChunk;
        relevanceScore: number;
        searchScore: number;
        contradiction: boolean;
      }>
    | undefined
  > {
    if (chunks.length === 0) return [];

    const parser = StructuredOutputParser.fromZodSchema(
      EvidenceValidationSchema,
    );
    const formatInstructions = parser.getFormatInstructions();

    const prompt = new PromptTemplate({
      template: `You are validating evidence for a single grading criterion.

CRITERION:
{criterion}

QUESTION CONTEXT:
{question}

CANDIDATE CHUNKS (ID + text + anchor):
{chunks}

Return JSON listing which chunkIds are relevant.
- relevance: supports | partial | contradicts | irrelevant
- If irrelevant, still include it if it clearly contradicts the criterion.
- Keep only the most relevant 6 chunks.

{format_instructions}`,
      inputVariables: [],
      partialVariables: {
        criterion: () =>
          `${request.criterion.rubricQuestion}\n${request.criterion.description}`,
        question: () => request.question,
        chunks: () =>
          chunks
            .map(
              (chunk) =>
                `- ${chunk.chunkId}: ${chunk.text.slice(
                  0,
                  240,
                )} | ${this.formatAnchor(chunk.anchor)}`,
            )
            .join("\n"),
        format_instructions: () => formatInstructions,
      },
    });

    const model =
      request.modelOverride ||
      (await this.llmResolver.getModelForValidationTask(
        "evidence_validation",
        request.question.length,
      ));

    const start = Date.now();
    const response = await this.promptProcessor.processPromptForFeature(
      prompt,
      request.assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
      "evidence_validation",
      model,
    );
    const duration = Date.now() - start;
    const responseText =
      typeof response === "string" ? response : String(response);
    const promptText =
      typeof prompt.template === "string"
        ? prompt.template
        : String(prompt.template);

    if (recorder) {
      recorder.record({
        purpose: "validation",
        model,
        prompt: promptText,
        response: responseText,
        durationMs: duration,
      });
    }

    const candidates = [
      ...new Set([responseText, extractStructuredJSON(responseText)]),
    ];

    for (const candidate of candidates) {
      try {
        return this.mapParsedSelections(
          await parser.parse(candidate),
          chunks,
          request.maxEvidence ?? this.config.maxEvidence,
        );
      } catch {
        this.logger.warn("Evidence validation parse failed");
      }
    }

    this.logger.warn("Evidence validation parse failed for all candidates");
    return undefined;
  }

  private mapParsedSelections(
    parsed: { evidence?: Array<{ chunkId?: string; relevance?: string }> },
    chunks: ExtractedChunk[],
    maxEvidence: number,
  ): Array<{
    chunk: ExtractedChunk;
    relevanceScore: number;
    searchScore: number;
    contradiction: boolean;
  }> {
    const chunkMap = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));

    return (parsed.evidence || [])
      .map((selection) => {
        if (!selection.chunkId) return null;
        const chunk = chunkMap.get(selection.chunkId);
        if (!chunk) return null;

        const relevance = selection.relevance ?? "irrelevant";
        const relevanceScore = this.mapRelevanceScore(relevance);
        return {
          chunk,
          relevanceScore,
          searchScore: relevanceScore,
          contradiction: relevance === "contradicts",
        };
      })
      .filter((item): item is NonNullable<typeof item> => !!item)
      .filter((item) => item.relevanceScore > 0.1)
      .slice(0, maxEvidence);
  }

  private mapRelevanceScore(relevance: string): number {
    switch (relevance) {
      case "supports": {
        return 1;
      }
      case "partial": {
        return 0.6;
      }
      case "contradicts": {
        return 0.2;
      }
      default: {
        return 0;
      }
    }
  }

  private formatAnchor(anchor?: EvidenceAnchor | null): string {
    if (!anchor || typeof anchor !== "object") return "anchor:unknown";
    switch (anchor.type) {
      case "file": {
        return `page:${anchor.page}, block:${anchor.blockId || "n/a"}`;
      }
      case "text": {
        return `offsets:${anchor.startOffset}-${anchor.endOffset}`;
      }
      case "image": {
        return `image:${anchor.imageId || "n/a"}`;
      }
      case "url": {
        return `url:${anchor.url}, paragraph:${anchor.paragraphIndex || "n/a"}`;
      }
      default: {
        return "anchor:unknown";
      }
    }
  }
}
