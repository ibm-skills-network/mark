import type {
  CheckFailure,
  CriterionVerdict,
  EvidenceCounts,
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

const SINGLE_QUOTES = /[\u00B4\u2018-\u201B\u2032]/g;
const DOUBLE_QUOTES = /[\u00AB\u00BB\u201C-\u201F\u2033]/g;
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const JSON_ESCAPE = /\\(["'/\\nrt])/g;
const JSON_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\n",
  t: "\t",
  '"': '"',
  "'": "'",
  "\\": "\\",
  "/": "/",
};

/**
 * What a quote and a part are compared as: JSON-style escapes undone
 * (\n, \t, \"), curly quotes and dashes made plain, Markdown backticks
 * and asterisks removed, lowercased, whitespace collapsed.
 */
export function normalizeForQuote(text: string): string {
  return normalizeWhitespace(
    text
      .normalize("NFC")
      .replaceAll(
        JSON_ESCAPE,
        (_, character: string) => JSON_ESCAPES[character] ?? character,
      )
      .replaceAll(SINGLE_QUOTES, "'")
      .replaceAll(DOUBLE_QUOTES, '"')
      .replaceAll(DASHES, "-")
      .replaceAll("\u2026", "...")
      .replaceAll(/[*`]/g, "")
      .toLowerCase(),
  );
}

function wordTokens(normalized: string): string[] {
  return normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/** Share of the quote's words that must appear, in order, for a fuzzy match. */
export const FUZZY_QUOTE_MIN_WORD_SHARE = 0.9;
/** The matching stretch of the part may be at most this many times the quote's word count. */
export const FUZZY_QUOTE_MAX_WINDOW_RATIO = 1.5;
/** Quotes longer than this many words must match without the fuzzy rule. */
const FUZZY_QUOTE_MAX_WORDS = 300;

/** Longest common subsequence length of two token lists. */
function commonSubsequenceLength(a: string[], b: string[]): number {
  let previous = Array.from({ length: b.length + 1 }, () => 0);
  for (const token of a) {
    const current = Array.from({ length: b.length + 1 }, () => 0);
    for (let index = 1; index <= b.length; index += 1) {
      current[index] =
        token === b[index - 1]
          ? previous[index - 1] + 1
          : Math.max(previous[index], current[index - 1]);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Fuzzy rule: at least 90% of the quote's words appear in order inside a
 * stretch of the part no longer than 1.5x the quote's word count. Catches
 * a dropped or added word or changed punctuation; a quote that invents
 * content, or stitches words from far apart, still fails.
 */
function fuzzyMatch(quoteTokens: string[], partTokens: string[]): boolean {
  const length = quoteTokens.length;
  if (length < 2 || length > FUZZY_QUOTE_MAX_WORDS) return false;
  const needed = Math.ceil(length * FUZZY_QUOTE_MIN_WORD_SHARE);
  const window = Math.max(
    length,
    Math.floor(length * FUZZY_QUOTE_MAX_WINDOW_RATIO),
  );
  // A match starts on one of the quote's first words that may be missed.
  const starters = new Set(quoteTokens.slice(0, length - needed + 1));
  // Word counts (order ignored) bound the in-order count from above, so the
  // subsequence work runs only on windows that could pass.
  const quoteCounts = new Map<string, number>();
  for (const token of quoteTokens) {
    quoteCounts.set(token, (quoteCounts.get(token) ?? 0) + 1);
  }
  const windowCounts = new Map<string, number>();
  let overlap = 0;
  const add = (token: string) => {
    const count = windowCounts.get(token) ?? 0;
    if (count < (quoteCounts.get(token) ?? 0)) overlap += 1;
    windowCounts.set(token, count + 1);
  };
  const remove = (token: string) => {
    const count = (windowCounts.get(token) ?? 0) - 1;
    windowCounts.set(token, count);
    if (count < (quoteCounts.get(token) ?? 0)) overlap -= 1;
  };
  for (const token of partTokens.slice(0, window)) add(token);
  for (let start = 0; start < partTokens.length; start += 1) {
    if (start > 0) {
      remove(partTokens[start - 1]);
      if (start + window - 1 < partTokens.length) {
        add(partTokens[start + window - 1]);
      }
    }
    if (overlap < needed || !starters.has(partTokens[start])) continue;
    const stretch = partTokens.slice(start, start + window);
    if (commonSubsequenceLength(quoteTokens, stretch) >= needed) return true;
  }
  return false;
}

export type QuoteRule =
  | "verbatim"
  | "normalized"
  | "part_name"
  | "fuzzy"
  | "visual_unverified";

export type QuoteCheck =
  | { accepted: true; rule: QuoteRule }
  | {
      accepted: false;
      code: "quote_unknown_part" | "quote_empty" | "quote_not_found";
    };

interface PartIndex {
  verbatim: string;
  normalized: string;
  normalizedName: string;
  tokens: string[];
}

function indexPart(part: Part): PartIndex {
  const normalized = normalizeForQuote(part.text ?? "");
  return {
    verbatim: normalizeWhitespace(part.text ?? ""),
    normalized,
    normalizedName: normalizeForQuote(part.name),
    tokens: wordTokens(normalized),
  };
}

const MIN_PART_NAME_QUOTE_CHARS = 3;

/**
 * Check one quote against the part it names. A quote from a file or image
 * part can't be read back here, so any non-empty one is accepted as
 * visual_unverified.
 */
export function checkQuote(
  quote: Quote,
  part: Part | undefined,
  index?: PartIndex,
): QuoteCheck {
  if (!part) return { accepted: false, code: "quote_unknown_part" };
  const verbatim = normalizeWhitespace(quote.text);
  if (verbatim.length === 0) return { accepted: false, code: "quote_empty" };
  if (part.kind !== "text")
    return { accepted: true, rule: "visual_unverified" };
  const partIndex = index ?? indexPart(part);
  if (partIndex.verbatim.includes(verbatim))
    return { accepted: true, rule: "verbatim" };
  const normalized = normalizeForQuote(quote.text);
  if (normalized.length > 0 && partIndex.normalized.includes(normalized)) {
    return { accepted: true, rule: "normalized" };
  }
  if (
    normalized.length >= MIN_PART_NAME_QUOTE_CHARS &&
    partIndex.normalizedName.includes(normalized)
  ) {
    return { accepted: true, rule: "part_name" };
  }
  if (fuzzyMatch(wordTokens(normalized), partIndex.tokens)) {
    return { accepted: true, rule: "fuzzy" };
  }
  return { accepted: false, code: "quote_not_found" };
}

/**
 * checkQuote, except that a rendered file part with `verifyAgainst` has its
 * quotes checked against those text parts first. A quote none of them holds
 * is still accepted as visual_unverified: it may come from a chart or an
 * image on the page, which is what the page render is sent for.
 */
function checkQuoteAgainstParts(
  quote: Quote,
  part: Part | undefined,
  partsByName: Map<string, Part>,
  indexFor: (part: Part) => PartIndex,
): QuoteCheck {
  const targets =
    part && part.kind !== "text"
      ? (part.verifyAgainst ?? [])
          .map((name) => partsByName.get(name))
          .filter((target): target is Part => target?.kind === "text")
      : [];
  if (!part || targets.length === 0) {
    return checkQuote(
      quote,
      part,
      part?.kind === "text" ? indexFor(part) : undefined,
    );
  }
  if (normalizeWhitespace(quote.text).length === 0) {
    return { accepted: false, code: "quote_empty" };
  }
  for (const target of targets) {
    const check = checkQuote(quote, target, indexFor(target));
    if (check.accepted) return check;
  }
  return { accepted: true, rule: "visual_unverified" };
}

/** One quote's outcome, without its text. */
export type QuoteCheckRecord = {
  criterionId: string;
  part: string;
} & QuoteCheck;

export interface EvidenceCheckResult {
  verdicts: CriterionVerdict[];
  failures: CheckFailure[];
  quoteChecks: QuoteCheckRecord[];
  evidence: EvidenceCounts;
}

/**
 * Shown to the learner for a criterion whose points were removed because no
 * quoted evidence could be found in the submission, instead of the model's
 * feedback, which was written for the points it gave.
 */
export const ZEROED_FEEDBACK =
  "We couldn't find the part of your submission that shows this, so no points were given for it.";

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
  const indexes = new Map<string, PartIndex>();
  const indexFor = (part: Part): PartIndex => {
    let index = indexes.get(part.name);
    if (!index) {
      index = indexPart(part);
      indexes.set(part.name, index);
    }
    return index;
  };
  const quoteChecks: QuoteCheckRecord[] = [];
  const verdictById = new Map(
    output.verdicts.map((verdict) => [verdict.criterionId, verdict]),
  );
  const failures: CheckFailure[] = [];
  const verdicts: CriterionVerdict[] = [];
  const evidence: EvidenceCounts = { verified: 0, visualUnverified: 0 };

  for (const criterion of criteria) {
    const verdict = verdictById.get(criterion.id);
    if (!verdict) continue;
    const validQuotes: Quote[] = [];
    let visualUnverifiedQuotes = 0;
    for (const quote of verdict.quotes) {
      const part = partsByName.get(quote.part);
      const check = checkQuoteAgainstParts(quote, part, partsByName, indexFor);
      quoteChecks.push({
        criterionId: criterion.id,
        part: quote.part,
        ...check,
      });
      // `in` narrows without strictNullChecks; `accepted` alone does not.
      if ("code" in check) {
        const { code } = check;
        failures.push({
          code,
          criterionId: criterion.id,
          // Part name only: quote text is learner content and stays out of logs.
          detail: `quote from part "${quote.part}" failed ${code}`,
        });
      } else {
        validQuotes.push(quote);
        if (check.rule === "visual_unverified") {
          visualUnverifiedQuotes += 1;
        } else {
          evidence.verified += 1;
        }
      }
    }
    let points = verdict.points;
    let feedback = verdict.feedback;
    if (points > 0 && validQuotes.length === 0) {
      failures.push({
        code: "points_without_evidence",
        criterionId: criterion.id,
        detail: `criterion ${criterion.id}: ${points} points with no quote found in the part it names; set to 0`,
      });
      points = 0;
      feedback = ZEROED_FEEDBACK;
    }
    verdicts.push({
      criterionId: criterion.id,
      points,
      reason: verdict.reason,
      quotes: validQuotes,
      feedback,
      visualUnverifiedQuotes,
      needsVerification: verdict.needsVerification,
      verificationReason: verdict.needsVerification
        ? verdict.verificationReason
        : null,
    });
    evidence.visualUnverified += visualUnverifiedQuotes;
  }
  return { verdicts, failures, quoteChecks, evidence };
}

export function describeFailuresForRetry(failures: CheckFailure[]): string {
  return failures.map((failure) => `- ${failure.detail}`).join("\n");
}
