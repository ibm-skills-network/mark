/**
 * @jest-environment jsdom
 */

import { uploadFileToStorage } from "../shared";
import type { UploadRequest } from "@config/types";
import {
  DIRECT_UPLOAD_FALLBACK_MAX_BYTES,
  UploadTransportError,
  type UploadTransportRequest,
  type UploadTransportResponse,
} from "../uploadTransport";

const sendWithStallDetection = jest.fn<
  Promise<UploadTransportResponse>,
  [UploadTransportRequest]
>();

jest.mock("../uploadTransport", () => ({
  ...jest.requireActual("../uploadTransport"),
  sendWithStallDetection: (request: UploadTransportRequest) =>
    sendWithStallDetection(request),
}));

const post = jest.fn();

jest.mock("../api-client", () => ({
  ...jest.requireActual("../api-client"),
  apiClient: {
    post: (...arguments_: unknown[]) => post(...arguments_),
  },
}));

const PRESIGN_RESPONSE = {
  presignedUrl: "https://cos.example.com/learner-bucket/42/u/7/abc-answer.txt",
  key: "42/u/7/abc-answer.txt",
  bucket: "learner-bucket",
  fileType: "text/plain",
  fileName: "answer.txt",
  uploadType: "learner",
  expiresInSeconds: 600,
  expiresAt: new Date().toISOString(),
  maxAllowedBytes: 100 * 1024 * 1024,
};

const DIRECT_UPLOAD_RESPONSE = {
  success: true,
  key: "42/u/7/def-answer.txt",
  bucket: "learner-bucket",
  fileType: "text/plain",
  fileName: "answer.txt",
  uploadType: "learner",
  size: 128,
  etag: '"deadbeef"',
};

const uploadRequest: UploadRequest = {
  fileName: "answer.txt",
  fileType: "text/plain",
  fileSize: 128,
  uploadType: "learner" as UploadRequest["uploadType"],
  context: { assignmentId: 42, questionId: 7 },
};

function makeFile(sizeBytes: number): File {
  const file = new File(["answer"], "answer.txt", { type: "text/plain" });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

function httpResponse(
  status: number,
  body = "",
  headers: Record<string, string> = {},
): Promise<UploadTransportResponse> {
  return Promise.resolve({
    status,
    responseText: body,
    getResponseHeader: (name: string) => headers[name.toLowerCase()] ?? null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  post.mockResolvedValue(PRESIGN_RESPONSE);
  // Upload failures are reported with fetch; the report must never matter
  // to the outcome these tests check.
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
});

describe("single-PUT fallback", () => {
  it("re-sends through the API when the storage leg stalls", async () => {
    sendWithStallDetection
      .mockRejectedValueOnce(
        new UploadTransportError("stalled with no progress", "stalled"),
      )
      .mockReturnValueOnce(
        httpResponse(201, JSON.stringify(DIRECT_UPLOAD_RESPONSE)),
      );
    const onFallback = jest.fn();

    const result = await uploadFileToStorage(makeFile(128), uploadRequest, {
      onFallback,
    });

    expect(onFallback).toHaveBeenCalledWith({ reason: "stalled" });
    expect(result.key).toBe(DIRECT_UPLOAD_RESPONSE.key);
    expect(result.bucket).toBe(DIRECT_UPLOAD_RESPONSE.bucket);
    expect(result.s3Link).toBe(
      `s3://${DIRECT_UPLOAD_RESPONSE.bucket}/${DIRECT_UPLOAD_RESPONSE.key}`,
    );

    const fallbackRequest = sendWithStallDetection.mock.calls[1][0];
    expect(fallbackRequest.method).toBe("POST");
    expect(fallbackRequest.url).toContain("/files/direct-upload");
    expect(fallbackRequest.body).toBeInstanceOf(FormData);
    expect((fallbackRequest.body as FormData).get("source")).toBe("fallback");
  });

  it("explains instead of rerouting a single-PUT file above the fallback cap", async () => {
    const size = DIRECT_UPLOAD_FALLBACK_MAX_BYTES + 1;
    sendWithStallDetection.mockRejectedValue(
      new UploadTransportError("dead", "stalled"),
    );
    const onFallback = jest.fn();

    await expect(
      uploadFileToStorage(
        makeFile(size),
        { ...uploadRequest, fileSize: size },
        { onFallback },
      ),
    ).rejects.toMatchObject({
      userMessage: expect.stringContaining("too large to send the slower way"),
    });

    expect(onFallback).not.toHaveBeenCalled();
    const postedToApi = sendWithStallDetection.mock.calls.some(
      (call) => call[0].method === "POST",
    );
    expect(postedToApi).toBe(false);
  });

  it("re-sends through the API when the storage leg errors outright", async () => {
    sendWithStallDetection
      .mockRejectedValueOnce(new UploadTransportError("no response", "network"))
      .mockReturnValueOnce(
        httpResponse(201, JSON.stringify(DIRECT_UPLOAD_RESPONSE)),
      );
    const onFallback = jest.fn();

    await uploadFileToStorage(makeFile(128), uploadRequest, { onFallback });

    expect(onFallback).toHaveBeenCalledWith({ reason: "network" });
    expect(sendWithStallDetection).toHaveBeenCalledTimes(2);
  });

  it("reports progress through the fallback route", async () => {
    sendWithStallDetection
      .mockRejectedValueOnce(new UploadTransportError("dead", "stalled"))
      .mockImplementationOnce((request) => {
        request.onUploadProgress?.({ loaded: 64, total: 128 });
        return httpResponse(201, JSON.stringify(DIRECT_UPLOAD_RESPONSE));
      });
    const onUploadProgress = jest.fn();

    await uploadFileToStorage(makeFile(128), uploadRequest, {
      onUploadProgress,
    });

    expect(onUploadProgress).toHaveBeenCalledWith({ loaded: 64, total: 128 });
    expect(onUploadProgress).toHaveBeenLastCalledWith({
      loaded: 128,
      total: 128,
    });
  });

  it("does not repaint the bar at 0% while rerouting", async () => {
    const events: string[] = [];
    sendWithStallDetection
      .mockRejectedValueOnce(new UploadTransportError("dead", "stalled"))
      .mockReturnValueOnce(
        httpResponse(201, JSON.stringify(DIRECT_UPLOAD_RESPONSE)),
      );

    await uploadFileToStorage(makeFile(128), uploadRequest, {
      onFallback: () => events.push("fallback"),
      onUploadProgress: (progress) =>
        events.push(`progress:${progress.loaded}`),
    });

    // The only zero-progress event is the one before the first attempt.
    expect(events).toEqual(["progress:0", "fallback", "progress:128"]);
  });
});

// Storage never makes its own errors readable cross-origin, so a status the
// browser can read came from a proxy in between. Same-origin gets past it.
describe("readable storage rejections", () => {
  it.each([403, 404, 407, 413, 500, 502])(
    "re-sends through the API when the storage PUT answers %s",
    async (status) => {
      sendWithStallDetection
        .mockReturnValueOnce(httpResponse(status, "<html>Blocked</html>"))
        .mockReturnValueOnce(
          httpResponse(201, JSON.stringify(DIRECT_UPLOAD_RESPONSE)),
        );
      const onFallback = jest.fn();

      const result = await uploadFileToStorage(makeFile(128), uploadRequest, {
        onFallback,
      });

      expect(onFallback).toHaveBeenCalledWith({ reason: "http" });
      expect(result.key).toBe(DIRECT_UPLOAD_RESPONSE.key);
      const fallbackRequest = sendWithStallDetection.mock.calls[1][0];
      expect(fallbackRequest.method).toBe("POST");
      expect(fallbackRequest.url).toContain("/files/direct-upload");
    },
  );

  it("never blames the session for a readable 403", async () => {
    sendWithStallDetection
      .mockReturnValueOnce(httpResponse(403))
      .mockRejectedValueOnce(new UploadTransportError("dead", "network"));

    const failure = await uploadFileToStorage(
      makeFile(128),
      uploadRequest,
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      userMessage: expect.not.stringMatching(/session expired/i),
    });
  });

  it("says the network is blocking the upload when the fallback also fails", async () => {
    sendWithStallDetection
      .mockReturnValueOnce(httpResponse(403))
      .mockRejectedValueOnce(new UploadTransportError("dead", "network"));

    await expect(
      uploadFileToStorage(makeFile(128), uploadRequest),
    ).rejects.toMatchObject({
      userMessage:
        "This upload appears to be blocked by your network. Try a different network or device, or another browser.",
    });
  });

  it("explains instead of rerouting a readable rejection above the fallback cap", async () => {
    const size = DIRECT_UPLOAD_FALLBACK_MAX_BYTES + 1;
    sendWithStallDetection.mockReturnValueOnce(httpResponse(403));
    const onFallback = jest.fn();

    await expect(
      uploadFileToStorage(
        makeFile(size),
        { ...uploadRequest, fileSize: size },
        { onFallback },
      ),
    ).rejects.toMatchObject({
      userMessage:
        "Your network appears to be blocking this upload, and the file is too large to send another way. Try a different network, device or browser, or a smaller file.",
    });

    expect(onFallback).not.toHaveBeenCalled();
    expect(sendWithStallDetection).toHaveBeenCalledTimes(1);
  });

  it("keeps the API's own answer when the fallback is refused", async () => {
    sendWithStallDetection
      .mockReturnValueOnce(httpResponse(403))
      .mockReturnValueOnce(
        httpResponse(429, JSON.stringify({ message: "slow down" })),
      );

    await expect(
      uploadFileToStorage(makeFile(128), uploadRequest),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe("failures that must not reroute", () => {
  it("does not fall back when the presign call itself fails", async () => {
    const { APIError } =
      jest.requireActual<typeof import("../api-client")>("../api-client");
    post.mockRejectedValueOnce(
      new APIError("forbidden", 403, "Forbidden", { message: "nope" }),
    );
    const onFallback = jest.fn();

    await expect(
      uploadFileToStorage(makeFile(128), uploadRequest, { onFallback }),
    ).rejects.toMatchObject({ status: 403 });

    expect(onFallback).not.toHaveBeenCalled();
    expect(sendWithStallDetection).not.toHaveBeenCalled();
  });

  it("surfaces the API error rather than looping when the fallback is refused", async () => {
    sendWithStallDetection
      .mockRejectedValueOnce(new UploadTransportError("dead", "stalled"))
      .mockReturnValueOnce(
        httpResponse(429, JSON.stringify({ message: "slow down" })),
      );

    await expect(
      uploadFileToStorage(makeFile(128), uploadRequest),
    ).rejects.toMatchObject({ status: 429 });

    expect(sendWithStallDetection).toHaveBeenCalledTimes(2);
  });
});

describe("multipart uploads", () => {
  const initiateResponse = {
    uploadId: "upload-1",
    key: "42/u/7/abc-big.bin",
    bucket: "learner-bucket",
    fileType: "text/plain",
    fileName: "answer.txt",
    uploadType: "learner",
    expiresInSeconds: 600,
    expiresAt: new Date().toISOString(),
    maxAllowedBytes: 100 * 1024 * 1024,
    partSizeBytes: 5 * 1024 * 1024,
    urls: [{ partNumber: 1, url: "https://cos.example.com/part-1" }],
  };

  beforeEach(() => {
    post.mockImplementation((url: unknown) =>
      typeof url === "string" && url.includes("/upload/initiate")
        ? Promise.resolve(initiateResponse)
        : Promise.resolve(undefined),
    );
  });

  // The fallback cap sits below the multipart threshold (bodies past ~5MB die
  // at the UI proxy's timeout), so a multipart file can never reroute: it must
  // get the clear explanation instead of a second doomed attempt.
  it("explains instead of rerouting a multipart file", async () => {
    const size = 12 * 1024 * 1024;
    sendWithStallDetection.mockRejectedValue(
      new UploadTransportError("dead", "stalled"),
    );
    const onFallback = jest.fn();

    await expect(
      uploadFileToStorage(
        makeFile(size),
        { ...uploadRequest, fileSize: size },
        { onFallback },
      ),
    ).rejects.toMatchObject({
      userMessage: expect.stringContaining("too large to send the slower way"),
    });

    expect(onFallback).not.toHaveBeenCalled();
    const postedToApi = sendWithStallDetection.mock.calls.some(
      (call) => call[0].method === "POST",
    );
    expect(postedToApi).toBe(false);
  });

  it("treats a readable part rejection as a blocked network, not a session problem", async () => {
    const size = 12 * 1024 * 1024;
    sendWithStallDetection.mockReturnValue(httpResponse(403));
    const onFallback = jest.fn();

    await expect(
      uploadFileToStorage(
        makeFile(size),
        { ...uploadRequest, fileSize: size },
        { onFallback },
      ),
    ).rejects.toMatchObject({
      userMessage:
        "Your network appears to be blocking this upload, and the file is too large to send another way. Try a different network, device or browser, or a smaller file.",
    });

    expect(onFallback).not.toHaveBeenCalled();
    // A 403 will not change on retry, so the part is tried once.
    expect(sendWithStallDetection).toHaveBeenCalledTimes(1);
  });
});
