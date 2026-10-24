import type { GradingIssueCode } from "src/api/llm/features/grading/errors/grading-failure";

/**
 * Turns "this uploaded file could not be used as evidence" into the reason a
 * learner can act on: the bytes are a different format than the extension
 * claims, the file is password-protected, empty, has no text layer, or is
 * simply damaged.
 */

export type FileIssueCode = Extract<
  GradingIssueCode,
  | "file_wrong_format"
  | "file_corrupt"
  | "file_encrypted"
  | "file_empty"
  | "file_no_text"
  | "source_unreadable"
>;

export interface FileIssueClassification {
  code: FileIssueCode;
  detectedType?: string;
  expectedType?: string;
}

/** What the leading bytes say the file is. Undefined when there is no signature. */
export function sniffFileType(buffer: Buffer): string | undefined {
  if (buffer.length === 0) return undefined;
  const head = buffer.subarray(0, 16);
  const startsWith = (...bytes: number[]) =>
    bytes.every((byte, index) => head[index] === byte);

  if (startsWith(0x25, 0x50, 0x44, 0x46)) return "pdf";
  if (startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0x50, 0x4b, 0x05, 0x06))
    return "zip";
  if (startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return "ole";
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return "png";
  if (startsWith(0xff, 0xd8, 0xff)) return "jpeg";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "gif";
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    head.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "webp";
  if (startsWith(0x52, 0x61, 0x72, 0x21)) return "rar";
  if (startsWith(0x37, 0x7a, 0xbc, 0xaf)) return "7z";
  if (startsWith(0x1f, 0x8b)) return "gzip";

  const text = buffer
    .subarray(0, 512)
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (/^<!doctype\s+html|^<html[\s>]|^<head[\s>]|^<body[\s>]/i.test(text))
    return "html";
  if (/^[[{]/.test(text)) return "json";
  return undefined;
}

// Extension -> the container signature a well-formed file of that kind has.
const EXPECTED_SIGNATURE: Record<string, string> = {
  pdf: "pdf",
  docx: "zip",
  xlsx: "zip",
  pptx: "zip",
  xlsm: "zip",
  odt: "zip",
  ods: "zip",
  odp: "zip",
  zip: "zip",
  jar: "zip",
  doc: "ole",
  xls: "ole",
  ppt: "ole",
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  gif: "gif",
  webp: "webp",
  ipynb: "json",
};

// Office stores a password-protected .docx/.xlsx/.pptx as an OLE container
// with an "EncryptedPackage" stream (the name is UTF-16LE in the directory).
const ENCRYPTED_PACKAGE_MARKER = Buffer.from("EncryptedPackage", "utf16le");

export function extensionOf(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  return base.includes(".") ? (base.split(".").pop() ?? "").toLowerCase() : "";
}

/** True for a password-protected PDF or Office file. */
export function isEncryptedDocument(buffer: Buffer): boolean {
  const signature = sniffFileType(buffer);
  if (signature === "pdf") {
    // The trailer of an encrypted PDF references an /Encrypt dictionary.
    return buffer.includes("/Encrypt");
  }
  if (signature === "ole") {
    return buffer.includes(ENCRYPTED_PACKAGE_MARKER);
  }
  return false;
}

/** Signature facts recorded at extraction time, so the grading gate can explain a failure. */
export interface FileSignatureFacts {
  sniffedType?: string;
  encrypted?: boolean;
}

export function describeFileSignature(buffer: Buffer): FileSignatureFacts {
  const sniffedType = sniffFileType(buffer);
  const facts: FileSignatureFacts = {};
  if (sniffedType) facts.sniffedType = sniffedType;
  if (isEncryptedDocument(buffer)) facts.encrypted = true;
  return facts;
}

/**
 * Why a submitted file is not usable evidence.
 *
 * `failure` is "extraction" when a parser failed and "no_content" when parsing
 * worked but produced nothing to grade.
 */
export function classifyFileProblem(input: {
  fileName: string;
  failure: "extraction" | "no_content";
  size?: number;
  sniffedType?: string;
  encrypted?: boolean;
  errorMessage?: string;
}): FileIssueClassification {
  const extension = extensionOf(input.fileName);
  const expected = EXPECTED_SIGNATURE[extension];

  if (input.encrypted || /password|encrypt/i.test(input.errorMessage ?? "")) {
    return { code: "file_encrypted" };
  }
  if (input.size === 0) return { code: "file_empty" };
  if (expected && input.sniffedType && input.sniffedType !== expected) {
    return {
      code: "file_wrong_format",
      detectedType: input.sniffedType,
      expectedType: extension,
    };
  }
  if (input.failure === "no_content") {
    return extension === "pdf"
      ? { code: "file_no_text" }
      : { code: "file_empty" };
  }
  return { code: "file_corrupt" };
}
