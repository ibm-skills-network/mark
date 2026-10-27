function parseHttpUrl(value: unknown): URL | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url
      : undefined;
  } catch {
    // Unparseable URLs simply have no host; the caller omits the key.
    return undefined;
  }
}

export function deriveLmsHost(value: unknown): string | undefined {
  return parseHttpUrl(value)
    ?.hostname.toLowerCase()
    .replace(/^www\./, "");
}
