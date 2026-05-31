import { isNatsConnectionError } from "./process-error-guard";

describe("isNatsConnectionError", () => {
  it("matches a ts-nats error by name", () => {
    expect(isNatsConnectionError({ name: "NatsError", message: "x" })).toBe(
      true,
    );
  });

  it("matches the CONN_ERR code", () => {
    expect(isNatsConnectionError({ code: "CONN_ERR" })).toBe(true);
  });

  it("matches a chained EAI_AGAIN DNS failure", () => {
    expect(
      isNatsConnectionError({
        name: "NatsError",
        chainedError: { code: "EAI_AGAIN" },
      }),
    ).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isNatsConnectionError(new TypeError("boom"))).toBe(false);
    expect(isNatsConnectionError({ code: "ECONNREFUSED" })).toBe(false);
  });

  it("is safe on null / undefined / primitives", () => {
    // These nullish values intentionally exercise the predicate's optional
    // chaining; they reach it in production as `unknown` error payloads.
    // eslint-disable-next-line unicorn/no-null
    expect(isNatsConnectionError(null)).toBe(false);
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(isNatsConnectionError(undefined)).toBe(false);
    expect(isNatsConnectionError("nope")).toBe(false);
  });
});
