/**
 * @jest-environment jsdom
 */

import { uploadFileToStorage } from "../shared";
import type { UploadRequest } from "@config/types";
import { clearRequestLog, recentClientErrors } from "../request-log";
import {
  sanitizeResponseSnippet,
  UploadTransportError,
  type UploadTransportRequest,
  type UploadTransportResponse,
} from "../uploadTransport";
import { sizeBucketOf, type UploadEventPayload } from "../upload-telemetry";

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
  presignedUrl:
    "https://cos.example.com/learner-bucket/42/u/7/abc-answer.txt?X-Amz-Signature=secret",
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
  fileName: "My Secret Essay.docx",
  fileType:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  fileSize: 128,
  uploadType: "learner",
  context: { assignmentId: 42, questionId: 7 },
};

function makeFile(sizeBytes: number): File {
  const file = new File(["answer"], "My Secret Essay.docx", {
    type: uploadRequest.fileType,
  });
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

const fetchMock = jest.fn();

function sentEvents(): UploadEventPayload[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes("/files/upload-events"))
    .map(([, init]) => JSON.parse(String(init.body)) as UploadEventPayload);
}

beforeEach(() => {
  jest.clearAllMocks();
  clearRequestLog();
  post.mockResolvedValue(PRESIGN_RESPONSE);
  fetchMock.mockResolvedValue({ ok: true, status: 204 });
  global.fetch = fetchMock;
});

describe("upload failure telemetry", () => {
  it("reports a readable storage rejection that the fallback rescued", async () => {
    sendWithStallDetection
      .mockReturnValueOnce(
        httpResponse(
          403,
          "<html><body><h1>Access Denied</h1> user jane@corp.example from 10.1.2.3 blocked https://cos.example.com/x?X-Amz-Signature=abc</body></html>",
          { server: "BlueCoat-ProxySG" },
        ),
      )
      .mockReturnValueOnce(
        httpResponse(201, JSON.stringify(DIRECT_UPLOAD_RESPONSE)),
      );

    await uploadFileToStorage(makeFile(128), uploadRequest, { attemptId: 9 });

    const [event] = sentEvents();
    expect(sentEvents()).toHaveLength(1);
    expect(event).toMatchObject({
      phase: "storage_put",
      outcome: "fallback_succeeded",
      httpStatus: 403,
      failureKind: "http",
      fallbackAttempted: true,
      fallbackOutcome: "succeeded",
      sizeBucket: "lt_1mb",
      mimeType: uploadRequest.fileType,
      fileExtension: "docx",
      responseServer: "BlueCoat-ProxySG",
      hasAmzRequestId: false,
      assignmentId: 42,
      questionId: 7,
      attemptId: 9,
      isWebView: false,
      isCourseraApp: false,
    });
    expect(typeof event.inIframe).toBe("boolean");

    const raw = JSON.stringify(event);
    expect(raw).not.toContain("Secret Essay");
    expect(raw).not.toContain("jane@corp.example");
    expect(raw).not.toContain("10.1.2.3");
    expect(raw).not.toContain("X-Amz-Signature");
    expect(event.responseBodySnippet).toContain("Access Denied");

    const [, init] = fetchMock.mock.calls[0];
    expect(init).toMatchObject({ method: "POST", keepalive: true });
  });

  it("reports a stalled storage PUT whose fallback also failed", async () => {
    sendWithStallDetection
      .mockRejectedValueOnce(new UploadTransportError("stalled", "stalled"))
      .mockRejectedValueOnce(new UploadTransportError("dead", "network"));

    await expect(
      uploadFileToStorage(makeFile(128), uploadRequest),
    ).rejects.toBeDefined();

    expect(sentEvents()).toEqual([
      expect.objectContaining({
        phase: "storage_put",
        outcome: "failed",
        httpStatus: null,
        failureKind: "stall",
        fallbackAttempted: true,
        fallbackOutcome: "failed",
        fallbackHttpStatus: null,
      }),
    ]);
  });

  it("reports a presign failure with its status", async () => {
    const { APIError } =
      jest.requireActual<typeof import("../api-client")>("../api-client");
    post.mockRejectedValueOnce(
      new APIError("forbidden", 403, "Forbidden", { message: "nope" }),
    );

    await expect(
      uploadFileToStorage(makeFile(128), uploadRequest),
    ).rejects.toBeDefined();

    expect(sentEvents()).toEqual([
      expect.objectContaining({
        phase: "presign",
        outcome: "failed",
        httpStatus: 403,
        failureKind: "http",
        fallbackAttempted: false,
      }),
    ]);
  });

  it("reports which multipart step failed", async () => {
    const size = 12 * 1024 * 1024;
    post.mockImplementation((url: unknown) =>
      typeof url === "string" && url.includes("/upload/initiate")
        ? Promise.resolve({
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
          })
        : Promise.resolve(undefined),
    );
    sendWithStallDetection.mockReturnValue(
      httpResponse(403, "", { "x-amz-request-id": "abc" }),
    );

    await expect(
      uploadFileToStorage(makeFile(size), { ...uploadRequest, fileSize: size }),
    ).rejects.toBeDefined();

    expect(sentEvents()).toEqual([
      expect.objectContaining({
        phase: "multipart_part",
        outcome: "failed",
        httpStatus: 403,
        failureKind: "http",
        fallbackAttempted: true,
        fallbackOutcome: "too_large",
        sizeBucket: "10_50mb",
        hasAmzRequestId: true,
      }),
    ]);
  });

  it("stays silent when the upload succeeds directly", async () => {
    sendWithStallDetection.mockReturnValueOnce(httpResponse(200));

    await uploadFileToStorage(makeFile(128), uploadRequest);

    expect(sentEvents()).toHaveLength(0);
  });

  it("only reports learner uploads", async () => {
    sendWithStallDetection
      .mockRejectedValueOnce(new UploadTransportError("stalled", "stalled"))
      .mockRejectedValueOnce(new UploadTransportError("dead", "network"));

    await expect(
      uploadFileToStorage(makeFile(128), {
        ...uploadRequest,
        uploadType: "author",
      }),
    ).rejects.toBeDefined();

    expect(sentEvents()).toHaveLength(0);
  });

  it("never lets a failed report change the upload result", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    sendWithStallDetection
      .mockReturnValueOnce(httpResponse(403))
      .mockReturnValueOnce(
        httpResponse(201, JSON.stringify(DIRECT_UPLOAD_RESPONSE)),
      );

    const result = await uploadFileToStorage(makeFile(128), uploadRequest);

    expect(result.key).toBe(DIRECT_UPLOAD_RESPONSE.key);
  });

  it("never lets a synchronously throwing fetch change the upload result", async () => {
    fetchMock.mockImplementation(() => {
      throw new TypeError("keepalive quota exceeded");
    });
    sendWithStallDetection
      .mockRejectedValueOnce(new UploadTransportError("stalled", "stalled"))
      .mockRejectedValueOnce(new UploadTransportError("dead", "network"));

    await expect(
      uploadFileToStorage(makeFile(128), uploadRequest),
    ).rejects.toMatchObject({ name: "UploadError" });
  });

  it("keeps a copy for bug-report diagnostics", async () => {
    sendWithStallDetection
      .mockReturnValueOnce(httpResponse(403))
      .mockRejectedValueOnce(new UploadTransportError("dead", "network"));

    await expect(
      uploadFileToStorage(makeFile(128), uploadRequest),
    ).rejects.toBeDefined();

    expect(recentClientErrors()).toEqual([
      expect.objectContaining({
        name: "UploadFailure",
        where: "file-upload",
        kind: "http",
        message: expect.stringContaining("storage_put"),
      }),
    ]);
  });
});

describe("sanitizeResponseSnippet", () => {
  it("drops markup, identities, query strings and tokens and bounds the length", () => {
    const snippet = sanitizeResponseSnippet(
      `<style>.x{}</style><p>Blocked for bob.smith+x@example.co.uk at 192.168.0.1</p> see /deny?user=bob ${"A".repeat(
        40,
      )} ${"x ".repeat(300)}`,
    );

    expect(snippet).toBeDefined();
    expect(snippet.length).toBeLessThanOrEqual(200);
    expect(snippet).toContain("Blocked for [email] at [ip]");
    expect(snippet).not.toContain("user=bob");
    expect(snippet).not.toContain("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(snippet).not.toMatch(/[<>]/);
  });

  it("returns nothing for an empty body", () => {
    expect(sanitizeResponseSnippet("   ")).toBeUndefined();
  });
});

describe("sizeBucketOf", () => {
  it.each([
    [0, "lt_1mb"],
    [1024 * 1024, "1_5mb"],
    [5 * 1024 * 1024, "5_10mb"],
    [10 * 1024 * 1024, "10_50mb"],
    [50 * 1024 * 1024, "gt_50mb"],
  ])("puts %d bytes in %s", (bytes, bucket) => {
    expect(sizeBucketOf(bytes)).toBe(bucket);
  });
});
