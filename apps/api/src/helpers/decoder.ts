/* eslint-disable unicorn/no-null */

export function decodeIfBase64(value: string | null): string | null {
  if (!value) return null;

  // Support 'comp:' prefix used by the web client for large strings
  if (value.startsWith("comp:")) {
    try {
      const base64Data = value.slice(5);
      const decoded = Buffer.from(base64Data, "base64").toString("utf8");
      return decoded;
    } catch {
      return value;
    }
  }

  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const reEncoded = Buffer.from(decoded, "utf8").toString("base64");
    return reEncoded === value ? decoded : value;
  } catch {
    return value;
  }
}
export function decodeFields(fields: { [key: string]: string | null }): {
  [key: string]: string | null;
} {
  const decodedFields: { [key: string]: string | null } = {};

  for (const key in fields) {
    decodedFields[key] = decodeIfBase64(fields[key]);
  }

  return decodedFields;
}
