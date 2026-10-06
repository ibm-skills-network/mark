import { INestApplication, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import * as cookieParser from "cookie-parser";
import { verify } from "jsonwebtoken";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import * as request from "supertest";
import { JwtBearerTokenAuthGuard } from "../auth/jwt/bearer-token-based/jwt.bearer.token.auth.guard";
import { DynamicJwtBearerTokenAuthGuard } from "../auth/jwt/bearer-token-based/dynamic.jwt.bearer.token.auth.guard";
import { MockJwtBearerTokenAuthGuard } from "../auth/jwt/bearer-token-based/mock.jwt.bearer.token.auth.guard";
import { DynamicJwtCookieAuthGuard } from "../auth/jwt/cookie-based/dynamic.jwt.cookie.auth.guard";
import { JwtCookieAuthGuard } from "../auth/jwt/cookie-based/jwt.cookie.auth.guard";
import { JwtCookieStrategy } from "../auth/jwt/cookie-based/jwt.cookie.strategy";
import { MockJwtCookieAuthGuard } from "../auth/jwt/cookie-based/mock.jwt.cookie.auth.guard";
import { JwtConfigService } from "../auth/jwt/jwt.config.service";
import { MessagingService } from "../messaging/messaging.service";
import { AdminAssumeRoleController } from "./admin-assume-role.controller";
import { ApiController } from "./api.controller";
import { ApiService } from "./api.service";

jest.mock("axios", () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));
const mockedPost = jest.requireMock<{ default: { post: jest.Mock } }>("axios")
  .default.post;

const logger = {
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
};

const URL = "/api/v1/auth/admin/assume-role";

describe("AdminAssumeRoleController", () => {
  let app: INestApplication;
  const secret = new JwtConfigService().jwtConstants.secret; // pragma: allowlist secret

  beforeAll(async () => {
    process.env.MARK_API_ENDPOINT = "http://mark-api";
    const moduleReference = await Test.createTestingModule({
      imports: [PassportModule.register({})],
      // Same order as ApiModule: the catch-all must not shadow this route.
      controllers: [AdminAssumeRoleController, ApiController],
      providers: [
        ConfigService,
        JwtConfigService,
        JwtCookieStrategy,
        JwtCookieAuthGuard,
        MockJwtCookieAuthGuard,
        DynamicJwtCookieAuthGuard,
        JwtBearerTokenAuthGuard,
        MockJwtBearerTokenAuthGuard,
        DynamicJwtBearerTokenAuthGuard,
        { provide: ApiService, useValue: {} },
        { provide: MessagingService, useValue: {} },
        { provide: WINSTON_MODULE_PROVIDER, useValue: logger },
      ],
    }).compile();
    app = moduleReference.createNestApplication();
    app.setGlobalPrefix("api");
    app.enableVersioning({ type: VersioningType.URI });
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockedPost.mockReset();
  });

  it("issues a signed session cookie from mark-api's claims without a prior cookie", async () => {
    mockedPost.mockResolvedValue({
      status: 201,
      data: {
        userId: "admin@example.com",
        role: "author",
        assignmentId: 42,
        groupId: "course-a",
      },
    });

    const response = await request(app.getHttpServer())
      .post(URL)
      .set("x-admin-token", "admin-session")
      .send({ assignmentId: 42, role: "author" })
      .expect(200);

    const [url, sentBody, config] = mockedPost.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string> },
    ];
    expect(url).toBe("http://mark-api/api/v1/auth/admin/assume-role");
    expect(sentBody).toEqual({ assignmentId: 42, role: "author" });
    expect(config.headers["x-admin-token"]).toBe("admin-session");
    const setCookie = String(response.headers["set-cookie"] as unknown);
    const token = /authentication=([^;]+)/.exec(setCookie)?.[1];
    expect(setCookie).toContain("HttpOnly");
    expect(verify(decodeURIComponent(token ?? ""), secret)).toMatchObject({
      userID: "admin@example.com",
      role: "author",
      assignmentID: 42,
      groupID: "course-a",
      gradingCallbackRequired: false,
    });
  });

  it("rejects a request with no admin token before calling mark-api", async () => {
    await request(app.getHttpServer())
      .post(URL)
      .send({ assignmentId: 42, role: "learner" })
      .expect(401);
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it.each([
    { assignmentId: "42", role: "learner" },
    { assignmentId: -1, role: "learner" },
    { assignmentId: 42, role: "admin" },
  ])("rejects malformed body %j", async (body) => {
    await request(app.getHttpServer())
      .post(URL)
      .set("x-admin-token", "admin-session")
      .send(body)
      .expect(400);
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("passes a mark-api denial through without setting a cookie", async () => {
    mockedPost.mockResolvedValue({ status: 403, data: {} });
    const response = await request(app.getHttpServer())
      .post(URL)
      .set("x-admin-token", "not-an-admin")
      .send({ assignmentId: 42, role: "learner" })
      .expect(403);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("refuses to sign claims that do not match the request", async () => {
    mockedPost.mockResolvedValue({
      status: 201,
      data: {
        userId: "admin@example.com",
        role: "author",
        assignmentId: 42,
        groupId: "course-a",
      },
    });
    const response = await request(app.getHttpServer())
      .post(URL)
      .set("x-admin-token", "admin-session")
      .send({ assignmentId: 42, role: "learner" })
      .expect(502);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("leaves the catch-all proxy behind the cookie guard", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/admin/other")
      .set("x-admin-token", "admin-session")
      .expect(401);
  });
});
