import type {
  CheckFailure,
  CriterionVerdict,
  ModelGradeOutput,
  Part,
  Quote,
  RubricCriterion,
} from "./contracts";

/** Collapse whitespace runs to one space so line wrapping can't fail a quote. */
export function normalizeWhitespace(text: string): string {
  return text.normalize("NFC").replaceAll(/\s+/g, " ").trim();
}

/**
 * Structural checks: one verdict per criterion, no unknown or duplicate ids,
 * points inside the criterion's bounds. A failure here means the model's
 * answer is unusable as is and earns one retry.
 */
export function structuralFailures(
  output: ModelGradeOutput,
  criteria: RubricCriterion[],
): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const seen = new Set<string>();

  for (const verdict of output.verdicts) {
    const criterion = byId.get(verdict.criterionId);
    if (!criterion) {
      failures.push({
        code: "unknown_criterion",
        criterionId: verdict.criterionId,
        detail: `verdict for unknown criterion "${verdict.criterionId}"`,
      });
      continue;
    }
    if (seen.has(verdict.criterionId)) {
      failures.push({
        code: "duplicate_verdict",
        criterionId: verdict.criterionId,
        detail: `more than one verdict for criterion "${verdict.criterionId}"`,
      });
      continue;
    }
    seen.add(verdict.criterionId);
    if (
      !Number.isFinite(verdict.points) ||
      verdict.points < 0 ||
      verdict.points > criterion.maxPoints
    ) {
      failures.push({
        code: "points_out_of_bounds",
        criterionId: verdict.criterionId,
        detail: `points ${verdict.points} outside [0, ${criterion.maxPoints}] for criterion "${verdict.criterionId}"`,
      });
    }
  }

  for (const criterion of criteria) {
    if (!seen.has(criterion.id)) {
      failures.push({
        code: "missing_verdict",
        criterionId: criterion.id,
        detail: `no verdict for criterion "${criterion.id}"`,
      });
    }
  }
  return failures;
}

function quoteFailure(
  quote: Quote,
  partsByName: Map<string, Part>,
  normalizedText: Map<string, string>,
): CheckFailure["code"] | undefined {
  const part = partsByName.get(quote.part);
  if (!part) return "quote_unknown_part";
  const needle = normalizeWhitespace(quote.text);
  if (needle.length === 0) return "quote_empty";
  if (part.kind !== "text") return undefined;
  const haystack = normalizedText.get(part.name) ?? "";
  return haystack.includes(needle) ? undefined : "quote_not_found";
}

export interface EvidenceCheckResult {
  verdicts: CriterionVerdict[];
  failures: CheckFailure[];
}

/**
 * Evidence checks on structurally valid verdicts. Quotes that don't hold up
 * are dropped and recorded; a criterion left with points but no valid quote
 * is set to 0. Verdicts come back in rubric order.
 */
export function applyEvidenceChecks(
  output: ModelGradeOutput,
  criteria: RubricCriterion[],
  parts: Part[],
): EvidenceCheckResult {
  const partsByName = new Map(parts.map((part) => [part.name, part]));
  const normalizedText = new Map(
    parts
      .filter((part) => part.kind === "text")
      .map((part) => [part.name, normalizeWhitespace(part.text ?? "")]),
  );
  const verdictById = new Map(
    output.verdicts.map((verdict) => [verdict.criterionId, verdict]),
  );
  const failures: CheckFailure[] = [];
  const verdicts: CriterionVerdict[] = [];

  for (const criterion of criteria) {
    const verdict = verdictById.get(criterion.id);
    if (!verdict) continue;
    const validQuotes: Quote[] = [];
    for (const quote of verdict.quotes) {
      const code = quoteFailure(quote, partsByName, normalizedText);
      if (code) {
        failures.push({
          code,
          criterionId: criterion.id,
          // Part name only: quote text is learner content and stays out of logs.
          detail: `quote from part "${quote.part}" failed ${code}`,
        });
      } else {
        validQuotes.push(quote);
      }
    }
    let points = verdict.points;
    if (points > 0 && validQuotes.length === 0) {
      failures.push({
        code: "points_without_evidence",
        criterionId: criterion.id,
        detail: `${points} points with no valid quote; set to 0`,
      });
      points = 0;
    }
    verdicts.push({
      criterionId: criterion.id,
      points,
      reason: verdict.reason,
      quotes: validQuotes,
      feedback: verdict.feedback,
    });
  }
  return { verdicts, failures };
}

export function describeFailuresForRetry(failures: CheckFailure[]): string {
  return failures.map((failure) => `- ${failure.detail}`).join("\n");
}
