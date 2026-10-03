import { ChunkIndex } from "./chunk-index.service";
import { ExtractedChunk } from "../types/criterion-evidence.types";

it("ranks notebook learner text without visual notes and returns the complete evidence", () => {
  const chunks: ExtractedChunk[] = [
    {
      chunkId: "count",
      hash: "count",
      text: "count agricultural images: 3000",
      sourceType: "file",
      sourceId: "s",
      anchor: { type: "file", page: 1, blockId: "count" },
    },
    {
      chunkId: "plot",
      hash: "plot",
      text: "draw a plot\ncount agricultural images count agricultural images",
      sourceType: "file",
      sourceId: "s",
      anchor: { type: "file", page: 1, blockId: "plot" },
      metadata: { anchorTextChars: 11 },
    },
    {
      chunkId: "image",
      hash: "image",
      text: "count agricultural images",
      sourceType: "file",
      sourceId: "s",
      anchor: { type: "image", page: 1, imageId: "image" },
    },
  ];
  const index = new ChunkIndex(chunks);
  expect(
    index.searchNotebookCode("count agricultural images", 1)[0].chunk,
  ).toBe(chunks[0]);
  expect(index.searchNotebookCode("draw plot", 1)[0].chunk).toBe(chunks[1]);
  expect(index.searchNotebookCode("draw plot", 1)[0].chunk.text).toContain(
    "count agricultural images",
  );
});
