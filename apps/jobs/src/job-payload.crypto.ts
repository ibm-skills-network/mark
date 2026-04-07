import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ENCRYPTION_VERSION = "v1";
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

interface EncryptedJobPayloadEnvelope {
  version: typeof ENCRYPTION_VERSION;
  algorithm: typeof ENCRYPTION_ALGORITHM;
  encryptedPayload: string;
}

export function getJobQueueSecret(): string {
  const secret = process.env.JOB_QUEUE_SECRET; // pragma: allowlist secret
  if (secret) {
    return secret;
  }

  if (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test" ||
    process.env.NODE_ENV === undefined
  ) {
    return "mark-local-job-queue-secret-change-me";
  }

  throw new Error(
    "JOB_QUEUE_SECRET must be set to encrypt background job payloads",
  );
}

function getEncryptionKey(): Buffer {
  return createHash("sha256").update(getJobQueueSecret()).digest();
}

function isEncryptedJobPayloadEnvelope(
  value: unknown,
): value is EncryptedJobPayloadEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    "encryptedPayload" in value &&
    typeof value.encryptedPayload === "string" &&
    "version" in value &&
    typeof value.version === "string" &&
    "algorithm" in value &&
    typeof value.algorithm === "string"
  );
}

export function encryptJobPayload(
  payload: unknown,
): EncryptedJobPayloadEnvelope {
  const initializationVector = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(
    ENCRYPTION_ALGORITHM,
    getEncryptionKey(),
    initializationVector,
  );
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const packedPayload = Buffer.concat([
    initializationVector,
    authTag,
    encrypted,
  ]).toString("base64url");

  return {
    version: ENCRYPTION_VERSION,
    algorithm: ENCRYPTION_ALGORITHM,
    encryptedPayload: packedPayload,
  };
}

export function decryptJobPayload<T>(payload: unknown): T {
  if (!isEncryptedJobPayloadEnvelope(payload)) {
    return payload as T;
  }

  if (
    payload.version !== ENCRYPTION_VERSION ||
    payload.algorithm !== ENCRYPTION_ALGORITHM
  ) {
    throw new Error("Unsupported encrypted job payload envelope");
  }

  const packedPayload = Buffer.from(payload.encryptedPayload, "base64url");
  const minimumLength = IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES + 1;
  if (packedPayload.length < minimumLength) {
    throw new Error("Encrypted job payload is malformed");
  }

  const initializationVector = packedPayload.subarray(0, IV_LENGTH_BYTES);
  const authTag = packedPayload.subarray(
    IV_LENGTH_BYTES,
    IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES,
  );
  const encrypted = packedPayload.subarray(
    IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES,
  );

  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    getEncryptionKey(),
    initializationVector,
  );
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(decrypted) as T;
}
