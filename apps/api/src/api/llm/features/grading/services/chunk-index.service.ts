import MiniSearch from "minisearch";
import { ExtractedChunk } from "../types/criterion-evidence.types";

interface SearchDocument {
  id: string;
  text: string;
}

interface SearchResult {
  id: string;
  score: number;
}

export class ChunkIndex {
  private readonly index: MiniSearch<SearchDocument>;
  private readonly chunkMap: Map<string, ExtractedChunk>;
  private readonly _eligibleCount: number;

  constructor(chunks: ExtractedChunk[]) {
    // Only index eligible chunks; ineligible ones cannot be retrieved as evidence.
    // Chunks without a quality annotation (pre-classification callers) are treated as eligible.
    const eligible = chunks.filter(
      (chunk) => chunk.quality?.eligibility !== "ineligible",
    );
    this.chunkMap = new Map(eligible.map((chunk) => [chunk.chunkId, chunk]));
    this._eligibleCount = eligible.length;

    this.index = new MiniSearch<SearchDocument>({
      fields: ["text"],
      storeFields: ["text"],
      tokenize: (string: string) =>
        string
          .toLowerCase()
          .split(/\s+/)
          .filter((token) => token.length > 1),
      processTerm: (term: string) => term.toLowerCase(),
    });

    const documents = eligible.map((chunk) => ({
      id: chunk.chunkId,
      text: chunk.text,
    }));

    this.index.addAll(documents);
  }

  get eligibleCount(): number {
    return this._eligibleCount;
  }

  get hasEligibleChunks(): boolean {
    return this._eligibleCount > 0;
  }

  search(
    query: string,
    limit = 8,
  ): Array<{ chunk: ExtractedChunk; score: number }> {
    if (!query.trim()) return [];

    const results = this.index.search(query, {
      fuzzy: 0.2,
      prefix: true,
      boost: { text: 2 },
    }) as SearchResult[];

    return results
      .slice(0, limit)
      .map((result) => {
        const chunk = this.chunkMap.get(result.id);
        return {
          chunk,
          score: result.score,
        };
      })
      .filter((item) => item.chunk);
  }

  getChunk(chunkId: string): ExtractedChunk | undefined {
    return this.chunkMap.get(chunkId);
  }

  getAllChunks(): ExtractedChunk[] {
    return [...this.chunkMap.values()];
  }
}
