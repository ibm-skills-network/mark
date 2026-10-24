/* eslint-disable */
import { BadRequestException } from "@nestjs/common";
import { Response } from "express";
import { Logger } from "winston";
import {
  UserRole,
  UserSessionRequest,
} from "../auth/interfaces/user.session.interface";
import { MessagingService } from "../messaging/messaging.service";
import {
  ApiController,
  BACKEND_HEADER,
  DownstreamService,
} from "./api.controller";
import { ApiService } from "./api.service";
import {
  matchFamily,
  parseRustRoutingConfig,
  resolveDownstream,
  ROUTE_FAMILIES,
} from "./rust-routing";

const ALL = new Set(ROUTE_FAMILIES.keys());

function makeLogger() {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
}

function makeRequest(
  method: string,
  originalUrl: string,
  role: UserRole = UserRole.LEARNER,
  headers: Record<string, string> = {},
): UserSessionRequest {
  return {
    method,
    originalUrl,
    headers,
    user: {
      userId: "learner@example.com",
      role,
      assignmentId: 12,
      groupId: "g",
    },
  } as unknown as UserSessionRequest;
}

describe("rust routing", () => {
  describe("matchFamily", () => {
    it.each([
      ["GET", "/api/v2/assignments/12", "learner-reads"],
      ["GET", "/api/v2/assignments/12?lang=fr", "learner-reads"],
      ["get", "/api/v2/assignments/12/languages", "learner-reads"],
      ["GET", "/api/v2/assignments/12/attempts", "learner-reads"],
      ["GET", "/api/v2/assignments/12/attempts/345", "learner-reads"],
      ["POST", "/api/v2/assignments/12/attempts", "learner-attempt-writes"],
      [
        "POST",
        "/api/v2/assignments/12/attempts/345/abandon",
        "learner-attempt-writes",
      ],
      ["PATCH", "/api/v2/assignments/12/attempts/345", "learner-submit"],
      ["patch", "/api/v2/assignments/12/attempts/345?x=1", "learner-submit"],
      [
        "GET",
        "/api/v2/assignments/12/attempts/345/completed",
        "learner-submit",
      ],
      [
        "GET",
        "/api/v2/assignments/12/attempts/345/submission-status",
        "learner-submit",
      ],
      ["POST", "/api/v2/assignments/12/attempts/345/notify", "learner-submit"],
      [
        "GET",
        "/api/v2/assignments/12/attempts/345/grade-sync-status",
        "learner-submit",
      ],
    ])("%s %s -> %s", (method, url, family) => {
      expect(matchFamily(method, url, ALL)).toBe(family);
    });

    it.each([
      ["GET", "/api/v2/assignments/12/questions"],
      ["GET", "/api/v2/assignments/12/"],
      ["GET", "/api/v2/assignments/abc"],
      ["GET", "/api/v2/assignments/12/attempts/x1"],
      ["GET", "/api/v2/assignments/12/attempts/345/abandon"],
      ["GET", "/api/v1/assignments/12"],
      ["GET", "/prefix/api/v2/assignments/12"],
      ["GET", "//evil.com/api/v2/assignments/12"],
      ["PUT", "/api/v2/assignments/12"],
      ["DELETE", "/api/v2/assignments/12/attempts/345"],
      ["PATCH", "/api/v2/assignments/12"],
      ["PATCH", "/api/v2/assignments/12/attempts"],
      ["PATCH", "/api/v2/assignments/12/attempts/345/"],
      ["PATCH", "/api/v2/assignments/12/attempts/345/abandon"],
      ["PATCH", "/api/v2/assignments/12/attempts/345/completed"],
      ["PATCH", "/api/v2/assignments/12/attempts/x345"],
      ["PUT", "/api/v2/assignments/12/attempts/345"],
      ["POST", "/api/v2/assignments/12/attempts/345/completed"],
      ["GET", "/api/v2/assignments/12/attempts/345/completed/extra"],
      ["GET", "/api/v2/assignments/12/attempts/345/notify"],
      ["POST", "/api/v2/assignments/12/attempts/345/submission-status"],
      ["PATCH", "/api/v2/assignments/12/attempts/345/grade-sync-status"],
      [
        "GET",
        "/api/v2/assignments/12/attempts/345/grading/0b6d0f3c-9a0e-4a5c-9d0e-1f2a3b4c5d6e/status-stream",
      ],
      ["POST", "/api/v2/assignments/12/questions/7/translations"],
      ["GET", "/api/v2/assignments/12/attempts/345/feedback"],
      ["POST", "/api/v2/assignments/12"],
      ["POST", "/api/v2/assignments/12/attempts/345/submit"],
      ["HEAD", "/api/v2/assignments/12"],
    ])("%s %s does not match", (method, url) => {
      expect(matchFamily(method, url, ALL)).toBeUndefined();
    });

    it("keeps the submit routes off rust unless learner-submit is enabled", () => {
      const others = new Set(["learner-reads", "learner-attempt-writes"]);
      expect(
        matchFamily("PATCH", "/api/v2/assignments/12/attempts/345", others),
      ).toBeUndefined();
      expect(
        matchFamily(
          "GET",
          "/api/v2/assignments/12/attempts/345/completed",
          others,
        ),
      ).toBeUndefined();
    });

    it("only matches enabled families", () => {
      const reads = new Set(["learner-reads"]);
      expect(
        matchFamily("POST", "/api/v2/assignments/12/attempts", reads),
      ).toBeUndefined();
      expect(matchFamily("GET", "/api/v2/assignments/12/attempts", reads)).toBe(
        "learner-reads",
      );
    });

    it("tolerates missing method or url", () => {
      expect(
        matchFamily(undefined, "/api/v2/assignments/1", ALL),
      ).toBeUndefined();
      expect(matchFamily("GET", undefined, ALL)).toBeUndefined();
    });
  });

  describe("resolveDownstream", () => {
    const config = { endpoint: "http://mark-rust-api", families: ALL };

    it("routes learners on enabled families to rust", () => {
      expect(
        resolveDownstream(makeRequest("GET", "/api/v2/assignments/12"), config),
      ).toEqual({ service: "rust", family: "learner-reads" });
    });

    it.each([UserRole.AUTHOR, UserRole.ADMIN])(
      "keeps %s on legacy even for a routed family",
      (role) => {
        expect(
          resolveDownstream(
            makeRequest("GET", "/api/v2/assignments/12", role),
            config,
          ),
        ).toEqual({ service: "legacy", family: "learner-reads" });
      },
    );

    it.each([UserRole.AUTHOR, UserRole.ADMIN])(
      "keeps %s submits on legacy",
      (role) => {
        expect(
          resolveDownstream(
            makeRequest("PATCH", "/api/v2/assignments/12/attempts/345", role),
            config,
          ),
        ).toEqual({ service: "legacy", family: "learner-submit" });
      },
    );

    it("routes a learner submit to rust", () => {
      expect(
        resolveDownstream(
          makeRequest("PATCH", "/api/v2/assignments/12/attempts/345"),
          config,
        ),
      ).toEqual({ service: "rust", family: "learner-submit" });
    });

    it("keeps requests without a session on legacy", () => {
      const request = { method: "GET", originalUrl: "/api/v2/assignments/12" };
      expect(resolveDownstream(request, config).service).toBe("legacy");
    });

    it("keeps unmatched paths on legacy without a family", () => {
      expect(
        resolveDownstream(
          makeRequest("GET", "/api/v2/assignments/12/questions"),
          config,
        ),
      ).toEqual({ service: "legacy" });
    });

    it("routes nothing when no endpoint is configured", () => {
      expect(
        resolveDownstream(makeRequest("GET", "/api/v2/assignments/12"), {
          endpoint: undefined,
          families: ALL,
        }),
      ).toEqual({ service: "legacy" });
    });
  });

  describe("parseRustRoutingConfig", () => {
    it("routes nothing when unset", () => {
      const logger = makeLogger();
      const config = parseRustRoutingConfig({}, logger as unknown as Logger);
      expect(config.families.size).toBe(0);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("routes nothing when empty", () => {
      const config = parseRustRoutingConfig(
        {
          MARK_RUST_API_ENDPOINT: "http://mark-rust-api",
          MARK_RUST_ROUTES: " , ",
        },
        makeLogger() as unknown as Logger,
      );
      expect(config.families.size).toBe(0);
    });

    it("parses known families and warns on unknown ones", () => {
      const logger = makeLogger();
      const config = parseRustRoutingConfig(
        {
          MARK_RUST_API_ENDPOINT: "http://mark-rust-api/",
          MARK_RUST_ROUTES: "learner-reads, bogus ,learner-attempt-writes",
        },
        logger as unknown as Logger,
      );
      expect([...config.families].sort()).toEqual([
        "learner-attempt-writes",
        "learner-reads",
      ]);
      expect(config.endpoint).toBe("http://mark-rust-api");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("unknown"),
        { family: "bogus" },
      );
    });

    it("does not treat prototype keys as families", () => {
      const config = parseRustRoutingConfig(
        {
          MARK_RUST_API_ENDPOINT: "http://mark-rust-api",
          MARK_RUST_ROUTES: "toString,constructor",
        },
        makeLogger() as unknown as Logger,
      );
      expect(config.families.size).toBe(0);
    });

    it("logs an error and routes nothing when the endpoint is missing", () => {
      const logger = makeLogger();
      const config = parseRustRoutingConfig(
        { MARK_RUST_ROUTES: "learner-reads" },
        logger as unknown as Logger,
      );
      expect(config.families.size).toBe(0);
      expect(config.endpoint).toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("ApiService forwarding", () => {
    const saved = { ...process.env };
    let logger: ReturnType<typeof makeLogger>;

    function makeService(routes: string, endpoint?: string): ApiService {
      process.env.MARK_API_ENDPOINT = "http://mark-api:3000";
      process.env.MARK_RUST_ROUTES = routes;
      if (endpoint === undefined) delete process.env.MARK_RUST_API_ENDPOINT;
      else process.env.MARK_RUST_API_ENDPOINT = endpoint;
      logger = makeLogger();
      return new ApiService(
        {} as MessagingService,
        logger as unknown as Logger,
      );
    }

    afterEach(() => {
      process.env = { ...saved };
    });

    it("resolves learner reads to rust and logs family + backend", () => {
      const service = makeService(
        "learner-reads,learner-attempt-writes",
        "http://mark-rust-api",
      );
      const request = makeRequest(
        "GET",
        "/api/v2/assignments/12/attempts",
        UserRole.LEARNER,
        {
          "x-request-id": "req-1",
        },
      );
      expect(service.resolveDownstream(request)).toEqual({
        service: "rust",
        family: "learner-reads",
      });
      expect(logger.info).toHaveBeenCalledWith("downstream_route", {
        family: "learner-reads",
        backend: "rust",
        method: "GET",
        request_id: "req-1",
      });
    });

    it("routes everything to legacy when the endpoint is missing", () => {
      const service = makeService("learner-reads");
      expect(
        service.resolveDownstream(makeRequest("GET", "/api/v2/assignments/12")),
      ).toEqual({ service: "legacy" });
      expect(logger.error).toHaveBeenCalled();
    });

    it("builds the rust endpoint with the same session and cookie headers as legacy", () => {
      const service = makeService("learner-reads", "http://mark-rust-api");
      const request = makeRequest(
        "GET",
        "/api/v2/assignments/12?lang=fr",
        UserRole.LEARNER,
        { cookie: "authentication=aaa; authentication=bbb; other=1" },
      );
      const rust = service.getForwardingDetails(
        DownstreamService.MARK_RUST_API,
        request,
      );
      const legacy = service.getForwardingDetails(
        DownstreamService.MARK_API,
        request,
      );
      expect(rust.endpoint).toBe(
        "http://mark-rust-api/api/v2/assignments/12?lang=fr",
      );
      expect(legacy.endpoint).toBe(
        "http://mark-api:3000/api/v2/assignments/12?lang=fr",
      );
      expect(rust.extraHeaders).toEqual(legacy.extraHeaders);
      expect(rust.extraHeaders["user-session"]).toBe(
        JSON.stringify(request.user),
      );
      expect(rust.extraHeaders.cookie).toBeDefined();
    });

    it.each([
      "//evil.com/x",
      "@evil.com/api/v2/assignments/12",
      "/api/v2/assignments/12/questions",
    ])("blocks a rust forward for %s", (originalUrl) => {
      const service = makeService("learner-reads", "http://mark-rust-api");
      expect(() =>
        service.getForwardingDetails(
          DownstreamService.MARK_RUST_API,
          makeRequest("GET", originalUrl),
        ),
      ).toThrow(BadRequestException);
    });

    it("blocks a rust forward for a non-learner session", () => {
      const service = makeService("learner-reads", "http://mark-rust-api");
      expect(() =>
        service.getForwardingDetails(
          DownstreamService.MARK_RUST_API,
          makeRequest("GET", "/api/v2/assignments/12", UserRole.AUTHOR),
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe("ApiController backend header", () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });

    function setup() {
      process.env.MARK_API_ENDPOINT = "http://mark-api:3000";
      process.env.MARK_RUST_API_ENDPOINT = "http://mark-rust-api";
      process.env.MARK_RUST_ROUTES = "learner-reads";
      const service = new ApiService(
        {} as MessagingService,
        makeLogger() as unknown as Logger,
      );
      const controller = new ApiController(service);
      const forward = jest
        .spyOn(service, "forwardRequestToDownstreamService")
        .mockResolvedValue({ status: 200, data: "{}" });
      const response = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      };
      return { service, controller, forward, response };
    }

    it("sends routed learner requests to rust and marks the response", async () => {
      const { controller, forward, response } = setup();
      const request = makeRequest("GET", "/api/v2/assignments/12");
      await controller.handleApiRequests(
        request,
        response as unknown as Response,
      );
      expect(forward).toHaveBeenCalledWith(
        DownstreamService.MARK_RUST_API,
        request,
      );
      expect(response.setHeader).toHaveBeenCalledWith(BACKEND_HEADER, "rust");
    });

    it("sends authors to legacy and marks the response", async () => {
      const { controller, forward, response } = setup();
      const request = makeRequest(
        "GET",
        "/api/v2/assignments/12",
        UserRole.AUTHOR,
      );
      await controller.handleApiRequests(
        request,
        response as unknown as Response,
      );
      expect(forward).toHaveBeenCalledWith(DownstreamService.MARK_API, request);
      expect(response.setHeader).toHaveBeenCalledWith(BACKEND_HEADER, "legacy");
    });

    it("sends SSE requests for routed paths through the rust forwarding details", async () => {
      const { service, controller, response } = setup();
      const http = jest
        .spyOn(service, "forwardRequestUsingHttp")
        .mockResolvedValue();
      const request = makeRequest(
        "GET",
        "/api/v2/assignments/12",
        UserRole.LEARNER,
        {
          accept: "text/event-stream",
        },
      );
      await controller.handleApiRequests(
        request,
        response as unknown as Response,
      );
      expect(http).toHaveBeenCalledWith(
        request,
        response,
        "http://mark-rust-api/api/v2/assignments/12",
        expect.objectContaining({ "user-session": expect.any(String) }),
      );
      expect(response.setHeader).toHaveBeenCalledWith(BACKEND_HEADER, "rust");
    });

    it("keeps the grading status stream on the legacy API with every family enabled", async () => {
      process.env.MARK_API_ENDPOINT = "http://mark-api:3000";
      process.env.MARK_RUST_API_ENDPOINT = "http://mark-rust-api";
      process.env.MARK_RUST_ROUTES = [...ALL].join(",");
      const service = new ApiService(
        {} as MessagingService,
        makeLogger() as unknown as Logger,
      );
      const controller = new ApiController(service);
      const sse = jest.spyOn(service, "forwardSSERequest").mockResolvedValue();
      const url =
        "/api/v2/assignments/12/attempts/345/grading/0b6d0f3c-9a0e-4a5c-9d0e-1f2a3b4c5d6e/status-stream";
      const request = makeRequest("GET", url, UserRole.LEARNER, {
        accept: "text/event-stream",
      });
      const response = { setHeader: jest.fn() };
      await controller.handleGradingStatusStream(
        request,
        response as unknown as Response,
      );
      expect(sse).toHaveBeenCalledWith(
        request,
        response,
        `http://mark-api:3000${url}`,
        expect.any(Object),
      );
    });

    it("marks admin API responses as legacy", async () => {
      const { controller, response } = setup();
      const request = makeRequest("GET", "/api/v1/admin/x", UserRole.ADMIN);
      await controller.handleAdminApiRequests(
        request,
        response as unknown as Response,
      );
      expect(response.setHeader).toHaveBeenCalledWith(BACKEND_HEADER, "legacy");
    });
  });
});
