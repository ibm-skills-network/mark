import { JsonValue } from "@prisma/client/runtime/library";
import { S3Service } from "src/api/files/services/s3.service";

interface ChatFileAttachmentRecord {
  id?: string;
  filename: string;
  size?: number;
  contentType?: string;
  extension?: string;
  s3Bucket: string;
  s3Key: string;
  s3Link: string;
}

export interface ChatFileAttachmentToolCalls {
  type: "file_attachments";
  files: ChatFileAttachmentRecord[];
}

interface ChatAttachmentTarget {
  bucket: string;
  prefix: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readOptionalNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parseS3Link(link: string): { bucket: string; key: string } | null {
  if (!link.startsWith("s3://")) {
    return null;
  }

  const withoutScheme = link.slice("s3://".length);
  const firstSlashIndex = withoutScheme.indexOf("/");
  if (firstSlashIndex <= 0 || firstSlashIndex === withoutScheme.length - 1) {
    return null;
  }

  const bucket = withoutScheme.slice(0, firstSlashIndex).trim();
  const rawKey = withoutScheme.slice(firstSlashIndex + 1);
  if (!bucket || !rawKey) {
    return null;
  }

  try {
    return { bucket, key: decodeURIComponent(rawKey) };
  } catch {
    return { bucket, key: rawKey };
  }
}

function toCanonicalS3Link(bucket: string, key: string): string {
  return `s3://${bucket}/${key}`;
}

function buildAllowedTargets(
  s3Service: S3Service,
  userIds: string[],
): ChatAttachmentTarget[] {
  const dedupedUserIds = [
    ...new Set(
      userIds.filter((userId) => typeof userId === "string" && userId),
    ),
  ];
  const authorBucket = s3Service.getBucketName("author");
  const chatbotBucket = s3Service.getBucketName("chatbot");

  return dedupedUserIds.flatMap((userId) => [
    { bucket: authorBucket, prefix: `authors/${userId}/` },
    { bucket: chatbotBucket, prefix: `chatbot/${userId}/` },
  ]);
}

function isAllowedTarget(
  bucket: string,
  key: string,
  allowedTargets: ChatAttachmentTarget[],
): boolean {
  return allowedTargets.some(
    (target) => bucket === target.bucket && key.startsWith(target.prefix),
  );
}

function normalizeFileAttachment(
  file: unknown,
  allowedTargets: ChatAttachmentTarget[],
): ChatFileAttachmentRecord | null {
  if (!isRecord(file)) {
    return null;
  }

  const bucketFromFields = readOptionalString(file, "s3Bucket");
  const keyFromFields = readOptionalString(file, "s3Key");
  const linkFromFields = readOptionalString(file, "s3Link");
  const parsedLink = linkFromFields ? parseS3Link(linkFromFields) : null;

  if (
    bucketFromFields &&
    keyFromFields &&
    parsedLink &&
    (parsedLink.bucket !== bucketFromFields || parsedLink.key !== keyFromFields)
  ) {
    return null;
  }

  const bucket = bucketFromFields ?? parsedLink?.bucket;
  const key = keyFromFields ?? parsedLink?.key;
  if (!bucket || !key || !isAllowedTarget(bucket, key, allowedTargets)) {
    return null;
  }

  const filename = readOptionalString(file, "filename") ?? key.split("/").pop();
  if (!filename) {
    return null;
  }

  return {
    id: readOptionalString(file, "id"),
    filename,
    size: readOptionalNumber(file, "size"),
    contentType: readOptionalString(file, "contentType"),
    extension: readOptionalString(file, "extension"),
    s3Bucket: bucket,
    s3Key: key,
    s3Link: toCanonicalS3Link(bucket, key),
  };
}

export function hasFileAttachmentToolCalls(
  toolCalls: JsonValue | undefined,
): boolean {
  return isRecord(toolCalls) && toolCalls.type === "file_attachments";
}

export function normalizeChatFileAttachmentToolCalls(
  toolCalls: JsonValue | undefined,
  s3Service: S3Service,
  userIds: string[],
): ChatFileAttachmentToolCalls | undefined {
  if (!isRecord(toolCalls) || toolCalls.type !== "file_attachments") {
    return undefined;
  }

  const files = Array.isArray(toolCalls.files) ? toolCalls.files : [];
  const allowedTargets = buildAllowedTargets(s3Service, userIds);
  const normalizedFiles = files
    .map((file) => normalizeFileAttachment(file, allowedTargets))
    .filter((file): file is ChatFileAttachmentRecord => file !== null);

  if (normalizedFiles.length === 0) {
    return undefined;
  }

  return {
    type: "file_attachments",
    files: normalizedFiles,
  };
}
