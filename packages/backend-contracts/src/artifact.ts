import { z } from "zod";

const count = z.number().int().nonnegative().safe();
const positive = z.number().int().positive().safe();
const identity = z.string().min(1).max(256);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

// Locations name evidence in its original medium; no positional truncation or
// client-supplied display label is allowed to become its identity.
export const artifactLocationSchema = z
  .object({
    page: positive.optional(),
    sheet: z.string().min(1).max(256).optional(),
    cell: z.string().min(1).max(128).optional(),
    slide: positive.optional(),
    notebookCell: count.optional(),
    archivePath: z.string().min(1).max(4096).optional(),
    lineStart: positive.optional(),
    lineEnd: positive.optional(),
    section: z.string().min(1).max(512).optional(),
    url: z.string().url().max(8192).optional(),
  })
  .strict()
  .superRefine((location, context) => {
    if (
      location.lineEnd !== undefined &&
      (location.lineStart === undefined ||
        location.lineEnd < location.lineStart)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid line range",
      });
    }
    if (
      location.archivePath !== undefined &&
      (location.archivePath.startsWith("/") ||
        location.archivePath.includes("\\") ||
        location.archivePath.split("/").includes(".."))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid archive location",
      });
    }
  });

export const artifactSourceSchema = z
  .object({
    sourceId: z.string().uuid(),
    attemptId: positive,
    checksum: sha256,
    byteSize: count,
    mediaType: z.string().min(1).max(256),
    filename: z.string().min(1).max(1024).optional(),
    originalUrl: z.string().url().max(8192).optional(),
    resolvedUrl: z.string().url().max(8192).optional(),
    repositoryCommit: z.string().min(1).max(256).optional(),
  })
  .strict();

export const artifactExtractorSchema = z
  .object({
    name: identity,
    version: identity,
    configHash: sha256,
  })
  .strict();

export const artifactOmissionCodeSchema = z.enum([
  "missing_visual_evidence",
  "unsupported_feature",
  "truncated_input",
  "truncated_output",
  "expansion_limit",
  "missing_content",
  "parser_warning",
]);
export const artifactFailureCodeSchema = z.enum([
  "corrupt_input",
  "input_limit",
  "expansion_limit",
  "output_limit",
  "timeout",
  "cancelled",
  "dependency_unavailable",
  "storage_unavailable",
  "unsupported_format",
  "parser_failure",
  "integrity_mismatch",
]);
export const artifactBlockSchema = z
  .object({
    id: identity,
    kind: z.enum(["text", "code", "table", "image", "chart", "audio", "video"]),
    text: z.string().optional(),
    // Opaque server-owned reference, never raw bytes, credentials or a signed URL.
    resourceRef: identity.optional(),
    location: artifactLocationSchema,
  })
  .strict()
  .superRefine((block, context) => {
    if (block.text === undefined && block.resourceRef === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Block has no evidence",
      });
    }
  });

export const canonicalArtifactV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    artifactId: z.string().uuid(),
    source: artifactSourceSchema,
    extractor: artifactExtractorSchema,
    createdAt: z.string().datetime(),
    status: z.enum(["success", "empty", "partial", "unsupported", "failed"]),
    blocks: z.array(artifactBlockSchema),
    metrics: z
      .object({
        inputBytes: count,
        expandedBytes: count,
        outputBytes: count,
        textCharacters: count,
        blockCount: count,
        durationMs: z.number().finite().nonnegative(),
      })
      .strict(),
    omissions: z.array(
      z
        .object({
          code: artifactOmissionCodeSchema,
          location: artifactLocationSchema.optional(),
          // Safe diagnostic description only, never parser stderr or source content.
          detail: z.string().max(512).optional(),
        })
        .strict(),
    ),
    failure: z
      .object({ code: artifactFailureCodeSchema, retryable: z.boolean() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((artifact, context) => {
    const invalid = (message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, message });
    if (artifact.metrics.inputBytes !== artifact.source.byteSize)
      invalid("Source byte count mismatch");
    if (artifact.metrics.blockCount !== artifact.blocks.length)
      invalid("Block count mismatch");
    if (
      artifact.metrics.textCharacters !==
      artifact.blocks.reduce((sum, block) => sum + (block.text?.length ?? 0), 0)
    )
      invalid("Text count mismatch");
    if (
      artifact.blocks.some(
        (block) => !block.id.startsWith(`${artifact.source.sourceId}:`),
      )
    )
      invalid("Block identity must include source identity");
    if (
      new Set(artifact.blocks.map((block) => block.id)).size !==
      artifact.blocks.length
    )
      invalid("Duplicate block identity");
    if (
      artifact.status === "success" &&
      (artifact.omissions.length !== 0 ||
        artifact.failure !== undefined ||
        artifact.blocks.length === 0)
    )
      invalid("Success requires evidence without omissions");
    if (
      artifact.status === "empty" &&
      (artifact.blocks.length !== 0 ||
        artifact.omissions.length !== 0 ||
        artifact.failure !== undefined)
    )
      invalid("Empty requires a complete empty extraction");
    if (artifact.status === "partial" && artifact.omissions.length === 0)
      invalid("Partial extraction requires omissions");
    if (artifact.status === "failed" && artifact.failure === undefined)
      invalid("Failure category required");
    if (
      artifact.status === "unsupported" &&
      artifact.failure?.code !== "unsupported_format"
    )
      invalid("Unsupported category required");
    if (artifact.status === "failed" || artifact.status === "unsupported") {
      if (artifact.blocks.length !== 0)
        invalid("Failed extraction cannot expose usable blocks");
    }
  });

export type ArtifactSource = z.infer<typeof artifactSourceSchema>;
export type ArtifactExtractor = z.infer<typeof artifactExtractorSchema>;
export type ArtifactBlock = z.infer<typeof artifactBlockSchema>;
export type ArtifactLocation = z.infer<typeof artifactLocationSchema>;
export type ArtifactFailureCode = z.infer<typeof artifactFailureCodeSchema>;
export type CanonicalArtifactV1 = z.infer<typeof canonicalArtifactV1Schema>;

export class ArtifactContractError extends Error {
  readonly code = "INVALID_ARTIFACT_CONTRACT";
  readonly retryable = false;
  constructor() {
    super("The extracted artifact could not be verified.");
    this.name = "ArtifactContractError";
  }
}

export function parseCanonicalArtifact(input: unknown): CanonicalArtifactV1 {
  const parsed = canonicalArtifactV1Schema.safeParse(input);
  if (!parsed.success) throw new ArtifactContractError();
  return parsed.data;
}

// This is cache compatibility only. Callers must independently authorize the
// source and verify its original bytes; checksums never grant access.
export function canReuseArtifact(
  artifact: CanonicalArtifactV1,
  source: ArtifactSource,
  extractor: ArtifactExtractor,
): boolean {
  return (
    artifact.source.sourceId === source.sourceId &&
    artifact.source.attemptId === source.attemptId &&
    artifact.source.checksum === source.checksum &&
    artifact.source.byteSize === source.byteSize &&
    artifact.extractor.name === extractor.name &&
    artifact.extractor.version === extractor.version &&
    artifact.extractor.configHash === extractor.configHash &&
    (artifact.status === "success" ||
      artifact.status === "empty" ||
      artifact.status === "partial")
  );
}

export const artifactExtractionJobSchema = z
  .object({ operationId: z.string().uuid() })
  .strict();
export type ArtifactExtractionJob = z.infer<typeof artifactExtractionJobSchema>;
export function parseArtifactExtractionJob(
  input: unknown,
): ArtifactExtractionJob {
  const result = artifactExtractionJobSchema.safeParse(input);
  if (!result.success) throw new ArtifactContractError();
  return result.data;
}
