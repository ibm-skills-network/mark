import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import express from "express";
import { sign } from "jsonwebtoken";
import { of } from "rxjs";
import request from "supertest";
import { DownstreamService } from "../../../../../api-gateway/src/api/api.controller";
import { ApiService as GatewayService } from "../../../../../api-gateway/src/api/api.service";
import { JwtCookieStrategy } from "../../../../../api-gateway/src/auth/jwt/cookie-based/jwt.cookie.strategy";
import { JwtConfigService } from "../../../../../api-gateway/src/auth/jwt/jwt.config.service";
import { UserSessionRequest } from "../../../auth/interfaces/user.session.interface";
import { UserSessionMiddleware } from "../../../auth/middleware/user.session.middleware";
import { ApiController } from "../../api.controller";
import { ReportsController } from "../controllers/report.controller";
import { PortalLookupService } from "./portal-lookup.service";
import { ReportsService } from "./report.service";
import { SnSupportService } from "./sn-support.service";
import { SupportRoutingService } from "./support-routing.service";

// Exercise the real JWT strategy, session transport, controllers, routing,
// portal lookup and ticket serializer together. Only external services and
// persistence are faked; no live support tickets or messages are created.
const SECRET = "portal-routing-test-secret"; // pragma: allowlist secret
const COURSERA_OUTCOME = "https://api.coursera.org/api/onDemandLtiOutcomes.v1";
const env = {
  PORTAL_MANAGER_API_BASE_URL: "https://portals.example",
  PORTAL_MANAGER_TOKEN_URL: "https://portals.example/oauth/token",
  PORTAL_MANAGER_UID: "test-client",
  PORTAL_MANAGER_SECRET: "test-client-secret", // pragma: allowlist secret
  SN_SUPPORT_URL: "https://support.example",
  SUPPORT_TOKEN_COURSERA: "test-coursera",
  SUPPORT_TOKEN_EDX: "test-edx",
  SUPPORT_TOKEN_COGNITIVE_CLASS: "test-cc",
  SUPPORT_TOKEN_ICE: "test-ice",
  SUPPORT_TOKEN_MARK: "test-mark",
};

const portalRecords = [
  {
    domain: "cognitiveclass.ai",
    name: "Cognitive Class",
    support_product_name: "Cognitive Class",
  },
  {
    domain: "lpu.cognitiveclass.ai",
    name: "Lovely Professional University",
    support_product_name: "ICE",
  },
];

function make() {
  const logger = { child: () => logger, error: jest.fn(), warn: jest.fn() };
  const config = new ConfigService(env);
  const http = {
    get: jest.fn((url: string) => {
      const host = new URL(url).searchParams.get("filter[by_domain]");
      return of({
        data: { data: portalRecords.filter((p) => p.domain === host) },
      });
    }),
    post: jest.fn((url: string, _body: unknown, _options: unknown) =>
      of({
        data: url.endsWith("/oauth/token")
          ? { access_token: "test-access-token", expires_in: 3600 }
          : { ticketKey: "SUPPORT-719" },
      }),
    ),
  };
  const lookup = new PortalLookupService(http as never, config);
  const routing = new SupportRoutingService(config, lookup);
  const support = new SnSupportService(http as never, config);
  const prisma = {
    report: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 719 }),
    },
  };
  const reports = new ReportsController(
    new ReportsService(
      { sendError: jest.fn().mockResolvedValue(undefined) } as never,
      prisma as never,
      undefined as never,
      undefined as never,
      support,
      routing,
    ),
  );
  const api = express();
  api.use(express.json());
  const middleware = new UserSessionMiddleware(logger as never);
  api.use((req, res, next) =>
    middleware.use(req as UserSessionRequest, res, next),
  );
  api.post("/api/v1/reports", async (req, res) => {
    res.json(
      await reports.reportIssue(
        req.body,
        undefined as never,
        req as UserSessionRequest,
      ),
    );
  });
  api.get("/api/v1/user-session", (req, res) => {
    res.json(
      new ApiController(undefined as never).getUserSession(
        req as UserSessionRequest,
      ),
    );
  });
  const gateway = new GatewayService(undefined as never, logger as never);
  const authenticate = async (
    claims: Record<string, unknown>,
    secret = SECRET, // pragma: allowlist secret
  ) => {
    const strategy = new JwtCookieStrategy({
      jwtConstants: { secret: SECRET },
    } as JwtConfigService);
    const token = sign(
      {
        userID: "learner@example.com",
        role: "learner",
        assignmentID: 42,
        groupID: "course",
        ...claims,
      },
      secret,
      { expiresIn: "1h" },
    );
    const req = {
      originalUrl: "/api/v1/reports",
      headers: { cookie: `authentication=${token}` },
    };
    const user = await new Promise((resolve, reject) => {
      strategy.success = resolve;
      strategy.fail = () => reject(new Error("Authentication failed"));
      strategy.error = reject;
      strategy.authenticate(req as never);
    });
    return gateway.getForwardingDetails(DownstreamService.MARK_API, {
      ...req,
      user,
    } as never).extraHeaders;
  };
  return { api, http, prisma, authenticate };
}

describe("LTI launch to support ticket routing", () => {
  const previousEndpoint = process.env.MARK_API_ENDPOINT;
  beforeAll(() => {
    process.env.MARK_API_ENDPOINT = "http://127.0.0.1:3000";
  });
  afterAll(() => {
    if (previousEndpoint === undefined) delete process.env.MARK_API_ENDPOINT;
    else process.env.MARK_API_ENDPOINT = previousEndpoint;
  });

  it.each([
    ["Coursera", COURSERA_OUTCOME, "test-coursera", "Coursera"],
    ["edX", "https://courses.edx.org/outcome", "test-edx", "edX"],
    [
      "Cognitive Class",
      "https://courses.cognitiveclass.ai/outcome",
      "test-cc",
      "Cognitive Class",
    ],
    [
      "partner portal",
      "https://courses.lpu.cognitiveclass.ai/outcome",
      "test-ice",
      "Lovely Professional University",
    ],
    [
      "unknown portal",
      "https://unknown.example/outcome",
      "test-mark",
      "unknown.example",
    ],
  ])(
    "routes an empty-return-URL %s launch using the outgoing support credential",
    async (_label, outcome, token, name) => {
      const { api, http, prisma, authenticate } = make();
      const headers = await authenticate({
        returnUrl: "",
        grading: {
          lis_outcome_service_url: outcome,
          oauth_consumer_key: "private-consumer",
          lis_result_sourcedid: "private-result",
        },
      });
      expect(headers["user-session"]).not.toContain("private-");
      const result = await request(api)
        .post("/api/v1/reports")
        .set(headers as Record<string, string>)
        .send({
          issueType: "technical",
          description: "Submission fails",
          portalName: "Forged Portal",
          portal: { portalHost: "forged.example" },
        })
        .expect(200);
      expect(result.body.message).toContain("SUPPORT-719");
      expect(prisma.report.create).toHaveBeenCalledTimes(1);
      const tickets = http.post.mock.calls.filter(([url]) =>
        url.endsWith("/tickets"),
      );
      expect(tickets).toEqual([
        [
          "https://support.example/api/external/v2/tickets",
          expect.objectContaining({
            reporterOrigin: name,
            metadata: expect.objectContaining({ portalName: name }),
          }),
          expect.objectContaining({
            headers: { Authorization: `Bearer ${token}` },
          }),
        ],
      ]);
      expect(JSON.stringify(tickets[0][1])).not.toContain("/outcome");
      expect(
        (tickets[0][1] as { metadata: object }).metadata,
      ).not.toHaveProperty("portalUrl");
      const session = await request(api)
        .get("/api/v1/user-session")
        .set(headers as Record<string, string>)
        .expect(200);
      expect(session.body.lmsHost).toBe(new URL(outcome).hostname);
      expect(session.body).not.toHaveProperty("lisOutcomeServiceUrl");
      expect(session.body).not.toHaveProperty("outcomeServiceUrl");
    },
  );

  it.each([
    [
      "top-level claim",
      { lis_outcome_service_url: COURSERA_OUTCOME },
      "test-coursera",
    ],
    [
      "return URL precedence",
      {
        returnUrl: "https://courses.edx.org/course",
        grading: { lis_outcome_service_url: COURSERA_OUTCOME },
      },
      "test-edx",
    ],
    ["ungraded launch", {}, "test-mark"],
    [
      "non-string callback",
      { grading: { lis_outcome_service_url: 42 } },
      "test-mark",
    ],
    [
      "Unicode callback",
      { grading: { lis_outcome_service_url: "https://api.coursera.org/ş" } },
      "test-mark",
    ],
    [
      "malformed callback",
      { grading: { lis_outcome_service_url: "http://[::1" } },
      "test-mark",
    ],
  ])("submits a report for %s", async (_label, claims, token) => {
    const { api, http, authenticate } = make();
    const headers = await authenticate(claims);
    await request(api)
      .post("/api/v1/reports")
      .set(headers as Record<string, string>)
      .send({
        issueType: "technical",
        description: "Submission fails",
      })
      .expect(200);
    expect(http.post).toHaveBeenCalledWith(
      "https://support.example/api/external/v2/tickets",
      expect.anything(),
      expect.objectContaining({
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  });

  it("rejects a forged launch before deriving a session", async () => {
    const { authenticate, http } = make();
    await expect(
      authenticate(
        { grading: { lis_outcome_service_url: COURSERA_OUTCOME } },
        "wrong-key",
      ),
    ).rejects.toThrow("Authentication failed");
    expect(http.post).not.toHaveBeenCalled();
  });
});
