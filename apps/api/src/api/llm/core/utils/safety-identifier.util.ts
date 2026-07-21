import { createHash } from "node:crypto";

/**
 * OpenAI's safety_identifier must be a stable, privacy-preserving end-user
 * id. userId is an email in this system, so hash it — the raw address must
 * never reach request options or OpenAI.
 */
export function hashSafetyIdentifier(userId: string): string {
  return createHash("sha256").update(userId.trim().toLowerCase()).digest("hex");
}

export function safetyIdentifierKwargs(options?: {
  safetyIdentifier?: string;
}): Record<string, string> {
  return options?.safetyIdentifier
    ? { safety_identifier: options.safetyIdentifier }
    : {};
}
