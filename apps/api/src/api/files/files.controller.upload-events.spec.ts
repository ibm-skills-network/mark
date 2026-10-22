import { GUARDS_METADATA } from "@nestjs/common/constants";
import { UserRole } from "src/auth/interfaces/user.session.interface";
import type { UserSessionRequest } from "src/auth/interfaces/user.session.interface";
import { ROLES_KEY } from "src/auth/role/roles.global.guard";
import { Logger } from "winston";
import { UploadEventDto } from "./dto/upload-event.dto";
import { FilesController } from "./files.controller";
import { AuthGuard } from "./guards/auth.guard";
import { UserThrottlerGuard } from "./guards/user-throttler.guard";
import { FilesService } from "./services/files.service";
import { S3Service } from "./services/s3.service";

describe("FilesController upload events", () => {
  const childLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const parentLogger = {
    child: jest.fn().mockReturnValue(childLogger),
  } as unknown as Logger;

  let controller: FilesController;

  const request = {
    userSession: {
      userId: "learner@example.com",
      role: UserRole.LEARNER,
      assignmentId: 42,
      groupId: "g-1",
    },
    headers: {
      "user-agent": "CourseraMobileApp/6.13 (Android; WebView)",
    },
  } as unknown as UserSessionRequest;

  const failure: UploadEventDto = {
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
    responseServer: "BlueCoat\u0007-ProxySG",
    hasAmzRequestId: false,
    responseErrorCode: "AccessDenied",
    responseBodyLength: 412,
    isWebView: true,
    isCourseraApp: true,
    inIframe: false,
    assignmentId: 42,
    questionId: 7,
    attemptId: 9,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new FilesController(
      {} as unknown as FilesService,
      {} as unknown as S3Service,
      parentLogger,
    );
  });

  it("logs a failure at warn with the session user, not the body", () => {
    controller.reportUploadEvent(
      { ...failure, userId: "someone-else@example.com" } as UploadEventDto,
      request,
    );

    expect(childLogger.warn).toHaveBeenCalledTimes(1);
    expect(childLogger.info).not.toHaveBeenCalled();
    const [message, fields] = childLogger.warn.mock.calls[0];
    expect(message).toBe("learner_upload_failed");
    expect(fields).toMatchObject({
      user_id: "learner@example.com",
      role: UserRole.LEARNER,
      assignment_id: 42,
      assignment_mismatch: false,
      question_id: 7,
      attempt_id: 9,
      phase: "storage_put",
      outcome: "failed",
      http_status: 403,
      failure_kind: "http",
      fallback_attempted: true,
      fallback_outcome: "failed",
      fallback_http_status: null,
      size_bucket: "lt_1mb",
      mime_type: "application/pdf",
      file_extension: "pdf",
      has_amz_request_id: false,
      is_webview: true,
      is_coursera_app: true,
      in_iframe: false,
      user_agent: "CourseraMobileApp/6.13 (Android; WebView)",
    });
    expect(JSON.stringify(fields)).not.toContain("someone-else");
    // A control character is not a token character, so the value is dropped.
    expect(fields.response_server).toBeUndefined();
    expect(fields.response_error_code).toBe("AccessDenied");
    expect(fields.response_body_length).toBe(412);
    expect(fields).not.toHaveProperty("response_body_snippet");
  });

  it("never logs free text a client sends about the storage response", () => {
    const hostile = {
      ...failure,
      responseServer: "Authorization: Bearer short-secret",
      responseErrorCode: "jane.doe@corp.example 2001:db8::1",
      responseBodySnippet:
        "Blocked for Jane Doe <jane.doe@corp.example> from 2001:db8::1. Authorization: Bearer short-secret",
    } as UploadEventDto;
    controller.reportUploadEvent(hostile, request);

    const [, fields] = childLogger.warn.mock.calls[0];
    const raw = JSON.stringify(fields);
    for (const leaked of [
      "Jane Doe",
      "jane.doe@corp.example",
      "2001:db8::1",
      "short-secret",
      "Bearer",
    ]) {
      expect(raw).not.toContain(leaked);
    }
    expect(fields.response_error_code).toBeUndefined();
  });

  it("keeps a server header's product name and drops its comment", () => {
    controller.reportUploadEvent(
      { ...failure, responseServer: "nginx/1.18.0 (Ubuntu; host=10.0.0.4)" },
      request,
    );

    const [, fields] = childLogger.warn.mock.calls[0];
    expect(fields.response_server).toBe("nginx/1.18.0");
  });

  it("logs a fallback rescue at info", () => {
    controller.reportUploadEvent(
      {
        ...failure,
        outcome: "fallback_succeeded",
        fallbackOutcome: "succeeded",
      },
      request,
    );

    expect(childLogger.info).toHaveBeenCalledWith(
      "learner_upload_rescued_by_fallback",
      expect.objectContaining({ outcome: "fallback_succeeded" }),
    );
    expect(childLogger.warn).not.toHaveBeenCalled();
  });

  it("flags a body assignment that is not the session's and logs the session's", () => {
    controller.reportUploadEvent({ ...failure, assignmentId: 999 }, request);

    const [, fields] = childLogger.warn.mock.calls[0];
    expect(fields.assignment_id).toBe(42);
    expect(fields.assignment_mismatch).toBe(true);
  });

  it("drops storage response details on events that are not storage rejections", () => {
    controller.reportUploadEvent(
      {
        ...failure,
        phase: "presign",
        failureKind: "network",
        httpStatus: null,
      },
      request,
    );

    const [, fields] = childLogger.warn.mock.calls[0];
    expect(fields.response_error_code).toBeUndefined();
    expect(fields.response_body_length).toBeUndefined();
    expect(fields.response_server).toBeUndefined();
    expect(fields.has_amz_request_id).toBeUndefined();
  });

  it("requires an authenticated learner and is rate limited per user", () => {
    const handler = Object.getOwnPropertyDescriptor(
      FilesController.prototype,
      "reportUploadEvent",
    )?.value as object;

    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      AuthGuard,
      UserThrottlerGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.LEARNER]);
    expect(Reflect.getMetadata("THROTTLER:LIMITdefault", handler)).toBe(20);
    expect(Reflect.getMetadata("THROTTLER:TTLdefault", handler)).toBe(60_000);
  });
});
