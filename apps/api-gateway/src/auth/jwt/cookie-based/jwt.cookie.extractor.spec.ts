import {
  dedupeAuthenticationCookieHeader,
  selectAuthenticationCookie,
} from "./jwt.cookie.extractor";

/** Build a JWT-shaped token whose payload decodes to the given iat. */
const makeToken = (iat: number, marker = "h"): string =>
  `${marker}.${Buffer.from(JSON.stringify({ iat })).toString("base64url")}.s`;

type RequestLike = Parameters<typeof selectAuthenticationCookie>[0];

const requestWith = (
  cookieHeader?: string,
  parsedCookies?: Record<string, string>,
): RequestLike =>
  ({
    headers: cookieHeader === undefined ? {} : { cookie: cookieHeader },
    cookies: parsedCookies,
  }) as RequestLike;

describe("selectAuthenticationCookie", () => {
  it("returns no token when neither the raw header nor parsed cookies exist", () => {
    const result = selectAuthenticationCookie(requestWith());

    expect(result.token).toBeUndefined();
    expect(result.candidateCount).toBe(0);
  });

  it("falls back to the parsed cookie when the raw header is absent", () => {
    const token = makeToken(1000);
    const result = selectAuthenticationCookie(
      requestWith(undefined, { authentication: token }),
    );

    expect(result.token).toBe(token);
    expect(result.candidateCount).toBe(1);
  });

  it("returns the single authentication cookie from the raw header", () => {
    const token = makeToken(1000);
    const result = selectAuthenticationCookie(
      requestWith(`other=x; authentication=${token}; another=y`),
    );

    expect(result.token).toBe(token);
    expect(result.candidateCount).toBe(1);
  });

  it("prefers the newest iat when duplicates exist and the newest is first", () => {
    const newer = makeToken(2000, "new");
    const older = makeToken(1000, "old");
    const result = selectAuthenticationCookie(
      requestWith(`authentication=${newer}; authentication=${older}`),
    );

    expect(result.token).toBe(newer);
    expect(result.candidateCount).toBe(2);
  });

  it("prefers the newest iat when duplicates exist and the newest is second (browser sends oldest first)", () => {
    const newer = makeToken(2000, "new");
    const older = makeToken(1000, "old");
    const result = selectAuthenticationCookie(
      requestWith(`authentication=${older}; authentication=${newer}`),
    );

    expect(result.token).toBe(newer);
    expect(result.candidateCount).toBe(2);
  });

  it("prefers a decodable token over an undecodable one regardless of order", () => {
    const valid = makeToken(1000);
    const result = selectAuthenticationCookie(
      requestWith(`authentication=garbage; authentication=${valid}`),
    );

    expect(result.token).toBe(valid);
    expect(result.candidateCount).toBe(2);
  });

  it("returns the first cookie when none decode (legacy behavior)", () => {
    const result = selectAuthenticationCookie(
      requestWith(
        `authentication=first-garbage; authentication=second-garbage`,
      ),
    );

    expect(result.token).toBe("first-garbage");
    expect(result.candidateCount).toBe(2);
  });

  it("decodes URL-encoded cookie values like cookie-parser does", () => {
    const token = makeToken(1000);
    const encoded = encodeURIComponent(token);
    const result = selectAuthenticationCookie(
      requestWith(`authentication=${encoded}`),
    );

    expect(result.token).toBe(token);
  });

  it("ignores cookies whose name merely ends with authentication", () => {
    const decoy = makeToken(9000, "decoy");
    const real = makeToken(1000, "real");
    const result = selectAuthenticationCookie(
      requestWith(`preauthentication=${decoy}; authentication=${real}`),
    );

    expect(result.token).toBe(real);
    expect(result.candidateCount).toBe(1);
  });
});

describe("dedupeAuthenticationCookieHeader", () => {
  it("returns undefined when the header has no authentication cookie", () => {
    expect(dedupeAuthenticationCookieHeader("other=x; session=y")).toBe(
      undefined,
    );
  });

  it("returns undefined when exactly one authentication cookie is present", () => {
    const token = makeToken(1000);
    expect(
      dedupeAuthenticationCookieHeader(`other=x; authentication=${token}`),
    ).toBe(undefined);
  });

  it("returns undefined for an undefined header", () => {
    expect(dedupeAuthenticationCookieHeader()).toBe(undefined);
  });

  it("rebuilds the header with only the newest-iat authentication cookie, preserving other cookies", () => {
    const older = makeToken(1000, "old");
    const newer = makeToken(2000, "new");
    const rebuilt = dedupeAuthenticationCookieHeader(
      `other=x; authentication=${older}; theme=dark; authentication=${newer}`,
    );

    expect(rebuilt).toBe(`other=x; theme=dark; authentication=${newer}`);
  });

  it("keeps the first authentication cookie when none decode (legacy behavior)", () => {
    const rebuilt = dedupeAuthenticationCookieHeader(
      "authentication=first-garbage; authentication=second-garbage",
    );

    expect(rebuilt).toBe("authentication=first-garbage");
  });
});
