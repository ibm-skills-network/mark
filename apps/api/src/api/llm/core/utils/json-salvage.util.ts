/**
 * Salvage helpers for the text-parsing fallback path (providers without native
 * structured output — e.g. watsonx llama/granite/mistral/gpt-oss). Native
 * structured output cannot emit invalid JSON, but free-form "respond with JSON"
 * generation routinely does: unescaped control characters inside strings
 * (common in code-heavy submissions) break JSON.parse. These restore the
 * protection the per-service graders used to carry before the migration.
 */

/**
 * Trim, strip a leading BOM, and escape raw control characters that appear
 * inside JSON string literals so the payload becomes parseable.
 */
export function sanitizeJsonResponse(response: string): string {
  const trimmed = response.trim().replace(/^\uFEFF/, "");
  return escapeControlCharsInJsonStrings(trimmed);
}

/**
 * Extract the outermost JSON object from a response that wraps it in prose or
 * fencing. Returns the input unchanged when no `{ ... }` span is found.
 */
export function extractJsonPayload(response: string): string {
  const first = response.indexOf("{");
  const last = response.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    return response;
  }
  return response.slice(first, last + 1);
}

function escapeControlCharsInJsonStrings(input: string): string {
  let output = "";
  let inString = false;
  let isEscaped = false;

  for (const char of input) {
    if (isEscaped) {
      output += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      output += char;
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      output += char;
      continue;
    }

    if (inString) {
      const code = char.codePointAt(0);

      if (char === "\t") {
        output += "\\t";
        continue;
      }
      if (char === "\n") {
        output += "\\n";
        continue;
      }
      if (char === "\r") {
        output += "\\r";
        continue;
      }
      if (char === "\u2028") {
        output += "\\u2028";
        continue;
      }
      if (char === "\u2029") {
        output += "\\u2029";
        continue;
      }
      if (code !== undefined && code < 0x20) {
        output += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
    }

    output += char;
  }

  return output;
}
