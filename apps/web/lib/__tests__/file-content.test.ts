import { Buffer } from "buffer";

import { fetchFileContentSafe } from "../shared";

const fetchMock = jest.fn();

const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  }) as Response;

// Mirrors the API's DataTransformInterceptor, which base64-encodes `content` once.
const serverEncode = (text: string) =>
  Buffer.from(text, "utf8").toString("base64");

const notebook = JSON.stringify(
  {
    cells: [
      {
        cell_type: "code",
        execution_count: 1,
        metadata: {},
        outputs: [{ name: "stdout", output_type: "stream", text: ["42\n"] }],
        source: ["print(6 * 7)"],
      },
    ],
    metadata: { kernelspec: { name: "python3" } },
    nbformat: 4,
    nbformat_minor: 5,
  },
  null,
  1,
);

describe("fetchFileContentSafe", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("returns a stored notebook as its original text with its size", async () => {
    const size = Buffer.byteLength(notebook, "utf8");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: serverEncode(notebook),
        filename: "analysis.ipynb",
        size,
      }),
    );

    const result = await fetchFileContentSafe(
      "learner/7/analysis.ipynb",
      "learner-bucket",
      "analysis.ipynb",
    );

    expect(result.error).toBeUndefined();
    expect(result.content).toBe(notebook);
    expect(result.size).toBe(size);
  });

  it("keeps short digit-only text the API sends unencoded", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ content: "0400", filename: "count.txt", size: 4 }),
    );

    const result = await fetchFileContentSafe(
      "learner/7/count.txt",
      "learner-bucket",
      "count.txt",
    );

    expect(result.content).toBe("0400");
  });

  it("keeps a leading byte-order mark", async () => {
    const csv = "﻿name,score\nada,10\n";
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: serverEncode(csv),
        filename: "scores.csv",
        size: Buffer.byteLength(csv, "utf8"),
      }),
    );

    const result = await fetchFileContentSafe(
      "learner/7/scores.csv",
      "learner-bucket",
      "scores.csv",
    );

    expect(result.content).toBe(csv);
  });

  it("returns the storage size for files previewed by URL", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        filename: "report.pdf",
        size: 2048,
        contentType: "application/pdf",
        viewUrl: "https://storage.example/report.pdf",
      }),
    );

    const result = await fetchFileContentSafe(
      "learner/7/report.pdf",
      "learner-bucket",
      "report.pdf",
    );

    expect(result.url).toBe("https://storage.example/report.pdf");
    expect(result.size).toBe(2048);
  });
});
