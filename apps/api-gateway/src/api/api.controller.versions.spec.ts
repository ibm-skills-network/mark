import { INestApplication, VersioningType } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as request from "supertest";
import type { UserSessionRequest } from "../auth/interfaces/user.session.interface";
import { DynamicJwtBearerTokenAuthGuard } from "../auth/jwt/bearer-token-based/dynamic.jwt.bearer.token.auth.guard";
import { DynamicJwtCookieAuthGuard } from "../auth/jwt/cookie-based/dynamic.jwt.cookie.auth.guard";
import { ApiController, DownstreamService } from "./api.controller";
import { ApiService } from "./api.service";

// Contract: /api/v3 goes through the same routes and auth guards as v1 and
// v2 and is forwarded to mark-api with its path unchanged; other versions
// are not routed.
describe("gateway API versions", () => {
  let app: INestApplication;
  const forwarded: Array<{ service: DownstreamService; url: string }> = [];
  const guardCalls: string[] = [];

  const guard = (name: string) => ({
    canActivate: (context: {
      switchToHttp: () => { getRequest: () => UserSessionRequest };
    }) => {
      guardCalls.push(name);
      return (
        context.switchToHttp().getRequest().headers["x-test-deny"] === undefined
      );
    },
  });

  beforeAll(async () => {
    const moduleReference = await Test.createTestingModule({
      controllers: [ApiController],
      providers: [
        {
          provide: ApiService,
          useValue: {
            rootV1: () => ({ ok: true }),
            forwardRequestToDownstreamService: (
              service: DownstreamService,
              incoming: UserSessionRequest,
            ) => {
              forwarded.push({ service, url: incoming.originalUrl });
              return Promise.resolve({ status: 200, data: { ok: true } });
            },
          },
        },
      ],
    })
      .overrideGuard(DynamicJwtBearerTokenAuthGuard)
      .useValue(guard("bearer"))
      .overrideGuard(DynamicJwtCookieAuthGuard)
      .useValue(guard("cookie"))
      .compile();

    app = moduleReference.createNestApplication();
    app.setGlobalPrefix("api");
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    forwarded.length = 0;
    guardCalls.length = 0;
  });

  it("forwards a v3 learner route to mark-api behind the cookie guard", async () => {
    const response = await request(app.getHttpServer()).get(
      "/api/v3/attempts/7?x=1",
    );
    expect(response.status).toBe(200);
    expect(guardCalls).toEqual(["cookie"]);
    expect(forwarded).toEqual([
      { service: DownstreamService.MARK_API, url: "/api/v3/attempts/7?x=1" },
    ]);
  });

  it("forwards a v3 admin route behind the bearer guard", async () => {
    const response = await request(app.getHttpServer())
      .put("/api/v3/admin/grading-modes")
      .send({});
    expect(response.status).toBe(200);
    expect(guardCalls).toEqual(["bearer"]);
    expect(forwarded).toEqual([
      {
        service: DownstreamService.MARK_API,
        url: "/api/v3/admin/grading-modes",
      },
    ]);
  });

  it("does not forward when the guard refuses", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v3/admin/grading-modes")
      .set("x-test-deny", "1");
    expect(response.status).toBe(403);
    expect(forwarded).toEqual([]);
  });

  it.each(["/api/v4/attempts/7", "/api/attempts/7", "/v3/attempts/7"])(
    "does not route %s",
    async (path) => {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.status).toBe(404);
      expect(forwarded).toEqual([]);
    },
  );

  it("keeps v1 and v2 routed", async () => {
    for (const path of ["/api/v1/attempts/7", "/api/v2/attempts/7"]) {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.status).toBe(200);
    }
    expect(forwarded.map((entry) => entry.url)).toEqual([
      "/api/v1/attempts/7",
      "/api/v2/attempts/7",
    ]);
  });
});
