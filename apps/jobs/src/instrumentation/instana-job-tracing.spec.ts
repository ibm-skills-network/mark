import type { Job } from "bullmq";
import { DOMAIN_ID_FIELDS } from "../../../api/src/job-queue/job-domain-ids";
import { encryptJobPayload } from "../job-payload.crypto";
import {
  __clearInstanaTestOverride,
  __setInstanaTestOverride,
  annotateDomainIds,
  isInstanaEnabled,
  resolveInstana,
  traceJob,
  type InstanaInstance,
} from "./instana-job-tracing";

const makeFakeInstana = () => {
  const annotate = jest.fn();
  const startEntrySpan = jest.fn().mockResolvedValue(undefined);
  const completeEntrySpan = jest.fn();
  const instance: InstanaInstance = {
    sdk: { async: { startEntrySpan, completeEntrySpan } },
    currentSpan: () => ({ annotate }),
    isTracing: () => true,
  };
  return { instance, annotate, startEntrySpan, completeEntrySpan };
};

const fakeJob = (overrides: Partial<Job> & { data?: unknown }): Job =>
  ({
    name: "attempt.grade",
    id: "1",
    attemptsMade: 0,
    opts: {},
    ...overrides,
  }) as unknown as Job;

describe("instana-job-tracing enablement", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    __clearInstanaTestOverride();
  });

  it("is enabled in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.INSTANA_ENABLED;
    expect(isInstanaEnabled()).toBe(true);
  });

  it("is enabled in non-prod when INSTANA_ENABLED=true", () => {
    process.env.NODE_ENV = "staging";
    process.env.INSTANA_ENABLED = "true";
    expect(isInstanaEnabled()).toBe(true);
  });

  it("is force-disabled when INSTANA_ENABLED=false even in production", () => {
    process.env.NODE_ENV = "production";
    process.env.INSTANA_ENABLED = "false";
    expect(isInstanaEnabled()).toBe(false);
  });

  it("is disabled by default outside production", () => {
    process.env.NODE_ENV = "development";
    delete process.env.INSTANA_ENABLED;
    expect(isInstanaEnabled()).toBe(false);
  });

  it("resolveInstana returns the injected test override", () => {
    const { instance } = makeFakeInstana();
    __setInstanaTestOverride(instance);
    expect(resolveInstana()).toBe(instance);
  });

  it("resolveInstana returns undefined when override is null (forced off)", () => {
    __setInstanaTestOverride(null);
    expect(resolveInstana()).toBeUndefined();
  });
});

describe("annotateDomainIds", () => {
  it("tags only allow-listed domain IDs and never userId/PII", () => {
    const annotate = jest.fn();
    const job = fakeJob({
      data: encryptJobPayload({
        assignmentId: 5,
        attemptId: 7,
        organizationId: "org_9",
        userId: "learner@example.com",
        translatedText: "secret text",
      }),
    });

    annotateDomainIds({ annotate }, job);

    expect(annotate).toHaveBeenCalledWith("sdk.custom.tags.assignmentId", 5);
    expect(annotate).toHaveBeenCalledWith("sdk.custom.tags.attemptId", 7);
    expect(annotate).toHaveBeenCalledWith(
      "sdk.custom.tags.organizationId",
      "org_9",
    );
    const annotatedPaths = annotate.mock.calls.map((c) => c[0] as string);
    expect(annotatedPaths).not.toContain("sdk.custom.tags.userId");
    expect(annotatedPaths.some((p) => p.includes("translatedText"))).toBe(
      false,
    );
  });

  it("does not throw and tags nothing when payload decryption fails", () => {
    const annotate = jest.fn();
    const job = fakeJob({
      data: {
        version: "v1",
        algorithm: "aes-256-gcm",
        encryptedPayload: "!!!not-base64!!!",
      },
    });

    expect(() => annotateDomainIds({ annotate }, job)).not.toThrow();
    expect(annotate).not.toHaveBeenCalled();
  });

  it("keeps the allow-list free of userId", () => {
    expect(DOMAIN_ID_FIELDS as readonly string[]).not.toContain("userId");
  });
});

describe("traceJob", () => {
  afterEach(() => __clearInstanaTestOverride());

  it("runs work untraced and starts no span when disabled", async () => {
    __setInstanaTestOverride(null);
    const { startEntrySpan } = makeFakeInstana();
    const work = jest.fn().mockResolvedValue("ok");

    await expect(traceJob("mark.attempt", fakeJob({}), work)).resolves.toBe(
      "ok",
    );
    expect(work).toHaveBeenCalledTimes(1);
    expect(startEntrySpan).not.toHaveBeenCalled();
  });

  it("opens a job.<name> entry span, annotates metadata, completes on success", async () => {
    const { instance, annotate, startEntrySpan, completeEntrySpan } =
      makeFakeInstana();
    __setInstanaTestOverride(instance);
    const job = fakeJob({
      name: "attempt.grade",
      id: "42",
      attemptsMade: 1,
      opts: { attempts: 3 },
      timestamp: 600,
      processedOn: 1000,
    });

    await expect(
      traceJob("mark.attempt", job, async () => "done"),
    ).resolves.toBe("done");

    expect(startEntrySpan).toHaveBeenCalledWith("job.attempt.grade");
    expect(annotate).toHaveBeenCalledWith(
      "sdk.custom.tags.jobType",
      "attempt.grade",
    );
    expect(annotate).toHaveBeenCalledWith(
      "sdk.custom.tags.queue",
      "mark.attempt",
    );
    expect(annotate).toHaveBeenCalledWith("sdk.custom.tags.maxAttempts", 3);
    expect(annotate).toHaveBeenCalledWith("sdk.custom.tags.queueWaitMs", 400);
    expect(annotate).toHaveBeenCalledWith("sdk.custom.tags.outcome", "success");
    expect(completeEntrySpan).toHaveBeenCalledWith(undefined);
  });

  it("completes the span WITH the error and rethrows the original error", async () => {
    const { instance, annotate, completeEntrySpan } = makeFakeInstana();
    __setInstanaTestOverride(instance);
    const boom = new Error("boom");
    boom.name = "OversizedSubmissionError";

    await expect(
      traceJob("mark.attempt", fakeJob({}), async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(annotate).toHaveBeenCalledWith("sdk.custom.tags.outcome", "error");
    expect(annotate).toHaveBeenCalledWith(
      "sdk.custom.tags.errorClass",
      "OversizedSubmissionError",
    );
    expect(completeEntrySpan).toHaveBeenCalledWith(boom);
  });
});
