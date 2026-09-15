import { getBaseApiPath } from "@/config/constants";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

function failed(status: number): Response {
  return new Response(
    "GitHub connection could not be completed. Reopen your assignment from your course and try connecting again.",
    {
      status,
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}

/** The only URL registered with GitHub, independent of assignment and language. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (
    !state ||
    state.length > 4096 ||
    (!code && !error) ||
    (code && code.length > 512) ||
    (error && error.length > 512)
  ) {
    return failed(400);
  }
  const cookie = request.headers.get("cookie");
  if (
    !cookie?.split(";").some((part) => /^authentication=.+/.test(part.trim()))
  ) {
    return failed(401);
  }

  try {
    // The API authenticates the cookie, verifies the signed return destination,
    // and persists the token. Never forward client-supplied identity headers.
    const response = await fetch(
      `${getBaseApiPath("v1")}/github/oauth-complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          state,
          code: code ?? undefined,
          error: error ?? undefined,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(45_000),
      },
    );
    if (!response.ok)
      return failed(
        response.status === 401 || response.status === 403 ? 401 : 400,
      );
    const body = (await response.json()) as { returnPath?: unknown };
    if (typeof body.returnPath !== "string") return failed(502);
    // Only a local learner page may receive the final redirect. Codes, state,
    // and tokens never accompany it, even if an upstream response is malformed.
    const target = new URL(body.returnPath, "https://mark.invalid");
    if (
      target.origin !== "https://mark.invalid" ||
      !/^\/learner\/\d+\/(?:questions|successPage(?:\/[^/]+)?)$/.test(
        target.pathname,
      )
    ) {
      return failed(502);
    }
    for (const key of ["code", "state", "access_token", "token"])
      target.searchParams.delete(key);
    return new Response(null, {
      status: 303,
      headers: {
        ...PRIVATE_HEADERS,
        Location: `${target.pathname}${target.search}${target.hash}`,
      },
    });
  } catch {
    // Do not log the request URL: it contains the single-use authorization code.
    return failed(503);
  }
}
