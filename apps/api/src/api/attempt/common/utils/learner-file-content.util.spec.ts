import {
  LearnerFileContentTooLargeError,
  MAX_COERCED_FILE_CONTENT_DEPTH,
  MAX_COERCED_FILE_CONTENT_LENGTH,
  normalizeLearnerFileContent,
} from "./learner-file-content.util";

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("normalizeLearnerFileContent", () => {
  it("keeps string content as is", () => {
    expect(normalizeLearnerFileContent("InCos")).toEqual({
      content: "InCos",
      originalType: "string",
    });
    expect(normalizeLearnerFileContent("print(1)")).toEqual({
      content: "print(1)",
      originalType: "string",
    });
  });

  it("leaves missing content missing", () => {
    expect(normalizeLearnerFileContent(undefined)).toEqual({
      content: undefined,
      originalType: "undefined",
    });
    expect(normalizeLearnerFileContent(null)).toEqual({
      content: undefined,
      originalType: "null",
    });
  });

  it("serializes a parsed notebook object back to its JSON text", () => {
    const notebook = { cells: [{ cell_type: "code", source: ["x = 1"] }] };
    const result = normalizeLearnerFileContent(notebook);
    expect(result.originalType).toBe("object");
    expect(typeof result.content).toBe("string");
    expect(JSON.parse(result.content as string)).toEqual(notebook);
  });

  it("serializes a parsed JSON array", () => {
    const result = normalizeLearnerFileContent([{ a: 1 }]);
    expect(result).toEqual({ content: '[{"a":1}]', originalType: "array" });
  });

  it("turns primitives into their text", () => {
    expect(normalizeLearnerFileContent(42).content).toBe("42");
    expect(normalizeLearnerFileContent(true).content).toBe("true");
  });

  it("rejects serialized content over the size bound", () => {
    const huge = { blob: "x".repeat(MAX_COERCED_FILE_CONTENT_LENGTH) };
    expect(() => normalizeLearnerFileContent(huge)).toThrow(/too large/i);
  });

  it("serializes a realistic notebook exactly as JSON.stringify does", () => {
    const notebook = {
      cells: [
        {
          cell_type: "markdown",
          metadata: {},
          source: [
            "# Résumé — análisis\n",
            'Quote " and backslash \\ and tab\t',
          ],
        },
        {
          cell_type: "code",
          execution_count: 3,
          metadata: { collapsed: false, tags: [] },
          outputs: [
            {
              output_type: "execute_result",
              data: { "text/plain": ["0.1 + 0.2 = 0.30000000000000004"] },
              execution_count: 3,
              metadata: {},
            },
            {
              output_type: "stream",
              name: "stderr",
              text: ["\u0007 bell, \u2028 separator, 日本語, 😀\n"],
            },
          ],
          source: ["import numpy as np\n", "x = np.arange(10)"],
        },
        { cell_type: "raw", metadata: { skipped: undefined }, source: [] },
      ],
      metadata: {
        kernelspec: {
          display_name: "Python 3",
          language: "python",
          name: "python3",
        },
        language_info: { name: "python", version: "3.11.4" },
        nested: [[1, -0, 1e21, 1.5e-7, null, true, false]],
      },
      nbformat: 4,
      nbformat_minor: 5,
    };
    expect(normalizeLearnerFileContent(notebook).content).toBe(
      JSON.stringify(notebook),
    );
  });

  it("stops serializing as soon as the output passes the size bound", () => {
    const chunk = "x".repeat(1_000_000);
    let reads = 0;
    const hostile: Record<string, string> = {};
    for (let index = 0; index < 200; index++) {
      Object.defineProperty(hostile, `k${index}`, {
        enumerable: true,
        get: () => {
          reads++;
          return chunk;
        },
      });
    }

    const error = thrownBy(() => normalizeLearnerFileContent(hostile));
    expect(error).toBeInstanceOf(LearnerFileContentTooLargeError);
    // About 20 one-million-character values fit under the bound; the rest
    // must never be read, let alone serialized.
    expect(reads).toBeLessThanOrEqual(
      Math.ceil(MAX_COERCED_FILE_CONTENT_LENGTH / chunk.length) + 1,
    );
  });

  it("rejects content nested deeper than the depth bound", () => {
    let deep: unknown = "leaf";
    for (let index = 0; index < MAX_COERCED_FILE_CONTENT_DEPTH + 5; index++) {
      deep = { child: deep };
    }
    const error = thrownBy(() => normalizeLearnerFileContent(deep));
    expect(error).toBeInstanceOf(LearnerFileContentTooLargeError);
    expect((error as LearnerFileContentTooLargeError).reason).toBe("depth");
  });

  it("accepts content nested right up to the depth bound", () => {
    let deep: unknown = [];
    for (let index = 1; index < MAX_COERCED_FILE_CONTENT_DEPTH; index++) {
      deep = [deep];
    }
    expect(normalizeLearnerFileContent(deep).content).toBe(
      JSON.stringify(deep),
    );
  });

  it("rejects a cyclic value instead of recursing", () => {
    const cyclic: Record<string, unknown> = { name: "a" };
    cyclic.self = { back: cyclic };
    const error = thrownBy(() => normalizeLearnerFileContent(cyclic));
    expect(error).toBeInstanceOf(LearnerFileContentTooLargeError);
    expect((error as LearnerFileContentTooLargeError).reason).toBe("cycle");
  });

  it("serializes a value shared by two branches", () => {
    const shared = { a: 1 };
    const value = { left: shared, right: [shared, shared] };
    expect(normalizeLearnerFileContent(value).content).toBe(
      JSON.stringify(value),
    );
  });

  it("accepts content exactly at the size bound", () => {
    // {"blob":"…"} adds eleven characters around the string.
    const atBound = { blob: "x".repeat(MAX_COERCED_FILE_CONTENT_LENGTH - 11) };
    expect(normalizeLearnerFileContent(atBound).content).toHaveLength(
      MAX_COERCED_FILE_CONTENT_LENGTH,
    );
  });

  it("counts escapes toward the size bound", () => {
    const escapes = {
      text: "\n".repeat(MAX_COERCED_FILE_CONTENT_LENGTH / 2),
    };
    expect(() => normalizeLearnerFileContent(escapes)).toThrow(
      LearnerFileContentTooLargeError,
    );
  });
});
