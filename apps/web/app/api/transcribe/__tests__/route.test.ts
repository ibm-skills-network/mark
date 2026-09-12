/**
 * @jest-environment node
 */
import { POST } from "../route";

const ORIGINAL_KEY = process.env.OPENAI_API_SPEECH_TEXT_KEY;

interface TranscriptionBody {
  error?: string;
  details?: string;
  text?: string;
}

function buildRequest(options: {
  session?: string | null;
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
  if (session) {
    headers.set("cookie", `authentication=${session}`);
  }

  return new Request("https://mark.test/api/transcribe", {
    method: "POST",
    body: formData,
    headers,
  });
}

function mockOpenAi(response: Response) {
  const fetchMock = jest.fn().mockResolvedValue(response);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
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
    const fetchMock = mockOpenAi(new Response("{}", { status: 200 }));

    const response = await POST(buildRequest({ session: null }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("refuses a request without an audio file", async () => {
    const fetchMock = mockOpenAi(new Response("{}", { status: 200 }));

    const response = await POST(
      buildRequest({ session: "no-audio", audio: null }),
    );
    const body = (await response.json()) as TranscriptionBody;

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a recording that is too large to transcribe", async () => {
    const fetchMock = mockOpenAi(new Response("{}", { status: 200 }));
    const oversized = new Blob([new Uint8Array(26 * 1024 * 1024)], {
      type: "audio/wav",
    });

    const response = await POST(
      buildRequest({ session: "too-big", audio: oversized }),
    );

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("transcribes a recording and logs the request and its outcome", async () => {
    const fetchMock = mockOpenAi(
      new Response(
        JSON.stringify({
          text: "hello there",
          segments: [{ start: 0, end: 1 }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const response = await POST(buildRequest({ session: "happy-path" }));
    const body = (await response.json()) as TranscriptionBody;

    expect(response.status).toBe(200);
    expect(body.text).toBe("hello there");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
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
    mockOpenAi(
      new Response(
        "Incorrect API key provided: sk-secret. You can find your API key at ...",
        {
          status: 401,
        },
      ),
    );

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
    const fetchMock = mockOpenAi(new Response("{}", { status: 200 }));

    const response = await POST(buildRequest({ session: "no-key" }));
    const body = (await response.json()) as TranscriptionBody;

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/OPENAI|key/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it("stops a session that floods the transcription endpoint", async () => {
    mockOpenAi(
      new Response(JSON.stringify({ text: "ok", segments: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 25; attempt++) {
      const response = await POST(buildRequest({ session: "flooder" }));
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
    expect(statuses.filter((status) => status === 200).length).toBeLessThan(25);
  });
});
