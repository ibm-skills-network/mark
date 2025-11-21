function looksLikeSchemaObject(object: unknown): boolean {
  if (!object || typeof object !== "object") return false;
  const rec = object as Record<string, unknown>;
  return (
    "$schema" in rec ||
    ("properties" in rec && "type" in rec && typeof rec.properties === "object")
  );
}

function scoreCandidateJson(jsonString: string): number {
  try {
    const object = JSON.parse(jsonString) as Record<string, unknown>;
    let score = 0;
    if (typeof object.isValid === "boolean") score += 5;
    if (typeof object.overallFeedback === "string") score += 3;
    if (object.questionIssues && typeof object.questionIssues === "object")
      score += 3;
    if (
      object.improvementSuggestions &&
      typeof object.improvementSuggestions === "object"
    )
      score += 3;
    if (typeof object.translatedText === "string") score += 4;
    if (Array.isArray(object.detections)) score += 3;

    if (
      ("id" in object && "question" in object && "choices" in object) ||
      ("assignmentId" in object && "type" in object && "question" in object)
    )
      score -= 5;

    return score;
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
}

export function extractStructuredJSON(response: string): string {
  try {
    JSON.parse(response);
    return response;
  } catch (error) {
    console.warn(
      `Error parsing JSON: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }

  const codeBlocks: string[] = [];
  const codeBlockRegex = /```json\s*([\S\s]*?)\s*```/g;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(response)) !== null) {
    const candidate = match[1].trim();
    try {
      JSON.parse(candidate);
      codeBlocks.push(candidate);
    } catch {
      console.warn(
        "Could not parse JSON block from response, trying other methods",
      );
    }
  }

  if (codeBlocks.length > 0) {
    const parsed = codeBlocks
      .map((c) => ({ c, obj: safeParse(c) }))
      .filter((x) => x.obj !== undefined) as {
      c: string;
      obj: Record<string, unknown>;
    }[];
    const nonSchema = parsed.filter((x) => !looksLikeSchemaObject(x.obj));
    const candidates = (nonSchema.length > 0 ? nonSchema : parsed).map(
      (x) => x.c,
    );
    if (candidates.length > 0) {
      let best = candidates[0];
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const c of candidates) {
        const s = scoreCandidateJson(c);
        if (s >= bestScore) {
          bestScore = s;
          best = c;
        }
      }
      return best;
    }
  }

  const objectBlocks: string[] = [];
  const objectRegex = /{[\S\s]*?}/g;
  let objectMatch: RegExpExecArray | null;
  while ((objectMatch = objectRegex.exec(response)) !== null) {
    const candidate = objectMatch[0];
    try {
      JSON.parse(candidate);
      objectBlocks.push(candidate);
    } catch {
      console.warn(
        "Could not parse JSON object from response, trying other methods",
      );
    }
  }

  if (objectBlocks.length > 0) {
    const parsed = objectBlocks
      .map((c) => ({ c, obj: safeParse(c) }))
      .filter((x) => x.obj !== undefined) as {
      c: string;
      obj: Record<string, unknown>;
    }[];
    const nonSchema = parsed.filter((x) => !looksLikeSchemaObject(x.obj));
    const candidates = (nonSchema.length > 0 ? nonSchema : parsed).map(
      (x) => x.c,
    );
    if (candidates.length > 0) {
      let best = candidates[0];
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const c of candidates) {
        const s = scoreCandidateJson(c);
        if (s >= bestScore) {
          bestScore = s;
          best = c;
        }
      }
      return best;
    }
  }

  return response;
}

function safeParse(string_: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(string_) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
