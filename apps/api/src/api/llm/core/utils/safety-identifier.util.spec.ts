import {
  hashSafetyIdentifier,
  safetyIdentifierKwargs,
} from "./safety-identifier.util";

describe("hashSafetyIdentifier", () => {
  it("returns a stable sha256 hex digest", () => {
    const a = hashSafetyIdentifier("learner@example.com");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSafetyIdentifier("learner@example.com")).toBe(a);
  });

  it("normalizes case and whitespace so the identifier is stable", () => {
    expect(hashSafetyIdentifier(" Learner@Example.com ")).toBe(
      hashSafetyIdentifier("learner@example.com"),
    );
  });

  it("never returns the raw input", () => {
    expect(hashSafetyIdentifier("learner@example.com")).not.toContain(
      "learner",
    );
  });
});

describe("safetyIdentifierKwargs", () => {
  it("builds the safety_identifier kwarg when set", () => {
    expect(safetyIdentifierKwargs({ safetyIdentifier: "abc123" })).toEqual({
      safety_identifier: "abc123",
    });
  });

  it("returns an empty object when unset", () => {
    expect(safetyIdentifierKwargs(undefined)).toEqual({});
    expect(safetyIdentifierKwargs({})).toEqual({});
  });
});
