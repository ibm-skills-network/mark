type WithContent = { content?: unknown };

/**
 * A file's content is its text. The shared API decoder JSON-parses decoded
 * text, so a notebook or .json file read back from the API (a saved draft or
 * an earlier response) arrives as an object; turn it back into the file's
 * JSON text before it is stored or submitted.
 */
export function fileContentAsText(content: unknown): string | undefined {
  if (content === undefined || content === null) return undefined;
  if (typeof content === "string") return content;
  if (typeof content === "object") return JSON.stringify(content);
  return String(content as number | boolean);
}

export function withTextFileContent<T extends WithContent>(file: T): T {
  if (file?.content === undefined || typeof file.content === "string") {
    return file;
  }
  return { ...file, content: fileContentAsText(file.content) };
}
