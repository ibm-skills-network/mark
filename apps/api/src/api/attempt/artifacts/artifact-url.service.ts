import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import IORedis from "ioredis";
import { PrismaService } from "../../../database/prisma.service";
import { createCacheRedisConnection } from "../../../job-queue/redis.connection";
import { S3Service } from "../../files/services/s3.service";
import { assertFetchableUrl, safeGet } from "../common/utils/ssrf-safe-http";
import { digest } from "./artifact-storage.service";

const URL_BYTE_LIMIT = 4 * 1024 * 1024;
const SOURCE_LIMIT = 10;
const RATE_SCRIPT =
  "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 60) end; return n";
function fetchable(raw: string): URL {
  let url: URL;
  try {
    url = assertFetchableUrl(raw);
  } catch {
    throw new BadRequestException("URL is not publicly fetchable.");
  }
  if (url.username || url.password || url.href.length > 8192)
    throw new BadRequestException(
      "URL credentials and oversized URLs are not supported.",
    );
  url.hash = "";
  return url;
}

@Injectable()
export class ArtifactUrlService implements OnModuleDestroy {
  private connection?: IORedis;
  private active = 0;
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}
  async onModuleDestroy() {
    await this.connection?.quit();
  }

  private async writable(
    tx: Prisma.TransactionClient,
    attemptId: number,
    assignmentId: number,
    userId: string,
  ) {
    const attempt = await tx.assignmentAttempt.findFirst({
      where: { id: attemptId, assignmentId, userId },
      include: { definition: true, submissions: true },
    });
    if (!attempt) throw new NotFoundException("Attempt not found");
    if (!attempt.definition)
      throw new ConflictException("This attempt uses the legacy API");
    if (
      attempt.submitted ||
      attempt.submissions.length > 0 ||
      (attempt.expiresAt && attempt.expiresAt <= new Date())
    )
      throw new ConflictException("Attempt no longer accepts sources");
    if (
      (await tx.attemptSource.count({ where: { attemptId } })) >= SOURCE_LIMIT
    )
      throw new ConflictException("Attempt source limit reached");
  }

  async capture(
    attemptId: number,
    assignmentId: number,
    userId: string,
    rawUrl: string,
  ) {
    const original = fetchable(rawUrl);
    await this.writable(this.prisma, attemptId, assignmentId, userId);
    if (this.active >= 4)
      throw new ServiceUnavailableException(
        "URL capture is busy. Try again shortly.",
      );
    this.connection ??= createCacheRedisConnection();
    let rate: number;
    try {
      rate = Number(
        await this.connection.eval(
          RATE_SCRIPT,
          1,
          `artifact-url-rate:${attemptId}`,
        ),
      );
    } catch {
      throw new ServiceUnavailableException(
        "URL capture is temporarily unavailable.",
      );
    }
    if (!Number.isSafeInteger(rate) || rate > 5)
      throw new HttpException(
        "URL capture rate limit reached. Try again shortly.",
        429,
      );
    // Recheck after the await so concurrent requests cannot bypass this process's cap.
    if (this.active >= 4)
      throw new ServiceUnavailableException(
        "URL capture is busy. Try again shortly.",
      );
    this.active++;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15_000);
    let stream: Readable | undefined;
    try {
      let redirects = 0;
      let redirectUrl: string | undefined;
      const response = await safeGet<Readable>(original.href, {
        responseType: "stream",
        signal: abort.signal,
        headers: { Accept: "text/html, text/plain, application/xhtml+xml" },
        beforeRedirect: (options) => {
          if (++redirects > 3)
            throw new BadRequestException("URL redirect limit exceeded.");
          const target = options as Record<string, unknown>;
          const protocol =
            typeof target.protocol === "string" ? target.protocol : "";
          const hostname =
            typeof target.hostname === "string" ? target.hostname : "";
          const port =
            typeof target.port === "string" || typeof target.port === "number"
              ? String(target.port)
              : "";
          const path = typeof target.path === "string" ? target.path : "/";
          const url = fetchable(
            `${protocol}//${hostname}${port ? `:${port}` : ""}${path}`,
          );
          if (options.auth)
            throw new BadRequestException("URL credentials are not supported.");
          redirectUrl = url.href;
        },
      });
      stream = response.data;
      const contentType = String(response.headers["content-type"] ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (
        !["text/html", "text/plain", "application/xhtml+xml"].includes(
          contentType,
        )
      )
        throw new BadRequestException(
          "Remote format is unsupported. Upload the original file instead.",
        );
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > URL_BYTE_LIMIT)
        throw new BadRequestException(
          "Remote content exceeds the URL capture limit.",
        );
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const raw of stream) {
        const chunk = Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw as Uint8Array);
        size += chunk.length;
        if (size > URL_BYTE_LIMIT)
          throw new BadRequestException(
            "Remote content exceeds the URL capture limit.",
          );
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      // follow-redirects reports responseUrl even for the helper's HTTPS upgrade.
      const request = response.request as
        | {
            res?: { responseUrl?: string };
            _redirectable?: { _currentUrl?: string };
          }
        | undefined;
      const resolved = fetchable(
        request?.res?.responseUrl ??
          request?._redirectable?._currentUrl ??
          redirectUrl ??
          response.config.url ??
          original.href,
      );
      const sourceId = randomUUID();
      const bucket = this.s3.getBucketName("learner");
      const storageKey = `canonical-url/${attemptId}/${sourceId}`;
      const stored = await this.s3.putObject(
        {
          Bucket: bucket,
          Key: storageKey,
          Body: bytes,
          ContentType: contentType,
        },
        abort.signal,
      );
      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "AssignmentAttempt" WHERE id = ${attemptId} FOR UPDATE`;
          await this.writable(tx, attemptId, assignmentId, userId);
          return tx.attemptSource.create({
            data: {
              id: sourceId,
              attemptId,
              uploadId: randomUUID(),
              bucket,
              storageKey,
              original: {
                create: {
                  checksum: digest(bytes),
                  byteSize: bytes.length,
                  mediaType: contentType,
                  filename:
                    contentType === "text/plain"
                      ? "captured.txt"
                      : "captured.html",
                  etag: stored.ETag,
                  objectVersion: stored.VersionId,
                  originalUrl: original.href,
                  resolvedUrl: resolved.href,
                },
              },
            },
            select: { id: true, attemptId: true, createdAt: true },
          });
        });
      } catch (error) {
        // Best-effort orphan cleanup. Storage lifecycle reconciliation must also
        // remove canonical-url keys without AttemptSource rows after a crash.
        try {
          await this.s3.deleteObject({ Bucket: bucket, Key: storageKey });
        } catch {
          /* retained for operator reconciliation */
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        "URL capture failed. Check the public URL or upload the original file.",
      );
    } finally {
      abort.abort();
      clearTimeout(timer);
      stream?.destroy();
      this.active--;
    }
  }
}
