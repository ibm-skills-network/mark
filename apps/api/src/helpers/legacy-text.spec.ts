/* eslint-disable unicorn/no-null */
import { unwrapLegacyText } from "./legacy-text";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

describe("unwrapLegacyText", () => {
  it("decodes HTML stored as one layer of base64", () => {
    const html =
      "<p>Welcome!</p><p>You’ll examine DNS, HTTPS, and ICMP traffic.</p>";
    expect(unwrapLegacyText(b64(html))).toBe(html);
  });

  it("decodes plain prose stored as base64", () => {
    expect(unwrapLegacyText(b64("Answer all five questions."))).toBe(
      "Answer all five questions.",
    );
  });

  it.each([
    "<p>Already plain HTML</p>",
    "Divertimento",
    "Practice",
    "abcd1234",
    "",
  ])("leaves plain text %p as it is", (text) => {
    expect(unwrapLegacyText(text)).toBe(text);
  });

  it("leaves base64 that decodes to binary as it is", () => {
    const binary = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x80, 0x90]).toString(
      "base64",
    );
    expect(unwrapLegacyText(binary)).toBe(binary);
  });

  it("leaves unpadded base64 as it is", () => {
    const unpadded = b64("Hello there!!").replace(/=+$/, "");
    expect(unwrapLegacyText(unpadded)).toBe(unpadded);
  });

  it("passes null through", () => {
    expect(unwrapLegacyText(null)).toBeNull();
  });
});
