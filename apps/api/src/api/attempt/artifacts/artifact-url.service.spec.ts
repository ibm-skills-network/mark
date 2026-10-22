import { Readable } from "node:stream";
import { ArtifactUrlService } from "./artifact-url.service";
import { PrismaService } from "../../../database/prisma.service";
import { S3Service } from "../../files/services/s3.service";
import { safeGet } from "../common/utils/ssrf-safe-http";
import { createCacheRedisConnection } from "../../../job-queue/redis.connection";

jest.mock("../../../job-queue/redis.connection", () => ({
  createCacheRedisConnection: jest.fn(),
}));
jest.mock("../common/utils/ssrf-safe-http", () => ({
  ...jest.requireActual("../common/utils/ssrf-safe-http"),
  safeGet: jest.fn(),
}));
describe("bounded server-owned URL originals", () => {
  const writable = {
    id: 4,
    definition: {},
    submitted: false,
    submissions: [],
    expiresAt: null,
  };
  let prisma: any;
  let s3: any;
  let redis: any;
  let service: ArtifactUrlService;
  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      assignmentAttempt: { findFirst: jest.fn().mockResolvedValue(writable) },
      attemptSource: {
        count: jest.fn().mockResolvedValue(0),
        create: jest
          .fn()
          .mockImplementation(async ({ data }) => ({
            id: data.id,
            attemptId: data.attemptId,
          })),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(async (callback) => callback(prisma)),
    };
    s3 = {
      getBucketName: jest.fn().mockReturnValue("private-fixtures"),
      putObject: jest.fn().mockResolvedValue({ ETag: "e1" }),
      deleteObject: jest.fn().mockResolvedValue({}),
    };
    redis = { eval: jest.fn().mockResolvedValue(1), quit: jest.fn() };
    (createCacheRedisConnection as jest.Mock).mockReturnValue(redis);
    (safeGet as jest.Mock).mockResolvedValue({
      data: Readable.from([Buffer.from("LATE".repeat(100))]),
      headers: { "content-type": "text/plain" },
      config: { url: "https://public.example/work" },
      request: { res: { responseUrl: "https://public.example/final" } },
    });
    service = new ArtifactUrlService(prisma as PrismaService, s3 as S3Service);
  });
  it("retains full original with server-owned checksum, key, scope and both URL identities", async () => {
    await service.capture(4, 2, "learner", "https://public.example/work");
    expect(s3.putObject.mock.calls[0][0].Body.length).toBe(400);
    const saved = prisma.attemptSource.create.mock.calls[0][0].data;
    expect(saved.attemptId).toBe(4);
    expect(saved.storageKey).toMatch(/^canonical-url\/4\/[a-f\d-]+$/);
    expect(saved.original.create).toMatchObject({
      byteSize: 400,
      originalUrl: "https://public.example/work",
      resolvedUrl: "https://public.example/final",
    });
    expect(saved.original.create.checksum).toMatch(/^[a-f\d]{64}$/);
    expect(safeGet).toHaveBeenCalledWith(
      "https://public.example/work",
      expect.objectContaining({
        responseType: "stream",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it("rejects credentials and private IP literals without network or storage work", async () => {
    for (const url of [
      "http://127.0.0.1/a",
      "https://name:secret@public.example/a", // pragma: allowlist secret -- deliberately fake rejected URL credentials
      "file:///tmp/test",
    ])
      await expect(service.capture(4, 2, "u", url)).rejects.toThrow();
    expect(safeGet).not.toHaveBeenCalled();
    expect(s3.putObject).not.toHaveBeenCalled();
  });
  it("checks owner, immutability and source caps before fetching", async () => {
    prisma.assignmentAttempt.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.capture(4, 2, "u", "https://public.example/a"),
    ).rejects.toThrow("not found");
    prisma.assignmentAttempt.findFirst.mockResolvedValueOnce({
      ...writable,
      submissions: [{ id: "s" }],
    });
    await expect(
      service.capture(4, 2, "u", "https://public.example/a"),
    ).rejects.toThrow("no longer");
    prisma.attemptSource.count.mockResolvedValue(10);
    await expect(
      service.capture(4, 2, "u", "https://public.example/a"),
    ).rejects.toThrow("limit");
    expect(safeGet).not.toHaveBeenCalled();
  });
  it("fails closed on distributed rate limits and limiter outages", async () => {
    redis.eval.mockResolvedValueOnce(6);
    await expect(
      service.capture(4, 2, "u", "https://public.example/a"),
    ).rejects.toThrow("rate limit");
    redis.eval.mockRejectedValueOnce(new Error("redis details"));
    await expect(
      service.capture(4, 2, "u", "https://public.example/a"),
    ).rejects.toThrow("temporarily unavailable");
    expect(safeGet).not.toHaveBeenCalled();
  });
  it("bounds actual streamed bytes even when content-length lies", async () => {
    (safeGet as jest.Mock).mockResolvedValue({
      data: Readable.from([Buffer.alloc(4 * 1024 * 1024 + 1)]),
      headers: { "content-type": "text/plain", "content-length": "1" },
      config: {},
    });
    await expect(
      service.capture(4, 2, "u", "https://public.example/a"),
    ).rejects.toThrow("exceeds");
    expect(s3.putObject).not.toHaveBeenCalled();
  });
  it("rejects unsupported remote media", async () => {
    (safeGet as jest.Mock).mockResolvedValue({
      data: Readable.from([]),
      headers: { "content-type": "application/pdf" },
      config: {},
    });
    await expect(
      service.capture(4, 2, "u", "https://public.example/a"),
    ).rejects.toThrow("unsupported");
    expect(s3.putObject).not.toHaveBeenCalled();
  });
  it("rechecks redirects including private literals and credentials without replacing guarded agents", async () => {
    await service.capture(4, 2, "u", "https://public.example/a");
    const options = (safeGet as jest.Mock).mock.calls[0][1];
    expect(options.httpAgent).toBeUndefined();
    expect(options.httpsAgent).toBeUndefined();
    expect(() =>
      options.beforeRedirect({
        protocol: "http:",
        hostname: "169.254.169.254",
        path: "/latest",
      }),
    ).toThrow();
    expect(() =>
      options.beforeRedirect({
        protocol: "https:",
        hostname: "public.example",
        auth: "user:secret", // pragma: allowlist secret -- synthetic redirect credentials
      }),
    ).toThrow();
  });
  it("rejects a submit racing the fetch and removes the unbound stored object", async () => {
    prisma.assignmentAttempt.findFirst
      .mockResolvedValueOnce(writable)
      .mockResolvedValueOnce({ ...writable, submitted: true });
    await expect(
      service.capture(4, 2, "u", "https://public.example/a"),
    ).rejects.toThrow("no longer");
    expect(prisma.attemptSource.create).not.toHaveBeenCalled();
    expect(s3.deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: "private-fixtures",
        Key: expect.stringMatching(/^canonical-url\//),
      }),
    );
  });
});
