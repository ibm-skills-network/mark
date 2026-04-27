import { redactAuthSecrets } from "./redact";

describe("redactAuthSecrets", () => {
  it("redacts cookie values by key, case-insensitive", () => {
    expect(redactAuthSecrets('{"cookie":"abc"}')).toBe(
      '{"cookie":"[REDACTED]"}',
    );
    expect(redactAuthSecrets('{"Cookie":"abc"}')).toBe(
      '{"Cookie":"[REDACTED]"}',
    );
    expect(redactAuthSecrets('{"COOKIE":"abc"}')).toBe(
      '{"COOKIE":"[REDACTED]"}',
    );
  });

  it("redacts authorization, token, bearer keys", () => {
    expect(redactAuthSecrets('{"authorization":"Bearer xyz"}')).toBe(
      '{"authorization":"[REDACTED]"}',
    );
    expect(redactAuthSecrets('{"token":"abc"}')).toBe('{"token":"[REDACTED]"}');
    expect(redactAuthSecrets('{"bearer":"abc"}')).toBe(
      '{"bearer":"[REDACTED]"}',
    );
  });

  it("preserves values that contain secret-like words but not in keys", () => {
    expect(redactAuthSecrets('{"errorMessage":"cookie expired"}')).toBe(
      '{"errorMessage":"cookie expired"}',
    );
  });

  it("preserves business fields with similar-looking key names", () => {
    expect(redactAuthSecrets('{"attemptId":123}')).toBe('{"attemptId":123}');
    expect(redactAuthSecrets('{"priorAuthorizationKey":"x"}')).toBe(
      '{"priorAuthorizationKey":"x"}',
    );
  });

  it("walks arrays and nested objects", () => {
    expect(redactAuthSecrets('{"items":[{"cookie":"a"}]}')).toBe(
      '{"items":[{"cookie":"[REDACTED]"}]}',
    );
  });

  it("returns input unchanged for non-JSON bodies", () => {
    expect(redactAuthSecrets("plain text body")).toBe("plain text body");
    expect(redactAuthSecrets("")).toBe("");
  });
});
