import { decryptJobPayload, encryptJobPayload } from "./job-payload.crypto";

describe("job-payload.crypto", () => {
  const jobQueueSecretEnv = "JOB_QUEUE_SECRET"; // pragma: allowlist secret
  const originalNodeEnv = process.env.NODE_ENV;
  const originalQueueKeyValue = process.env[jobQueueSecretEnv];

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalQueueKeyValue === undefined) {
      delete process.env[jobQueueSecretEnv];
    } else {
      process.env[jobQueueSecretEnv] = originalQueueKeyValue;
    }
  });

  it("round-trips encrypted payloads with nested data", () => {
    process.env[jobQueueSecretEnv] = "test-secret";
    const payload = {
      jobId: "job-123",
      attemptId: 44,
      nested: {
        completed: false,
        values: ["alpha", "beta"],
      },
    };

    const encryptedPayload = encryptJobPayload(payload);
    const decryptedPayload =
      decryptJobPayload<typeof payload>(encryptedPayload);

    expect(encryptedPayload).toMatchObject({
      version: "v1",
      algorithm: "aes-256-gcm",
    });
    expect(encryptedPayload.encryptedPayload).not.toContain("job-123");
    expect(decryptedPayload).toEqual(payload);
  });

  it("returns legacy plaintext payloads unchanged", () => {
    const payload = {
      legacy: true,
      attemptId: 88,
    };

    expect(decryptJobPayload<typeof payload>(payload)).toEqual(payload);
  });

  it("uses the local fallback secret in test mode", () => {
    delete process.env[jobQueueSecretEnv];
    process.env.NODE_ENV = "test";
    const payload = { secure: "data" };

    const encryptedPayload = encryptJobPayload(payload);

    expect(decryptJobPayload<typeof payload>(encryptedPayload)).toEqual(
      payload,
    );
  });

  it("throws in production mode when the shared secret is missing", () => {
    delete process.env[jobQueueSecretEnv];
    process.env.NODE_ENV = "production";

    expect(() => encryptJobPayload({ value: 1 })).toThrow(
      "JOB_QUEUE_SECRET must be set to encrypt background job payloads",
    );
  });

  it("rejects unsupported encryption envelopes", () => {
    process.env[jobQueueSecretEnv] = "test-secret";

    expect(() =>
      decryptJobPayload({
        version: "v2",
        algorithm: "aes-256-gcm",
        encryptedPayload: "abc",
      }),
    ).toThrow("Unsupported encrypted job payload envelope");
  });

  it("rejects malformed encrypted payloads", () => {
    process.env[jobQueueSecretEnv] = "test-secret";

    expect(() =>
      decryptJobPayload({
        version: "v1",
        algorithm: "aes-256-gcm",
        encryptedPayload: Buffer.from("short", "utf8").toString("base64url"),
      }),
    ).toThrow("Encrypted job payload is malformed");
  });

  it("rejects tampered payloads or a mismatched shared secret", () => {
    process.env[jobQueueSecretEnv] = "encrypt-secret";
    const encryptedPayload = encryptJobPayload({ jobId: "job-999" });

    process.env[jobQueueSecretEnv] = "decrypt-secret";

    expect(() => decryptJobPayload(encryptedPayload)).toThrow();
  });
});
