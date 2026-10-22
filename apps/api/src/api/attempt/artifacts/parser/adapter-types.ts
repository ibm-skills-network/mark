import type { ArtifactBlock, CanonicalArtifactV1 } from "backend-contracts";

export interface AdapterLimits {
  inputBytes: number;
  expandedBytes: number;
  outputBytes: number;
  files?: number;
  nesting?: number;
}
export interface ParserDocument {
  blocks: Omit<ArtifactBlock, "id">[];
  omissions: CanonicalArtifactV1["omissions"];
  expandedBytes: number;
  resources?: { id: string; mediaType: string; base64: string }[];
  empty?: boolean;
}
export function enforceDocumentLimits(
  document: ParserDocument,
  limits: AdapterLimits,
): ParserDocument {
  if (
    document.blocks.length > 2000 ||
    document.omissions.length > 2000 ||
    document.expandedBytes > limits.expandedBytes
  )
    throw new Error("expansion_limit");
  if (Buffer.byteLength(JSON.stringify(document)) > limits.outputBytes)
    throw new Error("output_limit");
  return document;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("corrupt_input");
  return value as Record<string, unknown>;
}
export function sourceText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string"))
    return value.join("");
  throw new Error("corrupt_input");
}
