import { Readable } from "node:stream";
import { ArtifactStorageService, digest } from "./artifact-storage.service";
import { S3Service } from "../../files/services/s3.service";
import { PARSER_LIMITS } from "./parser/isolated-artifact-parser";

describe("bounded original retrieval", () => {
  function fixture(body: AsyncIterable<Uint8Array>, contentLength?: number) {
    const getObject = jest
      .fn()
      .mockResolvedValue({
        Body: body,
        ContentLength: contentLength,
        ContentType: "text/plain",
      });
    return {
      getObject,
      storage: new ArtifactStorageService({
        getObject,
      } as unknown as S3Service),
    };
  }
  it("hashes the full stream including decisive late bytes", async () => {
    const bytes = Buffer.from("x".repeat(400) + "decisive evidence");
    const { storage, getObject } = fixture(
      Readable.from([bytes.subarray(0, 200), bytes.subarray(200)]),
    );
    const result = await storage.read("bucket", "key");
    expect(result.bytes).toEqual(bytes);
    expect(result.checksum).toBe(digest(bytes));
    expect(getObject.mock.calls[0][1].aborted).toBe(true);
  });
  it("enforces actual streamed bytes despite a dishonest ContentLength", async () => {
    const { storage, getObject } = fixture(
      Readable.from([Buffer.alloc(PARSER_LIMITS.inputBytes), Buffer.from("x")]),
      1,
    );
    await expect(storage.read("bucket", "key")).rejects.toMatchObject({
      code: "input_limit",
    });
    expect(getObject.mock.calls[0][1].aborted).toBe(true);
  });
  it("rejects oversized advertised input before consuming it", async () => {
    const next = jest.fn();
    const { storage } = fixture(
      { [Symbol.asyncIterator]: () => ({ next }) },
      PARSER_LIMITS.inputBytes + 1,
    );
    await expect(storage.read("bucket", "key")).rejects.toMatchObject({
      code: "input_limit",
    });
    expect(next).not.toHaveBeenCalled();
  });
  it("aborts stalled object reads at the total storage deadline", async () => {
    jest.useFakeTimers();
    try {
      const getObject = jest.fn(
        (_input, signal: AbortSignal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
          ),
      );
      const storage = new ArtifactStorageService({
        getObject,
      } as unknown as S3Service);
      const pending = expect(
        storage.read("bucket", "key"),
      ).rejects.toMatchObject({ code: "storage_unavailable" });
      await jest.advanceTimersByTimeAsync(15_000);
      await pending;
    } finally {
      jest.useRealTimers();
    }
  });
  it("rejects truncated storage bodies even when the stream ends cleanly", async () => {
    const { storage } = fixture(Readable.from([Buffer.from("short")]), 100);
    await expect(storage.read("bucket", "key")).rejects.toMatchObject({
      code: "storage_unavailable",
    });
  });
  it("bounds a hung body even if its iterator ignores the abort signal", async () => {
    jest.useFakeTimers();
    try {
      const destroy = jest.fn();
      const body = {
        destroy,
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
        }),
      };
      const { storage } = fixture(body);
      const pending = expect(
        storage.read("bucket", "key"),
      ).rejects.toMatchObject({ code: "storage_unavailable" });
      await jest.advanceTimersByTimeAsync(15_000);
      await pending;
      expect(destroy).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
