const QUOTED_FILENAME_PATTERN = /["'`]([^\n\r"'`]+?\.[\dA-Za-z]{2,10})["'`]/;
const BARE_FILENAME_PATTERN = /\b([\w.-]+\.[\dA-Za-z]{2,10})\b/;
const FILENAME_REQUIREMENT_PATTERN =
  /file\s*name|filename|name of (?:the )?file|file named|file called/i;
const NAMED_FILENAME_PATTERN =
  /\b(?:named|called)\s+["'`]?([^\n\r"'`]+?\.[\da-z]{2,10})/i;

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim().replaceAll(/^["'`]+|["'`]+$/g, "");
  const basename = trimmed.split(/[/\\]/).pop() ?? trimmed;
  return basename.trim();
}

export function mentionsFilenameRequirement(text: string): boolean {
  if (!text) return false;

  return (
    FILENAME_REQUIREMENT_PATTERN.test(text) || NAMED_FILENAME_PATTERN.test(text)
  );
}

export function extractExpectedFilenameFromText(text: string): string | null {
  if (!text) return null;

  const quotedMatch = text.match(QUOTED_FILENAME_PATTERN);
  if (quotedMatch?.[1]) {
    return sanitizeFilename(quotedMatch[1]);
  }

  const namedMatch = text.match(NAMED_FILENAME_PATTERN);
  if (namedMatch?.[1]) {
    return sanitizeFilename(namedMatch[1]);
  }

  const bareMatch = text.match(BARE_FILENAME_PATTERN);
  if (bareMatch?.[1]) {
    return sanitizeFilename(bareMatch[1]);
  }

  return null;
}

export function filenamesMatch(
  actualFilename: string,
  expectedFilename: string,
): boolean {
  if (!actualFilename || !expectedFilename) return false;

  return (
    sanitizeFilename(actualFilename).toLowerCase() ===
    sanitizeFilename(expectedFilename).toLowerCase()
  );
}
