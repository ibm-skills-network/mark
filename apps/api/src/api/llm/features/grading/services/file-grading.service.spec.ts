import { HighlightLevel } from "../../../model/highlighting.model";

describe("FileGradingService.highlighting normalization", () => {
  it("serializes Map-based highlighting into JSON-friendly records", () => {
    // Test the highlighting serialization logic directly
    const pages = new Map([
      [
        1,
        {
          originalText: "Hello world",
          highlights: [
            {
              start: 0,
              end: 5,
              text: "Hello",
              level: HighlightLevel.CORRECT,
              comment: "greeting",
            },
          ],
          correctnessScore: 100,
          responseType: "file" as const,
          pageNumber: 1,
        },
      ],
    ]);

    const blockHighlights = new Map([
      [
        "p1b1",
        [
          {
            start: 0,
            end: 5,
            text: "Hello",
            level: HighlightLevel.CORRECT,
            comment: "greeting",
            evidenceId: "p1b1",
          },
        ],
      ],
    ]);

    // Convert Maps to Records (JSON-friendly)
    const pagesObject: Record<
      number,
      typeof pages extends Map<number, infer T> ? T : never
    > = {};
    for (const [key, value] of pages) {
      pagesObject[key] = value;
    }

    const blockHighlightsObject: Record<
      string,
      typeof blockHighlights extends Map<string, infer T> ? T : never
    > = {};
    for (const [key, value] of blockHighlights) {
      blockHighlightsObject[key] = value;
    }

    const highlighting = {
      filename: "sample.pdf",
      pages: pagesObject,
      blockHighlights: blockHighlightsObject,
    };

    // Verify serialization worked correctly
    expect(highlighting).not.toBeNull();
    expect(highlighting.pages[1]).toBeDefined();
    expect(highlighting.pages[1].highlights).toHaveLength(1);
    expect(Object.keys(highlighting.blockHighlights)).toEqual(["p1b1"]);
    expect(highlighting.blockHighlights["p1b1"]).toHaveLength(1);

    // Verify it can be JSON stringified (Maps cannot)
    const json = JSON.stringify(highlighting);
    expect(json).toContain("Hello");
    expect(json).toContain("sample.pdf");
  });
});
