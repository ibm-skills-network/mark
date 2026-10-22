/* eslint-disable unicorn/no-null */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import {
  artifactFormatCapabilities,
  ArtifactContractError,
  CanonicalArtifactV1,
  parseCanonicalArtifact,
} from "backend-contracts";
import { PrismaService } from "../../../database/prisma.service";
import { JobQueueService } from "../../../job-queue/job-queue.service";
import {
  JOB_NAMES,
  JOB_QUEUE_NAMES,
} from "../../../job-queue/job-queue.constants";
import { ArtifactStorageService, digest } from "./artifact-storage.service";
import {
  ARTIFACT_EXTRACTOR_VERSION,
  ARTIFACT_EXTRACTOR_DEPENDENCIES,
  ArtifactParserError,
  PARSER_LIMITS,
  parseArtifactIsolated,
  ParserDocument,
} from "./parser/isolated-artifact-parser";

export const ARTIFACT_CONFIG_HASH = digest(
  JSON.stringify({
    limits: PARSER_LIMITS,
    version: ARTIFACT_EXTRACTOR_VERSION,
    dependencies: ARTIFACT_EXTRACTOR_DEPENDENCIES,
  }),
);
const extractor = {
  name: "mark-canonical",
  version: ARTIFACT_EXTRACTOR_VERSION,
  configHash: ARTIFACT_CONFIG_HASH,
};
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const formatFor = (filename: string) =>
  artifactFormatCapabilities.find((item) =>
    item.extensions.includes(extname(filename).toLowerCase()),
  )?.format ?? "unsupported";

@Injectable()
export class ArtifactService {
  private active = 0;
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ArtifactStorageService,
    private readonly queue: JobQueueService,
  ) {}

  private async verifiedManifest(
    record: { id: string; sourceId: string; manifest: Prisma.JsonValue },
    source: { id: string; attemptId: number },
    current = true,
  ) {
    const manifest = parseCanonicalArtifact(record.manifest);
    const pinned = await this.prisma.artifactOriginal.findUnique({
      where: { sourceId: source.id },
    });
    if (
      record.sourceId !== source.id ||
      manifest.artifactId !== record.id ||
      manifest.source.sourceId !== source.id ||
      manifest.source.attemptId !== source.attemptId ||
      !pinned ||
      manifest.source.checksum !== pinned.checksum ||
      manifest.source.byteSize !== pinned.byteSize ||
      manifest.source.mediaType !== pinned.mediaType ||
      manifest.source.filename !== pinned.filename ||
      manifest.source.originalUrl !== (pinned.originalUrl ?? undefined) ||
      manifest.source.resolvedUrl !== (pinned.resolvedUrl ?? undefined) ||
      manifest.extractor.name !== extractor.name ||
      (current &&
        (manifest.extractor.version !== extractor.version ||
          manifest.extractor.configHash !== extractor.configHash))
    ) {
      throw new ArtifactContractError();
    }
    return manifest;
  }

  private async owned(
    attemptId: number,
    assignmentId: number,
    userId: string,
    sourceId: string,
  ) {
    const source = await this.prisma.attemptSource.findFirst({
      where: {
        id: sourceId,
        attemptId,
        attempt: { assignmentId, userId, definition: { isNot: null } },
      },
    });
    if (!source) throw new NotFoundException("Source not found");
    return source;
  }

  async request(
    attemptId: number,
    assignmentId: number,
    userId: string,
    sourceId: string,
  ) {
    await this.owned(attemptId, assignmentId, userId, sourceId);
    const operation = await this.prisma.artifactExtraction.upsert({
      where: {
        sourceId_extractorVersion_configHash: {
          sourceId,
          extractorVersion: extractor.version,
          configHash: extractor.configHash,
        },
      },
      create: {
        sourceId,
        extractorVersion: extractor.version,
        configHash: extractor.configHash,
      },
      update: {},
    });
    if (
      operation.state !== "COMPLETE" &&
      (operation.state !== "FAILED" || operation.retryable)
    ) {
      // No fixed BullMQ id: a retained failed queue record must not suppress an explicit retry.
      // Database leases provide deduplication and fence stale workers.
      await this.queue.enqueue(
        JOB_QUEUE_NAMES.ATTEMPT_HEAVY,
        JOB_NAMES.ARTIFACT_EXTRACT,
        { operationId: operation.id },
      );
    }
    return this.read(attemptId, assignmentId, userId, sourceId);
  }

  async read(
    attemptId: number,
    assignmentId: number,
    userId: string,
    sourceId: string,
  ) {
    const source = await this.owned(attemptId, assignmentId, userId, sourceId);
    const operation = await this.prisma.artifactExtraction.findUnique({
      where: {
        sourceId_extractorVersion_configHash: {
          sourceId,
          extractorVersion: extractor.version,
          configHash: extractor.configHash,
        },
      },
    });
    const record = operation?.manifestId
      ? await this.prisma.artifactManifest.findUnique({
          where: { id: operation.manifestId },
        })
      : null;
    if (operation?.state === "COMPLETE" && !record)
      throw new ArtifactContractError();
    const manifest = record
      ? await this.verifiedManifest(record, source)
      : undefined;
    return {
      sourceId,
      operationId: operation?.id,
      state: operation?.state ?? "NOT_REQUESTED",
      status:
        operation?.state === "PENDING" || operation?.state === "PROCESSING"
          ? "pending"
          : (manifest?.status ??
            (operation?.state === "FAILED" ? "failed" : "pending")),
      retryable: operation?.retryable ?? false,
      errorCode: operation?.errorCode,
      gradeable: false,
      manifest,
    };
  }

  async resource(
    attemptId: number,
    assignmentId: number,
    userId: string,
    sourceId: string,
    artifactId: string,
    resourceId: string,
  ) {
    const source = await this.owned(attemptId, assignmentId, userId, sourceId);
    const record = await this.prisma.artifactManifest.findFirst({
      where: { id: artifactId, sourceId },
    });
    if (!record) throw new NotFoundException("Artifact not found");
    const manifest = await this.verifiedManifest(record, source, false);
    if (resourceId === "original") {
      const original = await this.storage.read(
        source.bucket,
        source.storageKey,
      );
      if (original.checksum !== manifest.source.checksum)
        throw new ConflictException("Original integrity mismatch");
      return { bytes: original.bytes, mediaType: "application/octet-stream" };
    }
    if (
      !manifest.blocks.some(
        (block) => block.resourceRef === `${artifactId}:${resourceId}`,
      )
    )
      throw new NotFoundException("Resource not found");
    const resource = await this.prisma.artifactResource.findUnique({
      where: { artifactId_resourceId: { artifactId, resourceId } },
    });
    if (!resource || digest(resource.bytes) !== resource.checksum)
      throw new NotFoundException("Resource not found");
    return resource;
  }

  /** Authoritative recheck before freezing or consuming evidence. Never use extension as gradeability. */
  async validateSources(attemptId: number, sourceIds: string[]) {
    const pinned: { sourceId: string; artifactId: string; checksum: string }[] =
      [];
    for (const sourceId of new Set(sourceIds)) {
      const source = await this.prisma.attemptSource.findFirst({
        where: { id: sourceId, attemptId },
      });
      const operation = await this.prisma.artifactExtraction.findUnique({
        where: {
          sourceId_extractorVersion_configHash: {
            sourceId,
            extractorVersion: extractor.version,
            configHash: extractor.configHash,
          },
        },
      });
      const record = operation?.manifestId
        ? await this.prisma.artifactManifest.findUnique({
            where: { id: operation.manifestId },
          })
        : null;
      if (!source || operation?.state !== "COMPLETE" || !record)
        throw new ConflictException("Source extraction is not ready");
      const manifest = await this.verifiedManifest(record, source);
      if (
        manifest.status !== "success" ||
        manifest.source.attemptId !== attemptId ||
        manifest.source.sourceId !== sourceId
      )
        throw new ConflictException(
          "Source requires correction or evidence review",
        );
      const original = await this.storage.read(
        source.bucket,
        source.storageKey,
      );
      if (original.checksum !== manifest.source.checksum)
        throw new ConflictException("Original integrity mismatch");
      pinned.push({
        sourceId,
        artifactId: record.id,
        checksum: original.checksum,
      });
    }
    return pinned;
  }

  async process(operationId: string): Promise<unknown> {
    if (this.active >= 2) throw new Error("Artifact worker capacity reached");
    this.active++;
    const token = randomUUID();
    let claimed = false;
    let stage: "storage" | "parser" | "persistence" = "persistence";
    try {
      const claim = await this.prisma.artifactExtraction.updateMany({
        where: {
          id: operationId,
          OR: [
            { state: "PENDING" },
            { state: "FAILED", retryable: true },
            { state: "PROCESSING", leaseExpiresAt: { lt: new Date() } },
          ],
        },
        data: {
          state: "PROCESSING",
          leaseToken: token,
          leaseExpiresAt: new Date(Date.now() + 120_000),
          errorCode: null,
          retryable: false,
        },
      });
      if (!claim.count) {
        const existing = await this.prisma.artifactExtraction.findUnique({
          where: { id: operationId },
        });
        if (existing?.state === "PROCESSING")
          throw new Error("Artifact lease is held");
        return { state: existing?.state ?? "NOT_FOUND" };
      }
      claimed = true;
      const operation = await this.prisma.artifactExtraction.findUniqueOrThrow({
        where: { id: operationId },
        include: { source: true },
      });
      if (
        operation.extractorVersion !== extractor.version ||
        operation.configHash !== extractor.configHash
      )
        throw new ArtifactParserError("dependency_unavailable");
      const source = operation.source;
      stage = "storage";
      const original = await this.storage.read(
        source.bucket,
        source.storageKey,
      );
      const filename = basename(source.storageKey);
      stage = "persistence";
      const pinned = await this.prisma.artifactOriginal.upsert({
        where: { sourceId: source.id },
        create: {
          sourceId: source.id,
          checksum: original.checksum,
          byteSize: original.byteSize,
          mediaType: original.mediaType,
          filename,
          etag: original.etag,
          objectVersion: original.objectVersion,
        },
        update: {},
      });
      if (pinned.checksum !== original.checksum) {
        await this.fail(operationId, token, "integrity_mismatch", false);
        return { state: "FAILED" };
      }
      stage = "parser";
      const start = Date.now();
      let document: ParserDocument = {
        blocks: [],
        omissions: [],
        expandedBytes: 0,
      };
      let failure: CanonicalArtifactV1["failure"];
      try {
        document = await parseArtifactIsolated(
          original.bytes,
          pinned.originalUrl ? "url" : formatFor(pinned.filename),
          pinned.filename,
        );
      } catch (error) {
        const code =
          error instanceof ArtifactParserError ? error.code : "parser_failure";
        failure = { code, retryable: code === "dependency_unavailable" };
      }
      const artifactId = randomUUID();
      const resources = (document.resources ?? []).map((resource) => {
        const bytes = Buffer.from(resource.base64, "base64");
        if (
          !["image/png", "image/jpeg", "image/webp"].includes(
            resource.mediaType,
          ) ||
          resource.id !== `image-${digest(bytes)}`
        )
          throw new ArtifactContractError();
        return {
          artifactId,
          resourceId: resource.id,
          mediaType: resource.mediaType,
          checksum: digest(bytes),
          bytes,
        };
      });
      if (
        resources.reduce((size, resource) => size + resource.bytes.length, 0) >
        PARSER_LIMITS.expandedBytes
      )
        throw new ArtifactParserError("output_limit");
      const resourceIds = new Set(
        resources.map((resource) => resource.resourceId),
      );
      if (
        resourceIds.size !== resources.length ||
        document.blocks.some(
          (block) =>
            block.resourceRef &&
            block.resourceRef !== "original" &&
            !resourceIds.has(block.resourceRef),
        )
      )
        throw new ArtifactContractError();
      const blocks = document.blocks.map((block, index) => ({
        ...block,
        id: `${source.id}:${index}`,
        ...(block.resourceRef
          ? {
              resourceRef:
                block.resourceRef === "original"
                  ? `source:${source.id}`
                  : `${artifactId}:${block.resourceRef}`,
            }
          : {}),
      }));
      const manifest = parseCanonicalArtifact({
        schemaVersion: 1,
        artifactId,
        source: {
          sourceId: source.id,
          attemptId: source.attemptId,
          checksum: pinned.checksum,
          byteSize: pinned.byteSize,
          mediaType: pinned.mediaType,
          filename: pinned.filename,
          ...(pinned.originalUrl ? { originalUrl: pinned.originalUrl } : {}),
          ...(pinned.resolvedUrl ? { resolvedUrl: pinned.resolvedUrl } : {}),
        },
        extractor,
        createdAt: new Date().toISOString(),
        status: failure
          ? failure.code === "unsupported_format"
            ? "unsupported"
            : "failed"
          : document.omissions.length > 0
            ? "partial"
            : blocks.length > 0
              ? "success"
              : "empty",
        blocks,
        omissions: document.omissions,
        failure,
        metrics: {
          inputBytes: original.byteSize,
          expandedBytes: document.expandedBytes,
          outputBytes: Buffer.byteLength(JSON.stringify(document)),
          textCharacters: blocks.reduce(
            (sum, block) => sum + (block.text?.length ?? 0),
            0,
          ),
          blockCount: blocks.length,
          durationMs: Date.now() - start,
        },
      });
      stage = "persistence";
      await this.prisma.$transaction(async (tx) => {
        const winner = await tx.artifactExtraction.updateMany({
          where: {
            id: operationId,
            state: "PROCESSING",
            leaseToken: token,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            state: failure ? "FAILED" : "COMPLETE",
            manifestId: artifactId,
            errorCode: failure?.code ?? null,
            retryable: failure?.retryable ?? false,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (!winner.count) throw new Error("Artifact lease lost");
        await tx.artifactManifest.create({
          data: {
            id: artifactId,
            sourceId: source.id,
            manifest: json(manifest),
          },
        });
        if (resources.length > 0)
          await tx.artifactResource.createMany({ data: resources });
      });
      if (failure?.retryable)
        throw new ArtifactParserError(failure.code as "dependency_unavailable");
      return { artifactId, status: manifest.status };
    } catch (error) {
      if (claimed) {
        const code =
          error instanceof ArtifactParserError
            ? error.code
            : error instanceof ArtifactContractError || stage === "parser"
              ? "parser_failure"
              : "storage_unavailable";
        const retryable =
          code === "storage_unavailable" || code === "dependency_unavailable";
        await this.fail(operationId, token, code, retryable);
        if (!retryable) return { state: "FAILED", errorCode: code };
      }
      // Never include storage keys, URLs or parser input in queue-visible errors.
      throw new Error("Artifact processing unavailable; retry operation");
    } finally {
      this.active--;
    }
  }

  private fail(
    id: string,
    leaseToken: string,
    errorCode: string,
    retryable: boolean,
  ) {
    return this.prisma.artifactExtraction.updateMany({
      where: { id, state: "PROCESSING", leaseToken },
      data: {
        state: "FAILED",
        errorCode,
        retryable,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  }
}
