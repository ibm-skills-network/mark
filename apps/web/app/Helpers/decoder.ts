export function decodeIfBase64(value: string | null): string | null {
  if (!value) return null; // Return null if the input is null

  try {
    // Check if the string is Base64-encoded
    const decoded = Buffer.from(value, "base64").toString("utf-8");

    // Re-encode the decoded string to Base64 and compare it with the original
    const reEncoded = Buffer.from(decoded, "utf-8").toString("base64");

    if (reEncoded === value) {
      return decoded; // If re-encoded value matches original, it's Base64 → return decoded value
    } else {
      return value; // Not Base64, return as-is
    }
  } catch (error) {
    return value; // If decoding fails, return original value
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
