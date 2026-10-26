/* eslint-disable */
import { Logger } from "winston";
import {
  UserRole,
  UserSessionRequest,
} from "../auth/interfaces/user.session.interface";
import {
  matchFamily,
  parseV3RoutingConfig,
  resolveDownstream,
  ROUTE_FAMILIES,
} from "./v3-routing";

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

describe("v3 routing", () => {
  describe("matchFamily", () => {
    it.each([
      ["GET", "/api/v1/user-session", "session-meta"],
      ["GET", "/api/v1/ai-status", "session-meta"],
      [
        "GET",
        "/api/v2/assignments/12/attempts/345/grading/9/status-stream",
        "learner-submit",
      ],
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
      ["POST", "/api/v2/assignments/12/attempts/345/grading/9/status-stream"],
      ["GET", "/api/v2/assignments/12/attempts/345/grading/9/status-stream/x"],
      ["POST", "/api/v1/user-session"],
      ["GET", "/api/v1/user-session/x"],
      ["POST", "/api/v2/assignments/12/questions/7/translations"],
      ["GET", "/api/v2/assignments/12/attempts/345/feedback"],
      ["POST", "/api/v2/assignments/12"],
      ["POST", "/api/v2/assignments/12/attempts/345/submit"],
      ["HEAD", "/api/v2/assignments/12"],
    ])("%s %s does not match", (method, url) => {
      expect(matchFamily(method, url, ALL)).toBeUndefined();
    });

    it("keeps the submit routes off v3 unless learner-submit is enabled", () => {
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
    const config = { endpoint: "http://mark-v3-api", families: ALL };

    it("routes learners on enabled families to v3", () => {
      expect(
        resolveDownstream(makeRequest("GET", "/api/v2/assignments/12"), config),
      ).toEqual({ service: "v3", family: "learner-reads" });
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

    it("routes a learner submit to v3", () => {
      expect(
        resolveDownstream(
          makeRequest("PATCH", "/api/v2/assignments/12/attempts/345"),
          config,
        ),
      ).toEqual({ service: "v3", family: "learner-submit" });
    });

    it.each([UserRole.LEARNER, UserRole.AUTHOR])(
      "routes %s on session-meta to v3",
      (role) => {
        expect(
          resolveDownstream(
            makeRequest("GET", "/api/v1/user-session", role),
            config,
          ),
        ).toEqual({ service: "v3", family: "session-meta" });
      },
    );

    it("keeps an admin on session-meta on legacy", () => {
      expect(
        resolveDownstream(
          makeRequest("GET", "/api/v1/ai-status", UserRole.ADMIN),
          config,
        ),
      ).toEqual({ service: "legacy", family: "session-meta" });
    });

    it("keeps an author off the grading stream", () => {
      expect(
        resolveDownstream(
          makeRequest(
            "GET",
            "/api/v2/assignments/12/attempts/345/grading/9/status-stream",
            UserRole.AUTHOR,
          ),
          config,
        ),
      ).toEqual({ service: "legacy", family: "learner-submit" });
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

  describe("parseV3RoutingConfig", () => {
    it("routes nothing when unset", () => {
      const logger = makeLogger();
      const config = parseV3RoutingConfig({}, logger as unknown as Logger);
      expect(config.families.size).toBe(0);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("routes nothing when empty", () => {
      const config = parseV3RoutingConfig(
        {
          MARK_V3_API_ENDPOINT: "http://mark-v3-api",
          MARK_V3_ROUTES: " , ",
        },
        makeLogger() as unknown as Logger,
      );
      expect(config.families.size).toBe(0);
    });

    it("parses known families and warns on unknown ones", () => {
      const logger = makeLogger();
      const config = parseV3RoutingConfig(
        {
          MARK_V3_API_ENDPOINT: "http://mark-v3-api/",
          MARK_V3_ROUTES: "learner-reads, bogus ,learner-attempt-writes",
        },
        logger as unknown as Logger,
      );
      expect([...config.families].sort()).toEqual([
        "learner-attempt-writes",
        "learner-reads",
      ]);
      expect(config.endpoint).toBe("http://mark-v3-api");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("unknown"),
        { family: "bogus" },
      );
    });

    it("does not treat prototype keys as families", () => {
      const config = parseV3RoutingConfig(
        {
          MARK_V3_API_ENDPOINT: "http://mark-v3-api",
          MARK_V3_ROUTES: "toString,constructor",
        },
        makeLogger() as unknown as Logger,
      );
      expect(config.families.size).toBe(0);
    });

    it("logs an error and routes nothing when the endpoint is missing", () => {
      const logger = makeLogger();
      const config = parseV3RoutingConfig(
        { MARK_V3_ROUTES: "learner-reads" },
        logger as unknown as Logger,
      );
      expect(config.families.size).toBe(0);
      expect(config.endpoint).toBeUndefined();
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});
