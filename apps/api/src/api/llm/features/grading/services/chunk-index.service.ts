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

  constructor(chunks: ExtractedChunk[]) {
    this.chunkMap = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
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

    const documents = chunks.map((chunk) => ({
      id: chunk.chunkId,
      text: chunk.text,
    }));

    this.index.addAll(documents);
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
      .map((result) => ({
        chunk: this.chunkMap.get(result.id)!,
        score: result.score,
      }))
      .filter((item) => item.chunk);
  }

  getChunk(chunkId: string): ExtractedChunk | undefined {
    return this.chunkMap.get(chunkId);
  }

  getAllChunks(): ExtractedChunk[] {
    return [...this.chunkMap.values()];
  }
}
