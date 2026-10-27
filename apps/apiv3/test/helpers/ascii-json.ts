// Same escaping the gateway applies before sending the user-session header.
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replaceAll(
    /[\u007F-￿]/g,
    (char) => `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`,
  );
}
