/**
 * @jest-environment node
 */
import { POST } from "../route";
import { POST as POST_STREAM } from "../stream/route";

const SESSION_PATH = "/api/v1/user-session";
const TODAY_CHAT_PATH = "/chats/today";

const VALID_PAYLOAD = {
  userRole: "learner",
  userText: "What is the question asking for?",
  conversation: [],
};

interface ChatBody {
  error?: string;
  reply?: string;
  chatId?: string;
}

function buildRequest(options: {
  /** Identity the caller claims for itself. */
  sessionHeader?: string;
  /** Raw cookie header; `null` sends none. */
  cookieHeader?: string | null;
  body?: unknown;
}): Request {
  const headers = new Headers({ "Content-Type": "application/json" });

  if (options.sessionHeader) {
    headers.set("user-session", options.sessionHeader);
  }

  const cookieHeader =
    options.cookieHeader === undefined
      ? "authentication=a-session-token"
      : options.cookieHeader;
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  return new Request("https://mark.test/api/markChat", {
    method: "POST",
    headers,
    body: JSON.stringify(
      options.body === undefined ? VALID_PAYLOAD : options.body,
    ),
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface UpstreamOptions {
  /** Who the API says the cookie belongs to. `null` means "the API can't say". */
  userId?: string | null;
  /** Assignment the API scopes that session to. */
  assignmentId?: number;
  /** Status the API returns for the session lookup. */
  sessionStatus?: number;
  /** Session lookup fails at the network level. */
  sessionUnreachable?: boolean;
  /** Response the chat backend returns for `respond`. */
  respond?: () => Response;
}

function mockUpstream(options: UpstreamOptions = {}) {
  const {
    userId = "learner@example.test",
    assignmentId = 42,
    sessionStatus = 200,
    sessionUnreachable = false,
  } = options;

  const sessionCalls: RequestInit[] = [];
  const chatCalls: [string, RequestInit][] = [];

  const fetchMock = jest.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith(SESSION_PATH)) {
      sessionCalls.push(init ?? {});
      if (sessionUnreachable) {
        return Promise.reject(new Error("connect ECONNREFUSED"));
      }
      if (sessionStatus !== 200) {
        return Promise.resolve(
          jsonResponse({ error: "Unauthorized" }, sessionStatus),
        );
      }
      return Promise.resolve(
        jsonResponse(userId === null ? {} : { userId, assignmentId }),
      );
    }

    chatCalls.push([url, init ?? {}]);

    if (url.endsWith(TODAY_CHAT_PATH)) {
      return Promise.resolve(jsonResponse({ id: "chat-1" }));
    }

    return Promise.resolve(
      options.respond
        ? options.respond()
        : jsonResponse({ reply: "Here is a hint.", functionCalled: false }),
    );
  });

  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, sessionCalls, chatCalls };
}

function requestBody(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("POST /api/markChat", () => {
  let info: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    error = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses a caller who names themselves with a session header", async () => {
    const { chatCalls, sessionCalls } = mockUpstream();

    const response = await POST(
      buildRequest({
        sessionHeader: JSON.stringify({
          userId: "victim@example.test",
          assignmentId: 999,
        }),
        cookieHeader: null,
      }),
    );

    expect(response.status).toBe(401);
    expect(chatCalls).toHaveLength(0);
    expect(sessionCalls).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("refuses a request that carries no session", async () => {
    const { fetchMock } = mockUpstream();

    const response = await POST(buildRequest({ cookieHeader: null }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an empty session cookie", async () => {
    const { fetchMock } = mockUpstream();

    const response = await POST(
      buildRequest({ cookieHeader: "authentication=" }),
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a session cookie the API does not recognise", async () => {
    const { chatCalls, sessionCalls } = mockUpstream({ sessionStatus: 401 });

    const response = await POST(
      buildRequest({ cookieHeader: "authentication=forged-by-attacker" }),
    );

    expect(response.status).toBe(401);
    expect(sessionCalls).toHaveLength(1);
    expect(chatCalls).toHaveLength(0);
  });

  it("refuses a session the API cannot attribute to a user", async () => {
    const { chatCalls } = mockUpstream({ userId: null });

    const response = await POST(buildRequest({}));

    expect(response.status).toBe(401);
    expect(chatCalls).toHaveLength(0);
  });

  it("fails closed when the session cannot be checked", async () => {
    const { chatCalls } = mockUpstream({ sessionUnreachable: true });

    const response = await POST(buildRequest({}));
    const body = (await response.json()) as ChatBody;

    expect(response.status).toBe(503);
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    expect(chatCalls).toHaveLength(0);
    expect(error).toHaveBeenCalled();
  });

  it("answers a caller the API recognises", async () => {
    const { sessionCalls, chatCalls } = mockUpstream({
      userId: "verified@example.test",
      assignmentId: 42,
    });

    const response = await POST(
      buildRequest({
        cookieHeader: "other=1; authentication=a-session-token",
      }),
    );
    const body = (await response.json()) as ChatBody;

    expect(response.status).toBe(200);
    expect(body.reply).toBe("Here is a hint.");
    expect(body.chatId).toBe("chat-1");
    expect(sessionCalls).toHaveLength(1);
    expect(new Headers(sessionCalls[0].headers).get("cookie")).toBe(
      "other=1; authentication=a-session-token",
    );
    expect(chatCalls).toHaveLength(2);
  });

  it("identifies the chat by the verified session, never by the request", async () => {
    const { chatCalls } = mockUpstream({
      userId: "verified@example.test",
      assignmentId: 42,
    });

    const response = await POST(
      buildRequest({
        sessionHeader: JSON.stringify({
          userId: "victim@example.test",
          assignmentId: 999,
        }),
        cookieHeader: "authentication=a-session-token",
      }),
    );

    // A caller who sends both must not be able to steer the identity.
    expect(response.status).toBe(401);
    expect(chatCalls).toHaveLength(0);
  });

  it("takes the user and assignment from the API, not from the payload", async () => {
    const { chatCalls } = mockUpstream({
      userId: "verified@example.test",
      assignmentId: 42,
    });

    await POST(
      buildRequest({
        body: {
          ...VALID_PAYLOAD,
          userId: "victim@example.test",
          assignmentId: 999,
        },
      }),
    );

    const [, todayInit] = chatCalls[0];
    expect(requestBody(todayInit)).toEqual({
      userId: "verified@example.test",
      assignmentId: 42,
    });
  });

  it("never forwards a caller-supplied identity header downstream", async () => {
    const { chatCalls } = mockUpstream({ userId: "verified@example.test" });

    await POST(
      buildRequest({ cookieHeader: "authentication=a-session-token" }),
    );

    for (const [, init] of chatCalls) {
      const headers = new Headers(init.headers);
      expect(headers.get("user-session")).toBeNull();
      expect(headers.get("cookie")).toBe("authentication=a-session-token");
    }
  });

  it("passes the conversation through to the chat backend unchanged", async () => {
    const conversation = [
      { id: "1", role: "user", content: "hello" },
      { id: "2", role: "assistant", content: "hi" },
    ];
    const { chatCalls } = mockUpstream({ userId: "verified@example.test" });

    await POST(
      buildRequest({
        body: { userRole: "author", userText: "add a rubric", conversation },
      }),
    );

    const [respondUrl, respondInit] = chatCalls[1];
    expect(respondUrl).toContain("/chats/chat-1/respond");
    expect(requestBody(respondInit)).toEqual({
      userRole: "author",
      userText: "add a rubric",
      conversation,
    });
  });

  it("reports a chat backend failure as a bad gateway", async () => {
    mockUpstream({
      userId: "verified@example.test",
      respond: () => jsonResponse({ message: "model unavailable" }, 500),
    });

    const response = await POST(buildRequest({}));
    const body = (await response.json()) as ChatBody;

    expect(response.status).toBe(502);
    expect(body.error).toBeDefined();
    expect(JSON.stringify(body)).not.toContain("model unavailable");
  });

  it("refuses an incomplete payload from an identified caller", async () => {
    const { chatCalls } = mockUpstream({ userId: "verified@example.test" });

    const response = await POST(
      buildRequest({ body: { userRole: "learner" } }),
    );

    expect(response.status).toBe(400);
    expect(chatCalls).toHaveLength(0);
  });

  it("refuses a role it does not recognise", async () => {
    const { chatCalls } = mockUpstream({ userId: "verified@example.test" });

    const response = await POST(
      buildRequest({ body: { ...VALID_PAYLOAD, userRole: "admin" } }),
    );

    expect(response.status).toBe(400);
    expect(chatCalls).toHaveLength(0);
  });

  it("refuses an unreadable payload without naming the parse failure", async () => {
    mockUpstream({ userId: "verified@example.test" });

    const response = await POST(
      new Request("https://mark.test/api/markChat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: "authentication=a-session-token",
        },
        body: "{not json",
      }),
    );
    const body = (await response.json()) as ChatBody;

    expect(response.status).toBe(400);
    expect(JSON.stringify(body)).not.toMatch(/JSON|token|position/i);
  });

  it("does not tell an unidentified caller whether its payload was valid", async () => {
    mockUpstream();

    const response = await POST(
      buildRequest({ cookieHeader: null, body: { nonsense: true } }),
    );

    expect(response.status).toBe(401);
  });

  it("stops a caller who floods the chat endpoint", async () => {
    mockUpstream({ userId: "flooder@example.test" });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 65; attempt++) {
      const response = await POST(buildRequest({}));
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
    expect(statuses.filter((status) => status === 200).length).toBeLessThan(65);
  });

  it("counts a flood against the caller even when the cookie value changes", async () => {
    mockUpstream({ userId: "cookie-rotator@example.test" });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 65; attempt++) {
      const response = await POST(
        // A hostile caller rotates the opaque cookie value on every request.
        buildRequest({ cookieHeader: `authentication=rotated-${attempt}` }),
      );
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
  });

  it("keeps one caller's flood from blocking another", async () => {
    mockUpstream({ userId: "noisy@example.test" });
    for (let attempt = 0; attempt < 65; attempt++) {
      await POST(buildRequest({}));
    }

    mockUpstream({ userId: "quiet@example.test" });
    const response = await POST(buildRequest({}));

    expect(response.status).toBe(200);
  });

  it("never reports the caller's identity in its logs", async () => {
    mockUpstream({ userId: "learner.name@example.test" });

    await POST(
      buildRequest({ cookieHeader: "authentication=secret-token-value" }),
    );

    const logged = JSON.stringify([
      ...info.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls,
    ]);
    expect(logged).not.toContain("learner.name@example.test");
    expect(logged).not.toContain("secret-token-value");
  });
});

describe("POST /api/markChat/stream", () => {
  beforeEach(() => {
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses a caller who names themselves with a session header", async () => {
    const { chatCalls, sessionCalls } = mockUpstream();

    const response = await POST_STREAM(
      buildRequest({
        sessionHeader: JSON.stringify({ userId: "victim@example.test" }),
        cookieHeader: null,
      }),
    );

    expect(response.status).toBe(401);
    expect(chatCalls).toHaveLength(0);
    expect(sessionCalls).toHaveLength(0);
  });

  it("refuses a request that carries no session", async () => {
    const { fetchMock } = mockUpstream();

    const response = await POST_STREAM(buildRequest({ cookieHeader: null }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the session cannot be checked", async () => {
    const { chatCalls } = mockUpstream({ sessionUnreachable: true });

    const response = await POST_STREAM(buildRequest({}));

    expect(response.status).toBe(503);
    expect(chatCalls).toHaveLength(0);
  });

  it("streams the backend response to an identified caller", async () => {
    const { chatCalls } = mockUpstream({
      userId: "stream@example.test",
      respond: () =>
        new Response("chunk-one chunk-two", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    });

    const response = await POST_STREAM(
      buildRequest({ cookieHeader: "authentication=a-session-token" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Chat-ID")).toBe("chat-1");
    expect(await response.text()).toBe("chunk-one chunk-two");

    const [respondUrl, respondInit] = chatCalls[1];
    expect(respondUrl).toContain("/chats/chat-1/respond-stream");
    expect(new Headers(respondInit.headers).get("user-session")).toBeNull();
  });

  it("shares the request budget with the non-streaming route", async () => {
    mockUpstream({ userId: "both-routes@example.test" });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 65; attempt++) {
      const route = attempt % 2 === 0 ? POST : POST_STREAM;
      const response = await route(buildRequest({}));
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
  });
});
