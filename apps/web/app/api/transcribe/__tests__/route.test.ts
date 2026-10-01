/**
 * @jest-environment node
 */
import { POST } from "../route";

const ORIGINAL_KEY = process.env.OPENAI_API_SPEECH_TEXT_KEY;

const TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
const SESSION_PATH = "/api/v1/user-session";

interface TranscriptionBody {
  error?: string;
  details?: string;
  text?: string;
}

function buildRequest(options: {
  session?: string | null;
  cookieHeader?: string;
  audio?: Blob | string | null;
}): Request {
  const formData = new FormData();
  const { audio = new Blob([new Uint8Array(16)], { type: "audio/wav" }) } =
    options;
  if (audio !== null) {
    if (typeof audio === "string") {
      formData.append("audio", audio);
    } else {
      formData.append("audio", audio, "recording.wav");
    }
  }

  const headers = new Headers();
  const session =
    options.session === undefined ? "a-session-token" : options.session;
  if (options.cookieHeader) {
    headers.set("cookie", options.cookieHeader);
  } else if (session) {
    headers.set("cookie", `authentication=${session}`);
  }

  return new Request("https://mark.test/api/transcribe", {
    method: "POST",
    body: formData,
    headers,
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
  /** Status the API returns for the session lookup. */
  sessionStatus?: number;
  /** Session lookup fails at the network level. */
  sessionUnreachable?: boolean;
  /** Response the speech-to-text provider returns. */
  transcription?: () => Response;
}

function mockUpstream(options: UpstreamOptions = {}) {
  const {
    userId = "learner@example.test",
    sessionStatus = 200,
    sessionUnreachable = false,
  } = options;

  const sessionCalls: RequestInit[] = [];
  const transcriptionCalls: [string, RequestInit][] = [];

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
      return Promise.resolve(jsonResponse(userId === null ? {} : { userId }));
    }

    transcriptionCalls.push([url, init ?? {}]);
    return Promise.resolve(
      options.transcription
        ? options.transcription()
        : jsonResponse({ text: "ok", segments: [] }),
    );
  });

  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, sessionCalls, transcriptionCalls };
}

describe("POST /api/transcribe", () => {
  let info: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    process.env.OPENAI_API_SPEECH_TEXT_KEY = "test-key";
    info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    error = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.OPENAI_API_SPEECH_TEXT_KEY = ORIGINAL_KEY;
  });

  it("refuses a request that carries no session", async () => {
    const { fetchMock } = mockUpstream();

    const response = await POST(buildRequest({ session: null }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("refuses a session cookie the API does not recognise", async () => {
    const { transcriptionCalls, sessionCalls } = mockUpstream({
      sessionStatus: 401,
    });

    const response = await POST(
      buildRequest({ session: "forged-by-attacker" }),
    );
    const body = (await response.json()) as TranscriptionBody;

    expect(response.status).toBe(401);
    expect(body.error).toBeDefined();
    expect(sessionCalls).toHaveLength(1);
    expect(transcriptionCalls).toHaveLength(0);
  });

  it("refuses a session the API cannot attribute to a user", async () => {
    const { transcriptionCalls } = mockUpstream({ userId: null });

    const response = await POST(buildRequest({ session: "anonymous" }));

    expect(response.status).toBe(401);
    expect(transcriptionCalls).toHaveLength(0);
  });

  it("fails closed when the session cannot be checked", async () => {
    const { transcriptionCalls } = mockUpstream({ sessionUnreachable: true });

    const response = await POST(buildRequest({ session: "unverifiable" }));
    const body = (await response.json()) as TranscriptionBody;

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).not.toBe(200);
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    expect(transcriptionCalls).toHaveLength(0);
    expect(error).toHaveBeenCalled();
  });

  it("checks the session against the API before spending a transcription", async () => {
    const { fetchMock, sessionCalls, transcriptionCalls } = mockUpstream({
      userId: "verified@example.test",
    });

    const response = await POST(
      buildRequest({ cookieHeader: "other=1; authentication=a-session-token" }),
    );

    expect(response.status).toBe(200);
    expect(sessionCalls).toHaveLength(1);
    expect(new Headers(sessionCalls[0].headers).get("cookie")).toBe(
      "other=1; authentication=a-session-token",
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain(SESSION_PATH);
    expect(transcriptionCalls).toHaveLength(1);
  });

  it("never reports the session identity in its logs", async () => {
    mockUpstream({ userId: "learner.name@example.test" });

    await POST(buildRequest({ session: "identity-logging" }));

    const logged = JSON.stringify([
      ...info.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls,
    ]);
    expect(logged).not.toContain("learner.name@example.test");
  });

  it("refuses a request without an audio file", async () => {
    const { transcriptionCalls } = mockUpstream({
      userId: "no-audio@example.test",
    });

    const response = await POST(
      buildRequest({ session: "no-audio", audio: null }),
    );
    const body = (await response.json()) as TranscriptionBody;

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
    expect(transcriptionCalls).toHaveLength(0);
  });

  it("refuses a recording that is too large to transcribe", async () => {
    const { transcriptionCalls } = mockUpstream({
      userId: "too-big@example.test",
    });
    const oversized = new Blob([new Uint8Array(26 * 1024 * 1024)], {
      type: "audio/wav",
    });

    const response = await POST(
      buildRequest({ session: "too-big", audio: oversized }),
    );

    expect(response.status).toBe(413);
    expect(transcriptionCalls).toHaveLength(0);
  });

  it("transcribes a recording and logs the request and its outcome", async () => {
    const { transcriptionCalls } = mockUpstream({
      userId: "happy-path@example.test",
      transcription: () =>
        jsonResponse({ text: "hello there", segments: [{ start: 0, end: 1 }] }),
    });

    const response = await POST(buildRequest({ session: "happy-path" }));
    const body = (await response.json()) as TranscriptionBody;

    expect(response.status).toBe(200);
    expect(body.text).toBe("hello there");

    const [url, init] = transcriptionCalls[0];
    expect(url).toBe(TRANSCRIPTION_URL);
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer test-key",
    );

    const events = info.mock.calls.map((call) => call[0] as string);
    expect(events).toContain("transcribe.request.received");
    expect(events).toContain("transcribe.request.succeeded");

    // The transcript itself is learner content and must not be logged.
    expect(JSON.stringify(info.mock.calls)).not.toContain("hello there");
  });

  it("does not pass the upstream failure back to the browser", async () => {
    mockUpstream({
      userId: "upstream-failure@example.test",
      transcription: () =>
        new Response(
          "Incorrect API key provided: sk-secret. You can find your API key at ...",
          { status: 401 },
        ),
    });

    const response = await POST(buildRequest({ session: "upstream-failure" }));
    const body = (await response.json()) as TranscriptionBody;

    expect(response.status).toBe(502);
    expect(body.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    expect(error).toHaveBeenCalled();
    const loggedStatuses = error.mock.calls.map((call) =>
      JSON.stringify(call[1]),
    );
    expect(loggedStatuses.some((entry) => entry.includes("401"))).toBe(true);
  });

  it("reports a missing key as a server error without naming it", async () => {
    delete process.env.OPENAI_API_SPEECH_TEXT_KEY;
    const { transcriptionCalls } = mockUpstream({
      userId: "no-key@example.test",
    });

    const response = await POST(buildRequest({ session: "no-key" }));
    const body = (await response.json()) as TranscriptionBody;

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/OPENAI|key/i);
    expect(transcriptionCalls).toHaveLength(0);
    expect(error).toHaveBeenCalled();
  });

  it("stops a learner who floods the transcription endpoint", async () => {
    mockUpstream({ userId: "flooder@example.test" });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 25; attempt++) {
      const response = await POST(buildRequest({ session: "flooder" }));
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
    expect(statuses.filter((status) => status === 200).length).toBeLessThan(25);
  });

  it("counts a flood against the caller even when the cookie value changes", async () => {
    mockUpstream({ userId: "cookie-rotator@example.test" });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 25; attempt++) {
      const response = await POST(
        // A hostile caller rotates the opaque cookie value on every request.
        buildRequest({ session: `rotated-${attempt}-${Math.random()}` }),
      );
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
    expect(statuses.filter((status) => status === 200).length).toBeLessThan(25);
  });

  it("keeps one learner's flood from blocking another", async () => {
    mockUpstream({ userId: "noisy@example.test" });
    for (let attempt = 0; attempt < 25; attempt++) {
      await POST(buildRequest({ session: "noisy" }));
    }

    mockUpstream({ userId: "quiet@example.test" });
    const response = await POST(buildRequest({ session: "quiet" }));

    expect(response.status).toBe(200);
  });
});
