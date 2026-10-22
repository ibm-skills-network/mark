import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ArtifactService, ARTIFACT_CONFIG_HASH } from "./artifact.service";
import { ArtifactStorageService, digest } from "./artifact-storage.service";
import { PrismaService } from "../../../database/prisma.service";
import { JobQueueService } from "../../../job-queue/job-queue.service";
import {
  parseArtifactIsolated,
  ArtifactParserError,
  ARTIFACT_EXTRACTOR_VERSION,
  ParserDocument,
} from "./parser/isolated-artifact-parser";
// Process isolation/native parsing has separate real-child tests. These tests exercise actual
// PostgreSQL transactions, leases and immutable rows with a deterministic parser boundary.
jest.mock("./parser/isolated-artifact-parser", () => ({
  ...jest.requireActual("./parser/isolated-artifact-parser"),
  parseArtifactIsolated: jest.fn(),
}));
const parse = parseArtifactIsolated as jest.MockedFunction<
  typeof parseArtifactIsolated
>;
const url = process.env.ATTEMPT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("canonical artifact persistence (real PostgreSQL)", () => {
  let prisma: PrismaClient;
  let service: ArtifactService;
  const objects = new Map<string, Buffer>();
  const queue = { enqueue: jest.fn().mockResolvedValue({}) };
  const storage = {
    read: jest.fn(async (_bucket: string, key: string) => {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("storage offline");
      return {
        bytes,
        checksum: digest(bytes),
        byteSize: bytes.length,
        mediaType: "text/plain",
      };
    }),
  };
  beforeAll(() => {
    if (
      !url ||
      !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
      !new URL(url).pathname.endsWith("/mark_part03")
    )
      throw new Error("Use isolated localhost mark_part03 database");
    prisma = new PrismaClient({ datasources: { db: { url } } });
    service = new ArtifactService(
      prisma as unknown as PrismaService,
      storage as unknown as ArtifactStorageService,
      queue as unknown as JobQueueService,
    );
  });
  beforeEach(() => {
    jest.clearAllMocks();
    parse.mockReset();
    parse.mockImplementation(async (bytes) => ({
      blocks: [
        {
          kind: "text",
          text: bytes.toString("utf8"),
          location: { lineStart: 1, lineEnd: 1 },
        },
      ],
      omissions: [],
      expandedBytes: bytes.length,
    }));
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  async function fixture() {
    const userId = `synthetic-${randomUUID()}`;
    const assignment = await prisma.assignment.create({
      data: {
        name: "Artifacts",
        type: "AI_GRADED",
        published: true,
        questionOrder: [],
      },
    });
    const attempt = await prisma.assignmentAttempt.create({
      data: {
        assignmentId: assignment.id,
        userId,
        submitted: false,
        questionOrder: [],
      },
    });
    await prisma.attemptDefinition.create({
      data: { attemptId: attempt.id, snapshot: {} },
    });
    const source = await prisma.attemptSource.create({
      data: {
        attemptId: attempt.id,
        uploadId: randomUUID(),
        storageKey: `${randomUUID()}.txt`,
        bucket: "local-only",
      },
    });
    objects.set(source.storageKey, Buffer.from("Decisive original content"));
    const status = await service.request(
      attempt.id,
      assignment.id,
      userId,
      source.id,
    );
    return {
      attemptId: attempt.id,
      assignmentId: assignment.id,
      userId,
      source,
      operationId: status.operationId!,
    };
  }
  const read = (f: Awaited<ReturnType<typeof fixture>>) =>
    service.read(f.attemptId, f.assignmentId, f.userId, f.source.id);
  it("persists and reuses a validated current-version checkpoint without reparsing", async () => {
    const f = await fixture();
    await service.process(f.operationId);
    const state = await read(f);
    expect(state.manifest?.status).toBe("success");
    expect(state.manifest?.source.checksum).toBe(
      digest(objects.get(f.source.storageKey)!),
    );
    await service.request(f.attemptId, f.assignmentId, f.userId, f.source.id);
    await service.process(f.operationId);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(await service.validateSources(f.attemptId, [f.source.id])).toEqual([
      {
        sourceId: f.source.id,
        artifactId: state.manifest!.artifactId,
        checksum: state.manifest!.source.checksum,
      },
    ]);
  });
  it("database rejects original, manifest and resource mutation", async () => {
    const f = await fixture();
    const bytes = Buffer.from("synthetic image bytes");
    const resourceId = `image-${digest(bytes)}`;
    parse.mockResolvedValueOnce({
      blocks: [{ kind: "image", resourceRef: resourceId, location: {} }],
      omissions: [],
      expandedBytes: bytes.length,
      resources: [
        {
          id: resourceId,
          mediaType: "image/png",
          base64: bytes.toString("base64"),
        },
      ],
    });
    await service.process(f.operationId);
    const artifactId = (await read(f)).manifest!.artifactId;
    await expect(
      prisma.artifactOriginal.update({
        where: { sourceId: f.source.id },
        data: { checksum: "b".repeat(64) },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.artifactManifest.update({
        where: { id: artifactId },
        data: { manifest: {} },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.artifactResource.delete({
        where: { artifactId_resourceId: { artifactId, resourceId } },
      }),
    ).rejects.toThrow();
    const resource = await service.resource(
      f.attemptId,
      f.assignmentId,
      f.userId,
      f.source.id,
      artifactId,
      resourceId,
    );
    expect(Buffer.from(resource.bytes)).toEqual(bytes);
    await expect(
      service.resource(
        f.attemptId,
        f.assignmentId,
        "other-user",
        f.source.id,
        artifactId,
        resourceId,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("rejects cross-attempt sources and changed originals at submission recheck", async () => {
    const f = await fixture();
    await service.process(f.operationId);
    await expect(
      service.read(f.attemptId, f.assignmentId, "other-user", f.source.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.validateSources(f.attemptId + 100000, [f.source.id]),
    ).rejects.toMatchObject({ status: 409 });
    objects.set(f.source.storageKey, Buffer.from("changed"));
    await expect(
      service.validateSources(f.attemptId, [f.source.id]),
    ).rejects.toMatchObject({ status: 409 });
    expect((await read(f)).manifest?.blocks[0].text).toBe(
      "Decisive original content",
    );
  });
  it("records retryable storage failure and recovers using the same operation", async () => {
    const f = await fixture();
    objects.delete(f.source.storageKey);
    await expect(service.process(f.operationId)).rejects.toThrow(
      "retry operation",
    );
    expect(await read(f)).toMatchObject({
      state: "FAILED",
      retryable: true,
      errorCode: "storage_unavailable",
    });
    objects.set(f.source.storageKey, Buffer.from("recovered"));
    await service.request(f.attemptId, f.assignmentId, f.userId, f.source.id);
    await service.process(f.operationId);
    expect((await read(f)).manifest?.status).toBe("success");
  });
  it("retains failed manifests when a dependency retry produces a new checkpoint", async () => {
    const f = await fixture();
    parse.mockRejectedValueOnce(
      new ArtifactParserError("dependency_unavailable"),
    );
    await expect(service.process(f.operationId)).rejects.toThrow(
      "retry operation",
    );
    const failed = (await read(f)).manifest!;
    expect(failed.status).toBe("failed");
    let release!: (document: ParserDocument) => void;
    let announce!: () => void;
    const started = new Promise<void>((resolve) => {
      announce = resolve;
    });
    parse.mockImplementationOnce(async () => {
      announce();
      return new Promise<ParserDocument>((resolve) => {
        release = resolve;
      });
    });
    const retry = service.process(f.operationId);
    await started;
    const processing = await read(f);
    expect(processing).toMatchObject({
      state: "PROCESSING",
      status: "pending",
    });
    expect(processing.manifest?.artifactId).toBe(failed.artifactId);
    release({
      blocks: [{ kind: "text", text: "recovered", location: {} }],
      omissions: [],
      expandedBytes: 9,
    });
    await retry;
    const recovered = (await read(f)).manifest!;
    expect(recovered.artifactId).not.toBe(failed.artifactId);
    expect(
      await prisma.artifactManifest.count({ where: { sourceId: f.source.id } }),
    ).toBe(2);
  });
  it("fences a stale parser and commits only the replacement lease", async () => {
    const f = await fixture();
    let release!: (document: ParserDocument) => void;
    let announce!: () => void;
    const started = new Promise<void>((resolve) => {
      announce = resolve;
    });
    parse.mockImplementationOnce(async () => {
      announce();
      return new Promise<ParserDocument>((resolve) => {
        release = resolve;
      });
    });
    const stale = service.process(f.operationId);
    await started;
    await expect(service.process(f.operationId)).rejects.toThrow(
      "retry operation",
    );
    await prisma.artifactExtraction.update({
      where: { id: f.operationId },
      data: { leaseExpiresAt: new Date(0) },
    });
    await service.process(f.operationId);
    release({
      blocks: [{ kind: "text", text: "stale", location: {} }],
      omissions: [],
      expandedBytes: 5,
    });
    await expect(stale).rejects.toThrow("retry operation");
    expect(
      await prisma.artifactManifest.count({ where: { sourceId: f.source.id } }),
    ).toBe(1);
    expect((await read(f)).manifest?.blocks[0].text).toBe(
      "Decisive original content",
    );
  });
  it("blocks partial evidence and isolates old extractor/config operations", async () => {
    const f = await fixture();
    parse.mockResolvedValueOnce({
      blocks: [{ kind: "text", text: "partial", location: {} }],
      omissions: [{ code: "missing_visual_evidence" }],
      expandedBytes: 7,
    });
    await service.process(f.operationId);
    await expect(
      service.validateSources(f.attemptId, [f.source.id]),
    ).rejects.toMatchObject({ status: 409 });
    const old = await prisma.artifactExtraction.create({
      data: {
        sourceId: f.source.id,
        extractorVersion: `${ARTIFACT_EXTRACTOR_VERSION}-old`,
        configHash: ARTIFACT_CONFIG_HASH,
      },
    });
    await expect(service.process(old.id)).rejects.toThrow("retry operation");
    expect((await read(f)).operationId).toBe(f.operationId);
    expect((await read(f)).manifest?.status).toBe("partial");
  });
  it("rejects dangling parser resources as terminal contract failures", async () => {
    const f = await fixture();
    parse.mockResolvedValueOnce({
      blocks: [
        { kind: "image", resourceRef: "missing-resource", location: {} },
      ],
      omissions: [],
      expandedBytes: 0,
    });
    await expect(service.process(f.operationId)).resolves.toMatchObject({
      state: "FAILED",
      errorCode: "parser_failure",
    });
    expect(await read(f)).toMatchObject({
      retryable: false,
      errorCode: "parser_failure",
    });
    expect(
      await prisma.artifactManifest.count({ where: { sourceId: f.source.id } }),
    ).toBe(0);
  });
  it("rejects a valid-shaped manifest belonging to another source", async () => {
    const f = await fixture();
    const g = await fixture();
    await service.process(f.operationId);
    await service.process(g.operationId);
    const foreign = (await read(g)).manifest!;
    await prisma.artifactExtraction.update({
      where: { id: f.operationId },
      data: { manifestId: foreign.artifactId },
    });
    await expect(read(f)).rejects.toMatchObject({
      code: "INVALID_ARTIFACT_CONTRACT",
    });
    await expect(
      service.validateSources(f.attemptId, [f.source.id]),
    ).rejects.toMatchObject({ code: "INVALID_ARTIFACT_CONTRACT" });
  });
  it("rejects extractor identity mismatch when reading a current checkpoint", async () => {
    const f = await fixture();
    await service.process(f.operationId);
    const manifest = (await read(f)).manifest!;
    const id = randomUUID();
    await prisma.artifactManifest.create({
      data: {
        id,
        sourceId: f.source.id,
        manifest: {
          ...manifest,
          artifactId: id,
          extractor: { ...manifest.extractor, configHash: "b".repeat(64) },
        },
      },
    });
    await prisma.artifactExtraction.update({
      where: { id: f.operationId },
      data: { manifestId: id },
    });
    await expect(read(f)).rejects.toMatchObject({
      code: "INVALID_ARTIFACT_CONTRACT",
    });
  });
  it("pins original and resolved URL identity and dispatches the captured bytes as URL evidence", async () => {
    const f = await fixture();
    const bytes = objects.get(f.source.storageKey)!;
    await prisma.artifactOriginal.create({
      data: {
        sourceId: f.source.id,
        checksum: digest(bytes),
        byteSize: bytes.length,
        mediaType: "text/html",
        filename: "captured.html",
        originalUrl: "https://public.example/redirect",
        resolvedUrl: "https://public.example/work",
      },
    });
    await service.process(f.operationId);
    expect(parse).toHaveBeenCalledWith(bytes, "url", "captured.html");
    expect((await read(f)).manifest?.source).toMatchObject({
      originalUrl: "https://public.example/redirect",
      resolvedUrl: "https://public.example/work",
      filename: "captured.html",
    });
  });
});
