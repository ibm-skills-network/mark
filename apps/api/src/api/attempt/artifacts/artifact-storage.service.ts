import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { S3Service } from "../../files/services/s3.service";
import {
  ArtifactParserError,
  PARSER_LIMITS,
} from "./parser/isolated-artifact-parser";

export class ArtifactStorageError extends Error {
  readonly code = "storage_unavailable";
  constructor() {
    super("Artifact storage unavailable");
  }
}

export const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

@Injectable()
export class ArtifactStorageService {
  constructor(private readonly s3: S3Service) {}

  async read(bucket: string, key: string) {
    const controller = new AbortController();
    let body: { destroy?: () => void } | undefined;
    let timer: NodeJS.Timeout;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        body?.destroy?.();
        reject(new ArtifactStorageError());
      }, 15_000);
    });
    const read = async () => {
      const object = await this.s3.getObject(
        { Bucket: bucket, Key: key },
        controller.signal,
      );
      body = object.Body as { destroy?: () => void } | undefined;
      if (controller.signal.aborted) {
        body?.destroy?.();
        throw new ArtifactStorageError();
      }
      if ((object.ContentLength ?? 0) > PARSER_LIMITS.inputBytes)
        throw new ArtifactParserError("input_limit");
      if (!object.Body) throw new ArtifactStorageError();
      body = object.Body as { destroy?: () => void };
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > PARSER_LIMITS.inputBytes) {
          controller.abort();
          throw new ArtifactParserError("input_limit");
        }
        chunks.push(bytes);
      }
      if (object.ContentLength !== undefined && object.ContentLength !== size)
        throw new ArtifactStorageError();
      const bytes = Buffer.concat(chunks);
      return {
        bytes,
        checksum: digest(bytes),
        byteSize: size,
        mediaType: object.ContentType ?? "application/octet-stream",
        etag: object.ETag,
        objectVersion: object.VersionId,
      };
    };
    try {
      return await Promise.race([read(), deadline]);
    } catch (error) {
      if (error instanceof ArtifactParserError) throw error;
      throw new ArtifactStorageError();
    } finally {
      controller.abort();
      body?.destroy?.();
      clearTimeout(timer);
    }
  }
}
