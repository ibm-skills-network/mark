/** @jest-environment node */
import { GET } from "../route";

jest.mock("@/config/constants", () => ({
  getBaseApiPath: () => "https://api.internal/api/v1",
}));

const callback = "https://mark.staging.skills.network/api/github/callback";
const request = (
  query = "code=test-code&state=signed-state",
  cookie: string | null = "authentication=session",
) =>
  new Request(`${callback}?${query}`, {
    headers: cookie ? { cookie, "user-session": "forged" } : {},
  });
let upstream: jest.SpyInstance;
beforeEach(() => {
  upstream = jest.spyOn(globalThis, "fetch");
});
afterEach(() => jest.restoreAllMocks());

it("completes the exchange server-side and redirects with no credentials", async () => {
  upstream.mockResolvedValue(
    Response.json({
      returnPath: "/learner/42/questions?lang=fr&github_auth=success",
    }),
  );
  const response = await GET(request());
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "/learner/42/questions?lang=fr&github_auth=success",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(upstream).toHaveBeenCalledWith(
    "https://api.internal/api/v1/github/oauth-complete",
    expect.objectContaining({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "authentication=session",
      },
      body: JSON.stringify({ state: "signed-state", code: "test-code" }),
      cache: "no-store",
      redirect: "error",
    }),
  );
});

it("forwards cancellation for state verification and returns to the original page", async () => {
  upstream.mockResolvedValue(
    Response.json({
      returnPath: "/learner/42/successPage/99?github_auth=access_denied",
    }),
  );
  const response = await GET(request("state=signed-state&error=access_denied"));
  expect(response.status).toBe(303);
  expect(JSON.parse(upstream.mock.calls[0][1].body)).toEqual({
    state: "signed-state",
    error: "access_denied",
  });
});

it.each([
  "code=test-code",
  "state=signed-state",
  `state=${"x".repeat(4097)}&code=c`,
])("rejects invalid input without an upstream call", async (query) => {
  expect((await GET(request(query))).status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
});

it("requires a session cookie", async () => {
  expect((await GET(request(undefined, null))).status).toBe(401);
  expect(upstream).not.toHaveBeenCalled();
});

it.each([401, 403, 400, 503])(
  "fails closed on API status %s",
  async (status) => {
    upstream.mockResolvedValue(
      Response.json({ error: "private upstream details" }, { status }),
    );
    const response = await GET(request());
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).not.toContain("private upstream details");
    expect(response.headers.get("cache-control")).toBe("no-store");
  },
);

it.each([
  "https://evil.example/learner/42/questions",
  "//evil.example/learner/42/questions",
  "/api/github/callback",
  "javascript:alert(1)",
])("refuses unsafe upstream destination %s", async (returnPath) => {
  upstream.mockResolvedValue(Response.json({ returnPath }));
  expect((await GET(request())).status).toBe(502);
});

it("does not retry a failed exchange", async () => {
  upstream.mockRejectedValue(new Error("timeout"));
  expect((await GET(request())).status).toBe(503);
  expect(upstream).toHaveBeenCalledTimes(1);
});
