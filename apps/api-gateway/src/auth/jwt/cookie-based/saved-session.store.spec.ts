import { Logger } from "@nestjs/common";
import axios, { AxiosError } from "axios";
import { isStoreId, SavedSessionStore } from "./saved-session.store";

const storeId = "7f0c6c1e-3c1a-4c55-9a8e-2b8f6f1d0a11";

describe("SavedSessionStore", () => {
  const store = new SavedSessionStore();
  const environment = { ...process.env };
  let request: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    process.env.MARK_API_ENDPOINT = "http://mark-api";
    process.env.JOB_QUEUE_SECRET = "queue-secret"; // pragma: allowlist secret
    request = jest.spyOn(axios, "request");
    warn = jest.spyOn(Logger.prototype, "warn").mockReturnValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...environment };
  });

  it("looks up a saved token with the internal secret", async () => {
    request.mockResolvedValue({ data: { token: "saved-token" } });

    await expect(store.find(storeId, "learner", 4892)).resolves.toBe(
      "saved-token",
    );
    expect(request).toHaveBeenCalledWith({
      method: "post",
      url: "http://mark-api/api/internal/saved-sessions/lookup",
      data: { storeId, role: "learner", assignmentId: 4892 },
      headers: { "x-job-queue-secret": "queue-secret" }, // pragma: allowlist secret
      timeout: 1000,
    });
  });

  it("returns undefined when nothing is saved", async () => {
    // eslint-disable-next-line unicorn/no-null
    request.mockResolvedValue({ data: { token: null } });
    await expect(store.find(storeId, "learner", 4892)).resolves.toBeUndefined();
  });

  it("saves a token", async () => {
    request.mockResolvedValue({ data: "" });
    await store.save(storeId, "author", 4892, "jwt");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "put",
        url: "http://mark-api/api/internal/saved-sessions",
        data: { storeId, role: "author", assignmentId: 4892, token: "jwt" },
      }),
    );
  });

  it.each([
    [
      "an error response",
      new AxiosError("denied", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 403,
      } as never),
      "403",
    ],
    ["a timeout", new AxiosError("timeout", "ECONNABORTED"), "ECONNABORTED"],
  ])("logs %s without the store id or token", async (_name, error, reason) => {
    request.mockRejectedValue(error);

    await expect(store.find(storeId, "learner", 4892)).resolves.toBeUndefined();
    await expect(
      store.save(storeId, "learner", 4892, "jwt-value"),
    ).resolves.toBeUndefined();

    const messages = warn.mock.calls.map(([message]) => String(message));
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).toContain(reason);
      expect(message).not.toContain(storeId);
      expect(message).not.toContain("jwt-value");
    }
  });

  it("swallows errors that do not come from axios", async () => {
    request.mockRejectedValue(new TypeError("Invalid URL"));

    await expect(store.find(storeId, "learner", 4892)).resolves.toBeUndefined();
    await expect(
      store.save(storeId, "learner", 4892, "jwt"),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it.each(["MARK_API_ENDPOINT", "JOB_QUEUE_SECRET"])(
    "does nothing when %s is unset",
    async (name) => {
      delete process.env[name];
      await expect(
        store.find(storeId, "learner", 4892),
      ).resolves.toBeUndefined();
      await store.save(storeId, "learner", 4892, "jwt");
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("skips assignment ids beyond the database integer range", async () => {
    await expect(
      store.find(storeId, "learner", 2_147_483_648),
    ).resolves.toBeUndefined();
    await store.save(storeId, "learner", 2_147_483_648, "jwt");
    expect(request).not.toHaveBeenCalled();
  });

  it("accepts only GUID store ids", () => {
    expect(isStoreId(storeId)).toBe(true);
    expect(isStoreId(storeId.toUpperCase())).toBe(true);
    expect(isStoreId("not-a-guid")).toBe(false);
    expect(isStoreId(42)).toBe(false);
  });
});
