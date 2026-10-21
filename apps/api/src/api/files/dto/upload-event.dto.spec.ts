import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UploadEventDto } from "./upload-event.dto";

const VALID = {
  phase: "storage_put",
  outcome: "failed",
  httpStatus: 403,
  failureKind: "http",
  fallbackAttempted: true,
  fallbackOutcome: "failed",
  fallbackHttpStatus: null,
  sizeBucket: "lt_1mb",
  mimeType: "application/pdf",
  fileExtension: "pdf",
  responseServer: "BlueCoat-ProxySG",
  hasAmzRequestId: false,
  responseBodySnippet: "Access Denied",
  isWebView: true,
  isCourseraApp: true,
  inIframe: false,
  assignmentId: 42,
  questionId: 7,
  attemptId: 9,
};

async function errorsFor(body: Record<string, unknown>) {
  return validate(plainToInstance(UploadEventDto, body));
}

describe("UploadEventDto", () => {
  it("accepts a complete event", async () => {
    expect(await errorsFor(VALID)).toHaveLength(0);
  });

  it("accepts the minimal event a failure without a response produces", async () => {
    const minimal = {
      phase: "presign",
      outcome: "failed",
      httpStatus: null,
      failureKind: "network",
      fallbackAttempted: false,
      sizeBucket: "1_5mb",
      isWebView: false,
      isCourseraApp: false,
      inIframe: true,
    };
    expect(await errorsFor(minimal)).toHaveLength(0);
  });

  it.each([
    ["phase", "admin"],
    ["outcome", "success"],
    ["failureKind", "evil"],
    ["fallbackOutcome", "maybe"],
    ["sizeBucket", "12345678"],
    ["httpStatus", 99],
    ["httpStatus", 600],
    ["httpStatus", "403"],
    ["httpStatus", 403.5],
    ["fallbackHttpStatus", 1000],
    ["fallbackAttempted", "true"],
    ["isWebView", 1],
    ["isCourseraApp", "yes"],
    ["inIframe", null],
    ["hasAmzRequestId", "no"],
    ["mimeType", "not a mime"],
    ["mimeType", `application/${"x".repeat(200)}`],
    ["fileExtension", "tar.gz"],
    ["fileExtension", "averyverylongext"],
    ["responseServer", "x".repeat(101)],
    ["responseServer", "bad\nheader"],
    ["responseBodySnippet", "x".repeat(201)],
    ["assignmentId", 0],
    ["assignmentId", -1],
    ["assignmentId", 2_147_483_648],
    ["questionId", "7"],
    ["attemptId", 1.5],
  ])("rejects %s = %p", async (field, value) => {
    const errors = await errorsFor({ ...VALID, [field]: value });
    expect(errors.map((error) => error.property)).toContain(field);
  });

  it.each([
    "phase",
    "outcome",
    "failureKind",
    "sizeBucket",
    "fallbackAttempted",
  ])("requires %s", async (field) => {
    const body: Record<string, unknown> = { ...VALID };
    delete body[field];
    const errors = await errorsFor(body);
    expect(errors.map((error) => error.property)).toContain(field);
  });
});
