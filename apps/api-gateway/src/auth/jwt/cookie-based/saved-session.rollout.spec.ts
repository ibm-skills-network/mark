import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { INestApplication, Logger, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import * as cookieParser from "cookie-parser";
import { sign } from "jsonwebtoken";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import * as request from "supertest";
import { ApiController } from "../../../api/api.controller";
import { ApiService } from "../../../api/api.service";
import { MessagingService } from "../../../messaging/messaging.service";
import { DynamicJwtBearerTokenAuthGuard } from "../bearer-token-based/dynamic.jwt.bearer.token.auth.guard";
import { JwtBearerTokenAuthGuard } from "../bearer-token-based/jwt.bearer.token.auth.guard";
import { MockJwtBearerTokenAuthGuard } from "../bearer-token-based/mock.jwt.bearer.token.auth.guard";
import { JwtConfigService } from "../jwt.config.service";
import { DynamicJwtCookieAuthGuard } from "./dynamic.jwt.cookie.auth.guard";
import { JwtCookieAuthGuard } from "./jwt.cookie.auth.guard";
import { JwtCookieStrategy } from "./jwt.cookie.strategy";
import { MockJwtCookieAuthGuard } from "./mock.jwt.cookie.auth.guard";
import { SavedSessionStore } from "./saved-session.store";

const QUEUE_SECRET = "rollout-queue-secret"; // pragma: allowlist secret
const SECRET = new JwtConfigService().jwtConstants.secret; // pragma: allowlist secret
const quizA = { "x-mark-learner-assignment": "4892" };
const quizB = { "x-mark-learner-assignment": "4941" };
const STORE_ID = "7f0c6c1e-3c1a-4c55-9a8e-2b8f6f1d0a11";

const logger = {
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
};

const now = Math.floor(Date.now() / 1000);
const sessionToken = (
  role: "author" | "learner",
  assignmentID: number,
  iat: number,
  padding = "",
) =>
  sign(
    {
      userID: "learner@example.test",
      role,
      assignmentID,
      groupID: "course-group",
      gradingCallbackRequired: true,
      iat,
      ...(padding ? { courseTitle: padding } : {}),
    },
    SECRET,
    { expiresIn: "6h" },
  );
const learner = (assignmentID: number, iat: number, padding = "") =>
  sessionToken("learner", assignmentID, iat, padding);

/** Per-quiz cookies a browser could still hold from before this change. */
const oldCookies = [
  `mark_learner_4892=${learner(4892, now - 600, "x".repeat(1100))}`,
  `mark_learner_5001=${learner(5001, now - 700, "x".repeat(1100))}`,
  `mark_author_5002=${learner(5002, now - 800, "x".repeat(1100))}`,
  `mark_author_5003=${learner(5003, now - 900, "x".repeat(1100))}`,
];
const oldCookieNames = oldCookies.map((cookie) => cookie.split("=")[0]);

describe("existing browsers after saved sessions move server-side", () => {
  let app: INestApplication;
  let markApi: Server;
  let store: SavedSessionStore;
  let saveCalls: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let storeStatus: number;
  let lookupHangs: boolean;
  let saveHangs: boolean;
  const saved = new Map<string, string>();
  const forwarded: { cookie?: string; session: Record<string, unknown> }[] = [];
  const environment = { ...process.env };

  // Stands in for mark-api: the internal saved-session API plus any forwarded call.
  const handle = (
    method: string | undefined,
    url: string | undefined,
    headers: Record<string, string | string[] | undefined>,
    body: string,
  ): [number, string?] => {
    if (!url?.startsWith("/api/internal/saved-sessions")) {
      forwarded.push({
        cookie: headers.cookie as string | undefined,
        session: JSON.parse(String(headers["user-session"])) as Record<
          string,
          unknown
        >,
      });
      return [200, "{}"];
    }
    if (headers["x-job-queue-secret"] !== QUEUE_SECRET) return [403];
    if (storeStatus !== 200) return [storeStatus];
    const { storeId, role, assignmentId, token } = JSON.parse(body) as Record<
      string,
      string
    >;
    const key = `${storeId}:${role}:${assignmentId}`;
    if (method === "PUT") {
      saved.set(key, token);
      return [204];
    }
    // eslint-disable-next-line unicorn/no-null
    return [200, JSON.stringify({ token: saved.get(key) ?? null })];
  };

  const send = async (path: string, cookie: string, headers = {}) => {
    forwarded.length = 0;
    const response = await request(app.getHttpServer())
      .get(path)
      .set({ ...headers, Cookie: cookie });
    const setCookies =
      (response.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
    return {
      response,
      cleared: setCookies
        .filter((value) => value.includes("Expires=Thu, 01 Jan 1970"))
        .map((value) => value.split("=")[0])
        .sort(),
      storeCookie: setCookies.find((value) =>
        value.startsWith("mark_saved_sessions="),
      ),
    };
  };
  const forwardedAuthentication = () =>
    (forwarded[0]?.cookie ?? "")
      .split("; ")
      .filter((pair) => pair.startsWith("authentication="))
      .map((pair) => decodeURIComponent(pair.slice("authentication=".length)));

  beforeAll(async () => {
    markApi = createServer((incoming, outgoing) => {
      let body = "";
      incoming.on("data", (chunk: Buffer) => (body += chunk.toString()));
      incoming.on("end", () => {
        if (lookupHangs && incoming.url?.endsWith("/lookup")) return;
        if (saveHangs && incoming.method === "PUT") return;
        const [status, payload] = handle(
          incoming.method,
          incoming.url,
          incoming.headers,
          body,
        );
        outgoing.writeHead(status, { "content-type": "application/json" });
        outgoing.end(payload);
      });
    });
    await new Promise<void>((resolve) =>
      markApi.listen(0, "127.0.0.1", resolve),
    );
    const { port } = markApi.address() as AddressInfo;
    process.env.MARK_API_ENDPOINT = `http://127.0.0.1:${port}`;
    process.env.JOB_QUEUE_SECRET = QUEUE_SECRET; // pragma: allowlist secret
    delete process.env.AUTH_DISABLED;

    const moduleReference = await Test.createTestingModule({
      imports: [PassportModule.register({})],
      controllers: [ApiController],
      providers: [
        ApiService,
        ConfigService,
        JwtConfigService,
        JwtCookieStrategy,
        JwtCookieAuthGuard,
        MockJwtCookieAuthGuard,
        DynamicJwtCookieAuthGuard,
        JwtBearerTokenAuthGuard,
        MockJwtBearerTokenAuthGuard,
        DynamicJwtBearerTokenAuthGuard,
        SavedSessionStore,
        { provide: MessagingService, useValue: {} },
        { provide: WINSTON_MODULE_PROVIDER, useValue: logger },
      ],
    }).compile();
    store = moduleReference.get(SavedSessionStore);
    app = moduleReference.createNestApplication({ logger: false });
    app.setGlobalPrefix("api");
    app.enableVersioning({ type: VersioningType.URI });
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await new Promise((resolve) => markApi.close(resolve));
    process.env = { ...environment };
  });

  beforeEach(() => {
    saved.clear();
    forwarded.length = 0;
    storeStatus = 200;
    lookupHangs = false;
    saveHangs = false;
    warn = jest.spyOn(Logger.prototype, "warn").mockReturnValue();
    saveCalls = jest.spyOn(store, "save");
  });

  afterEach(() => jest.restoreAllMocks());

  it("logs in with a fresh launch while still carrying old per-quiz cookies", async () => {
    const launch = learner(4892, now);
    const cookie = [`authentication=${launch}`, ...oldCookies, "theme=dark"];
    expect(Buffer.byteLength(cookie.join("; "))).toBeGreaterThan(6 * 1024);

    const { response, cleared, storeCookie } = await send(
      "/api/v2/assignments/4892/attempts",
      cookie.join("; "),
      quizA,
    );

    expect(response.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].session).toMatchObject({
      userId: "learner@example.test",
      role: "learner",
      assignmentId: 4892,
    });
    expect(forwarded[0].cookie).toBe(`theme=dark; authentication=${launch}`);
    expect(cleared).toEqual([...oldCookieNames].sort());
    expect(storeCookie).toMatch(
      /^mark_saved_sessions=[\da-f-]{36}; Max-Age=259200;.*HttpOnly; SameSite=Lax/,
    );
    expect([...saved.values()]).toEqual([launch]);
  });

  it("logs in on pages without quiz context and drops the old cookies", async () => {
    const findCalls = jest.spyOn(store, "find");
    const { response, cleared, storeCookie } = await send(
      "/api/v1/user-session",
      [`authentication=${learner(4892, now)}`, ...oldCookies].join("; "),
    );

    expect(response.status).toBe(200);
    expect(forwarded[0].session).toMatchObject({ assignmentId: 4892 });
    expect(cleared).toEqual([...oldCookieNames].sort());
    expect(storeCookie).toBeUndefined();
    expect(findCalls).not.toHaveBeenCalled();
    expect(saveCalls).not.toHaveBeenCalled();
  });

  it("saves the first visit, then resumes the quiz after another launch", async () => {
    const launchA = learner(4892, now - 60);
    const first = await send(
      "/api/v2/assignments/4892/attempts",
      `authentication=${launchA}`,
      quizA,
    );
    const storeId =
      /^mark_saved_sessions=([^;]+)/.exec(first.storeCookie ?? "")?.[1] ?? "";
    expect(storeId).toMatch(/^[\da-f-]{36}$/);
    expect([...saved.values()]).toEqual([launchA]);

    await send(
      "/api/v2/assignments/4892/attempts",
      `authentication=${launchA}; mark_saved_sessions=${storeId}`,
      quizA,
    );
    expect([...saved.values()]).toEqual([launchA]);

    const launchB = learner(4941, now);
    const resumed = await send(
      "/api/v2/assignments/4892/attempts",
      `authentication=${launchB}; mark_saved_sessions=${storeId}`,
      quizA,
    );
    expect(resumed.response.status).toBe(200);
    expect(forwarded[0].session).toMatchObject({ assignmentId: 4892 });
    expect(forwardedAuthentication()).toEqual([launchA]);

    const current = await send(
      "/api/v2/assignments/4941/attempts",
      `authentication=${launchB}; mark_saved_sessions=${storeId}`,
      quizB,
    );
    expect(current.response.status).toBe(200);
    expect(forwardedAuthentication()).toEqual([launchB]);
  });

  it("resumes a quiz visited only once before another launch", async () => {
    const launchA = learner(4892, now - 60);
    const first = await send(
      "/api/v1/user-session",
      `authentication=${launchA}`,
      quizA,
    );
    const storeId =
      /^mark_saved_sessions=([^;]+)/.exec(first.storeCookie ?? "")?.[1] ?? "";
    expect(first.response.status).toBe(200);

    const resumed = await send(
      "/api/v2/assignments/4892/attempts",
      `authentication=${learner(4941, now)}; mark_saved_sessions=${storeId}`,
      quizA,
    );

    expect(resumed.response.status).toBe(200);
    expect(forwarded[0].session).toMatchObject({ assignmentId: 4892 });
    expect(forwardedAuthentication()).toEqual([launchA]);
  });

  it("asks for a relaunch, not an error, when a quiz was only saved in an old cookie", async () => {
    const quizAOnlyInOldCookie = [
      `authentication=${learner(4941, now - 60)}`,
      ...oldCookies,
    ].join("; ");

    const stale = await send(
      "/api/v2/assignments/4892/attempts",
      quizAOnlyInOldCookie,
      quizA,
    );
    expect(stale.response.status).toBe(401);
    expect(stale.response.body).toMatchObject({
      message: "Relaunch this quiz in the requested role",
    });
    expect(forwarded).toHaveLength(0);

    const relaunched = await send(
      "/api/v2/assignments/4892/attempts",
      [`authentication=${learner(4892, now)}`, ...oldCookies].join("; "),
      quizA,
    );
    expect(relaunched.response.status).toBe(200);
    expect(relaunched.cleared).toEqual([...oldCookieNames].sort());
  });

  it("keeps logging in from the current session when the store is down", async () => {
    storeStatus = 500;
    const storeId = "7f0c6c1e-3c1a-4c55-9a8e-2b8f6f1d0a11";
    const launch = learner(4892, now);

    const { response } = await send(
      "/api/v2/assignments/4892/attempts",
      `authentication=${launch}; mark_saved_sessions=${storeId}`,
      quizA,
    );

    expect(response.status).toBe(200);
    expect(forwardedAuthentication()).toEqual([launch]);
    expect(saveCalls).toHaveBeenCalledTimes(1);
    expect(saved.size).toBe(0);
  });

  it("stops waiting for a store that never answers and uses the current session", async () => {
    lookupHangs = true;
    const launch = learner(4892, now);
    const started = Date.now();

    const { response } = await send(
      "/api/v2/assignments/4892/attempts",
      `authentication=${launch}; mark_saved_sessions=${STORE_ID}`,
      quizA,
    );

    expect(Date.now() - started).toBeLessThan(2500);
    expect(response.status).toBe(200);
    expect(forwardedAuthentication()).toEqual([launch]);
    expect(warn).toHaveBeenCalledWith(
      "Saved session lookup failed (ECONNABORTED)",
    );
  });

  it("keeps the first visit available when the session save times out", async () => {
    saveHangs = true;
    const launch = learner(4892, now);
    const started = Date.now();

    const { response, storeCookie } = await send(
      "/api/v2/assignments/4892/attempts",
      `authentication=${launch}`,
      quizA,
    );

    expect(Date.now() - started).toBeLessThan(2500);
    expect(response.status).toBe(200);
    expect(storeCookie).toBeDefined();
    expect(forwardedAuthentication()).toEqual([launch]);
    expect(warn).toHaveBeenCalledWith(
      "Saved session save failed (ECONNABORTED)",
    );
  });

  it.each([
    [
      "grading",
      "/api/v1/assignments/4892/attempts/1/grading/2/status-stream",
      "https://mark.example/learner/4892",
      "learner",
    ],
    [
      "publish",
      "/api/v1/assignments/jobs/77/status-stream",
      "https://mark.example/author/4892/questions",
      "author",
    ],
  ] as const)(
    "resumes the %s status stream from the referer alone",
    async (_name, path, referer, role) => {
      const resumed = sessionToken(role, 4892, now - 60);
      saved.set(`${STORE_ID}:${role}:4892`, resumed);

      const { response } = await send(
        path,
        `authentication=${learner(4941, now)}; mark_saved_sessions=${STORE_ID}`,
        { Referer: referer, Accept: "text/event-stream" },
      );

      expect(response.status).toBe(200);
      expect(forwarded[0].session).toMatchObject({ role, assignmentId: 4892 });
      expect(forwardedAuthentication()).toEqual([resumed]);
    },
  );

  it("logs in past a prefixed cookie whose name cannot be cleared", async () => {
    const { response, cleared } = await send(
      "/api/v1/user-session",
      [
        `authentication=${learner(4892, now)}`,
        "mark_author_1[x]=planted",
        oldCookies[1],
      ].join("; "),
    );

    expect(response.status).toBe(200);
    expect(cleared).toEqual(["mark_learner_5001"]);
  });
});
