/* eslint-disable */

import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { Response } from "express";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  UserRole,
  UserSessionRequest,
} from "../auth/interfaces/user.session.interface";
import { JwtBearerTokenAuthGuard } from "../auth/jwt/bearer-token-based/jwt.bearer.token.auth.guard";
import { MockJwtBearerTokenAuthGuard } from "../auth/jwt/bearer-token-based/mock.jwt.bearer.token.auth.guard";
import { JwtCookieAuthGuard } from "../auth/jwt/cookie-based/jwt.cookie.auth.guard";
import { MockJwtCookieAuthGuard } from "../auth/jwt/cookie-based/mock.jwt.cookie.auth.guard";
import { SavedSessionStore } from "../auth/jwt/cookie-based/saved-session.store";
import { MessagingService } from "../messaging/messaging.service";
import {
  ApiController,
  BACKEND_HEADER,
  DownstreamService,
} from "./api.controller";
import { ApiService } from "./api.service";

describe("ApiController", () => {
  let controller: ApiController;
  let apiService: ApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiController],
      providers: [
        ConfigService,
        MessagingService,
        ApiService,
        JwtBearerTokenAuthGuard,
        MockJwtBearerTokenAuthGuard,
        JwtCookieAuthGuard,
        MockJwtCookieAuthGuard,
        { provide: SavedSessionStore, useValue: { find: jest.fn() } },
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: {
            child: jest.fn().mockReturnValue({
              info: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
            }),
          } as Partial<Logger>,
        },
      ],
    }).compile();

    controller = module.get<ApiController>(ApiController);
    apiService = module.get<ApiService>(ApiService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("rootV1", () => {
    it("should call apiService.rootV1", () => {
      jest.spyOn(apiService, "rootV1").mockReturnValue({ version: "1.0.0" });

      const result = controller.rootV1();

      expect(apiService.rootV1).toHaveBeenCalled();
      expect(result).toEqual({ version: "1.0.0" });
    });
  });

  describe("handleLtiOauthConsumers", () => {
    let mockRequest: Partial<UserSessionRequest>;
    let mockResponse: Partial<Response>;

    beforeEach(() => {
      mockRequest = {
        headers: {},
        method: "GET",
        url: "/oauth_consumers",
      } as any;

      mockResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as any;
    });

    it("should forward SSE requests using forwardRequestUsingHttp", async () => {
      mockRequest.headers = { accept: "text/event-stream" };
      jest.spyOn(apiService, "getForwardingDetails").mockReturnValue({
        endpoint: "http://test.com",
        extraHeaders: {},
      });
      jest.spyOn(apiService, "forwardRequestUsingHttp").mockResolvedValue();

      await controller.handleLtiOauthConsumers(
        mockRequest as UserSessionRequest,
        mockResponse as Response,
      );

      expect(apiService.getForwardingDetails).toHaveBeenCalledWith(
        DownstreamService.LTI_CREDENTIAL_MANAGER,
        mockRequest,
      );
      expect(apiService.forwardRequestUsingHttp).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        "http://test.com",
        {},
      );
    });

    it("should forward non-SSE requests using forwardRequestToDownstreamService", async () => {
      mockRequest.headers = { accept: "application/json" };
      jest
        .spyOn(apiService, "forwardRequestToDownstreamService")
        .mockResolvedValue({
          status: 200,
          data: { success: true },
        } as any);

      await controller.handleLtiOauthConsumers(
        mockRequest as UserSessionRequest,
        mockResponse as Response,
      );

      expect(apiService.forwardRequestToDownstreamService).toHaveBeenCalledWith(
        DownstreamService.LTI_CREDENTIAL_MANAGER,
        mockRequest,
      );
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.send).toHaveBeenCalledWith({ success: true });
    });

    it("should handle POST requests", async () => {
      mockRequest.method = "POST";
      mockRequest.headers = { accept: "application/json" };
      jest
        .spyOn(apiService, "forwardRequestToDownstreamService")
        .mockResolvedValue({
          status: 201,
          data: { id: "123" },
        } as any);

      await controller.handleLtiOauthConsumers(
        mockRequest as UserSessionRequest,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.send).toHaveBeenCalledWith({ id: "123" });
    });
  });

  describe("handleAdminApiRequests", () => {
    let mockRequest: Partial<UserSessionRequest>;
    let mockResponse: Partial<Response>;

    beforeEach(() => {
      mockRequest = {
        headers: {},
        method: "GET",
        url: "/admin/users",
      } as any;

      mockResponse = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as any;
    });

    it("should forward SSE requests using forwardRequestUsingHttp", async () => {
      mockRequest.headers = { accept: "text/event-stream" };
      jest.spyOn(apiService, "getForwardingDetails").mockReturnValue({
        endpoint: "http://admin.test.com",
        extraHeaders: { "x-admin": "true" },
      });
      jest.spyOn(apiService, "forwardRequestUsingHttp").mockResolvedValue();

      await controller.handleAdminApiRequests(
        mockRequest as UserSessionRequest,
        mockResponse as Response,
      );

      expect(apiService.getForwardingDetails).toHaveBeenCalledWith(
        DownstreamService.MARK_API,
        mockRequest,
      );
      expect(apiService.forwardRequestUsingHttp).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        "http://admin.test.com",
        { "x-admin": "true" },
      );
    });

    it("should forward non-SSE requests using forwardRequestToDownstreamService", async () => {
      mockRequest.headers = { accept: "application/json" };
      jest
        .spyOn(apiService, "forwardRequestToDownstreamService")
        .mockResolvedValue({
          status: 200,
          data: { users: [] },
        } as any);

      await controller.handleAdminApiRequests(
        mockRequest as UserSessionRequest,
        mockResponse as Response,
      );

      expect(apiService.forwardRequestToDownstreamService).toHaveBeenCalledWith(
        DownstreamService.MARK_API,
        mockRequest,
      );
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.send).toHaveBeenCalledWith({ users: [] });
    });

    it("should handle DELETE requests", async () => {
      mockRequest.method = "DELETE";
      mockRequest.headers = { accept: "application/json" };
      jest
        .spyOn(apiService, "forwardRequestToDownstreamService")
        .mockResolvedValue({
          status: 204,
          data: null,
        } as any);

      await controller.handleAdminApiRequests(
        mockRequest as UserSessionRequest,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(204);
      expect(mockResponse.send).toHaveBeenCalledWith(null);
    });
  });

  describe("handleGradingStatusStream", () => {
    let mockRequest: Partial<UserSessionRequest>;
    let mockResponse: Partial<Response>;

    beforeEach(() => {
      mockRequest = {
        headers: {},
        method: "GET",
        url: "/assignments/123/attempts/456/grading/789/status-stream",
      } as any;

      mockResponse = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as any;
    });

    it("should forward grading status stream using forwardSSERequest", async () => {
      jest.spyOn(apiService, "getForwardingDetails").mockReturnValue({
        endpoint: "http://api.test.com/grading/status",
        extraHeaders: {},
      });
      jest.spyOn(apiService, "forwardSSERequest").mockResolvedValue();

      await controller.handleGradingStatusStream(
        mockRequest as UserSessionRequest,
        mockResponse as Response,
      );

      expect(apiService.getForwardingDetails).toHaveBeenCalledWith(
        DownstreamService.MARK_API,
        mockRequest,
      );
      expect(apiService.forwardSSERequest).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        "http://api.test.com/grading/status",
        {},
      );
    });
  });

  describe("handlePublishStatusStream", () => {
    let mockRequest: Partial<UserSessionRequest>;
    let mockResponse: Partial<Response>;

    beforeEach(() => {
      mockRequest = {
        headers: {},
        method: "GET",
        url: "/assignments/jobs/job123/status-stream",
      } as any;

      mockResponse = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as any;
    });

    it("should forward publish status stream using forwardSSERequest", async () => {
      jest.spyOn(apiService, "getForwardingDetails").mockReturnValue({
        endpoint: "http://api.test.com/publish/status",
        extraHeaders: { "x-stream": "true" },
      });
      jest.spyOn(apiService, "forwardSSERequest").mockResolvedValue();

      await controller.handlePublishStatusStream(
        mockRequest as UserSessionRequest,
        mockResponse as Response,
      );

      expect(apiService.getForwardingDetails).toHaveBeenCalledWith(
        DownstreamService.MARK_API,
        mockRequest,
      );
      expect(apiService.forwardSSERequest).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        "http://api.test.com/publish/status",
        { "x-stream": "true" },
      );
    });
  });

  describe("handleApiRequests", () => {
    let mockRequest: Partial<UserSessionRequest>;
    let mockResponse: Partial<Response>;

    beforeEach(() => {
      mockRequest = {
        headers: {},
        method: "GET",
        url: "/assignments",
      } as any;

      mockResponse = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as any;
    });

    it("should forward SSE requests using forwardRequestUsingHttp", async () => {
      mockRequest.headers = { accept: "text/event-stream" };
      jest.spyOn(apiService, "getForwardingDetails").mockReturnValue({
        endpoint: "http://api.test.com",
        extraHeaders: {},
      });
      jest.spyOn(apiService, "forwardRequestUsingHttp").mockResolvedValue();

      await controller.handleApiRequests(
        mockRequest as UserSessionRequest,
        mockResponse as Response,
      );

      expect(apiService.getForwardingDetails).toHaveBeenCalledWith(
        DownstreamService.MARK_API,
        mockRequest,
      );
      expect(apiService.forwardRequestUsingHttp).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        "http://api.test.com",
        {},
      );
    });

    it("should forward non-SSE requests using forwardRequestToDownstreamService", async () => {
      mockRequest.headers = { accept: "application/json" };
      jest
        .spyOn(apiService, "forwardRequestToDownstreamService")
        .mockResolvedValue({
          status: 200,
          data: { assignments: [] },
        } as any);

      await controller.handleApiRequests(
        mockRequest as UserSessionRequest,
        mockResponse as Response,
      );

      expect(apiService.forwardRequestToDownstreamService).toHaveBeenCalledWith(
        DownstreamService.MARK_API,
        mockRequest,
      );
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.send).toHaveBeenCalledWith({ assignments: [] });
    });

    it("should handle PUT requests", async () => {
      mockRequest.method = "PUT";
      mockRequest.headers = { accept: "application/json" };
      jest
        .spyOn(apiService, "forwardRequestToDownstreamService")
        .mockResolvedValue({
          status: 200,
          data: { updated: true },
        } as any);

      await controller.handleApiRequests(
        mockRequest as UserSessionRequest,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.send).toHaveBeenCalledWith({ updated: true });
    });

    it("should handle error responses", async () => {
      mockRequest.headers = { accept: "application/json" };
      jest
        .spyOn(apiService, "forwardRequestToDownstreamService")
        .mockResolvedValue({
          status: 500,
          data: { error: "Internal server error" },
        } as any);

      await controller.handleApiRequests(
        mockRequest as UserSessionRequest,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.send).toHaveBeenCalledWith({
        error: "Internal server error",
      });
    });
  });
  describe("v3 routing", () => {
    const GRADING_PATH =
      "/api/v2/assignments/12/attempts/34/grading/0f8fad5b-d9cb-469f-a165-70867728950e/status-stream";
    const ROUTING_ENV = [
      "MARK_V3_ROUTES",
      "MARK_V3_API_ENDPOINT",
      "MARK_API_ENDPOINT",
    ] as const;
    let savedEnv: Record<string, string | undefined>;
    let routedController: ApiController;
    let routedService: ApiService;
    let response: Partial<Response>;

    const requestFor = (
      method: string,
      originalUrl: string,
      role: UserRole,
    ): UserSessionRequest =>
      ({
        headers: {},
        method,
        originalUrl,
        user: { userId: "learner@example.com", role },
      }) as any;

    beforeEach(async () => {
      savedEnv = Object.fromEntries(
        ROUTING_ENV.map((key) => [key, process.env[key]]),
      );
      process.env.MARK_V3_ROUTES = "learner-submit";
      process.env.MARK_V3_API_ENDPOINT = "http://mark-v3-api:3000";
      process.env.MARK_API_ENDPOINT = "http://mark-api:3000";

      // The routing config is read when ApiService is constructed.
      const module: TestingModule = await Test.createTestingModule({
        controllers: [ApiController],
        providers: [
          ConfigService,
          MessagingService,
          ApiService,
          JwtBearerTokenAuthGuard,
          MockJwtBearerTokenAuthGuard,
          JwtCookieAuthGuard,
          MockJwtCookieAuthGuard,
          { provide: SavedSessionStore, useValue: { find: jest.fn() } },
          {
            provide: WINSTON_MODULE_PROVIDER,
            useValue: {
              child: jest.fn().mockReturnValue({
                info: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
              }),
            } as Partial<Logger>,
          },
        ],
      }).compile();
      routedController = module.get<ApiController>(ApiController);
      routedService = module.get<ApiService>(ApiService);

      response = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as any;
    });

    afterEach(() => {
      for (const key of ROUTING_ENV) {
        if (savedEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedEnv[key];
        }
      }
    });

    it("sends a learner grading stream to the v3 API", async () => {
      const request = requestFor("GET", GRADING_PATH, UserRole.LEARNER);
      jest.spyOn(routedService, "forwardSSERequest").mockResolvedValue();

      await routedController.handleGradingStatusStream(
        request,
        response as Response,
      );

      expect(BACKEND_HEADER).toBe("x-mark-backend");
      expect(response.setHeader).toHaveBeenCalledWith(BACKEND_HEADER, "v3");
      expect(routedService.forwardSSERequest).toHaveBeenCalledWith(
        request,
        response,
        `http://mark-v3-api:3000${GRADING_PATH}`,
        expect.objectContaining({ "Cache-Control": "no-cache" }),
      );
    });

    it("keeps an author's grading stream on mark-api", async () => {
      const request = requestFor("GET", GRADING_PATH, UserRole.AUTHOR);
      jest.spyOn(routedService, "forwardSSERequest").mockResolvedValue();

      await routedController.handleGradingStatusStream(
        request,
        response as Response,
      );

      expect(response.setHeader).toHaveBeenCalledWith(BACKEND_HEADER, "legacy");
      expect(routedService.forwardSSERequest).toHaveBeenCalledWith(
        request,
        response,
        `http://mark-api:3000${GRADING_PATH}`,
        expect.any(Object),
      );
    });

    it("keeps the publish stream on mark-api while no family lists it", async () => {
      const path = "/api/v2/assignments/jobs/55/status-stream";
      const request = requestFor("GET", path, UserRole.AUTHOR);
      jest.spyOn(routedService, "forwardSSERequest").mockResolvedValue();
      const resolve = jest.spyOn(routedService, "resolveDownstream");

      await routedController.handlePublishStatusStream(
        request,
        response as Response,
      );

      expect(resolve).toHaveBeenCalledWith(request);
      expect(response.setHeader).toHaveBeenCalledWith(BACKEND_HEADER, "legacy");
      expect(routedService.forwardSSERequest).toHaveBeenCalledWith(
        request,
        response,
        `http://mark-api:3000${path}`,
        expect.any(Object),
      );
    });

    it("always sends /admin traffic to mark-api, even on a routed path", async () => {
      const request = requestFor("GET", GRADING_PATH, UserRole.LEARNER);
      const resolve = jest.spyOn(routedService, "resolveDownstream");
      jest
        .spyOn(routedService, "forwardRequestToDownstreamService")
        .mockResolvedValue({ status: 200, data: {} } as any);

      await routedController.handleAdminApiRequests(
        { ...request, originalUrl: "/api/v1/admin/x" } as UserSessionRequest,
        response as Response,
      );

      expect(resolve).not.toHaveBeenCalled();
      expect(response.setHeader).toHaveBeenCalledWith(BACKEND_HEADER, "legacy");
      expect(
        routedService.forwardRequestToDownstreamService,
      ).toHaveBeenCalledWith(DownstreamService.MARK_API, expect.anything());
    });

    it("sends a routed learner request from the catch-all to the v3 API", async () => {
      const path = "/api/v2/assignments/12/attempts/34/submission-status";
      const request = requestFor("GET", path, UserRole.LEARNER);
      jest
        .spyOn(routedService, "forwardRequestToDownstreamService")
        .mockResolvedValue({ status: 200, data: { ok: true } } as any);

      await routedController.handleApiRequests(request, response as Response);

      expect(response.setHeader).toHaveBeenCalledWith(BACKEND_HEADER, "v3");
      expect(
        routedService.forwardRequestToDownstreamService,
      ).toHaveBeenCalledWith(DownstreamService.MARK_V3_API, request);
    });

    it("marks an unrouted catch-all request as legacy", async () => {
      const request = requestFor(
        "GET",
        "/api/v2/assignments/12/reports",
        UserRole.LEARNER,
      );
      jest
        .spyOn(routedService, "forwardRequestToDownstreamService")
        .mockResolvedValue({ status: 200, data: [] } as any);

      await routedController.handleApiRequests(request, response as Response);

      expect(response.setHeader).toHaveBeenCalledWith(BACKEND_HEADER, "legacy");
      expect(
        routedService.forwardRequestToDownstreamService,
      ).toHaveBeenCalledWith(DownstreamService.MARK_API, request);
    });

    it("streams a routed catch-all event-stream request from the v3 API", async () => {
      const path = "/api/v2/assignments/12/attempts/34/submission-status";
      const request = requestFor("GET", path, UserRole.LEARNER);
      request.headers = { accept: "text/event-stream" };
      jest.spyOn(routedService, "forwardRequestUsingHttp").mockResolvedValue();

      await routedController.handleApiRequests(request, response as Response);

      expect(response.setHeader).toHaveBeenCalledWith(BACKEND_HEADER, "v3");
      expect(routedService.forwardRequestUsingHttp).toHaveBeenCalledWith(
        request,
        response,
        `http://mark-v3-api:3000${path}`,
        expect.any(Object),
      );
    });
  });
});
