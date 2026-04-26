export function decodeIfBase64(value: string | null): string | null {
  if (!value) return null;

  try {
    const decoded = Buffer.from(value, "base64").toString("utf-8");

    const reEncoded = Buffer.from(decoded, "utf-8").toString("base64");

    if (reEncoded === value) {
      return decoded;
    } else {
      return value;
    }
  } catch (error) {
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
