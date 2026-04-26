/* eslint-disable unicorn/no-null */
export function encodeFields(fields: { [key: string]: string | null }): {
  [key: string]: string | null;
} {
  const encodedFields: { [key: string]: string | null } = {};

  for (const key in fields) {
    encodedFields[key] = fields[key]
      ? Buffer.from(fields[key]).toString("base64")
      : null;
  }

  return encodedFields;
}
