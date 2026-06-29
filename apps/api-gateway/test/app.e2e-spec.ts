import { INestApplication, VersioningType } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import * as cookieParser from "cookie-parser";
import * as request from "supertest";
import axios from "axios";
import { AppModule } from "./../src/app.module";

jest.mock("axios");

const MARK_API_ENDPOINT = "http://localhost:9999";

describe("Gateway routing (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.SECRET = "test-secret"; //pragma: allowlist secret
    process.env.MARK_API_ENDPOINT = MARK_API_ENDPOINT;
    // Force the real cookie guard — without this the dev AUTH_DISABLED=true
    // mock guard lets every request through and the 401 test can never pass.
    process.env.AUTH_DISABLED = "false";

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api", {
      exclude: ["health", "health/liveness", "health/readiness"],
    });
    app.enableVersioning({ type: VersioningType.URI });
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("POST /api/v1/auth/admin/override-session with no cookie returns 200 and sets authentication cookie", async () => {
    // Mock: AdminOverrideService.mintOverrideCookie calls axios.post to verify the session token
    // eslint-disable-next-line @typescript-eslint/unbound-method
    jest.mocked(axios.post).mockResolvedValue({
      data: { isAdmin: true, email: "admin@x.com" },
    });

    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/admin/override-session")
      .send({ sessionToken: "valid-admin-token" })
      .expect(200);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const rawCookies = response.headers["set-cookie"] ?? [];
    const cookies = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const authCookie = cookies.find((c: string) =>
      c.startsWith("authentication="),
    );
    expect(authCookie).toBeDefined();
    // Confirm the route reached AdminOverrideController (not the catch-all cookie-guard)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(jest.mocked(axios.post)).toHaveBeenCalledWith(
      expect.stringContaining("/auth/admin/me"),
      expect.objectContaining({ sessionToken: "valid-admin-token" }),
    );
  });

  it("POST /api/v1/auth/admin/send-code with no cookie reaches public passthrough (not cookie-guard rejection)", async () => {
    // Mock: forwardPublicRequestToMarkApi calls axios.request
    // eslint-disable-next-line @typescript-eslint/unbound-method
    jest
      .mocked(axios.request)
      .mockResolvedValue({ status: 200, data: { sent: true } });

    await request(app.getHttpServer())
      .post("/api/v1/auth/admin/send-code")
      .send({ email: "admin@x.com" })
      // Not 401 — the public passthrough has no cookie guard
      .expect((result) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(result.status).not.toBe(401);
      });

    // Verify axios.request was called with the correct downstream URL
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(jest.mocked(axios.request)).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        url: expect.stringContaining(`${MARK_API_ENDPOINT}`),
      }),
    );
  });

  it("GET /api/v1/something-not-public with no cookie returns 401 (catch-all cookie guard active)", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/something-not-public")
      .expect(401);
  });
});
