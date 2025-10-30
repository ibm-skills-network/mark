export function encodeFields(fields: { [key: string]: string | null }): {
  [key: string]: string | null;
} {
  const encodedFields: { [key: string]: string | null } = {};

  for (const key in fields) {
    if (fields[key]) {
      encodedFields[key] = Buffer.from(fields[key]).toString("base64");
    } else {
      encodedFields[key] = null;
    }
  }

  return encodedFields;
}
