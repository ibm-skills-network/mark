import type { Choice } from "src/api/assignment/dto/update.questions.request.dto";

/**
 * One stored set of choices for a question: the authored choices or one
 * translation of them. The learner client submits the text of whichever set
 * it last rendered, which is not always the set the submit's `language`
 * selects for grading, so the grader looks the text up in all of them.
 */
export interface ChoiceRendering {
  /** Where the set came from, for logs only (e.g. "authored", "translation:ja"). */
  source: string;
  choices: Choice[];
  /**
   * False when the set is known not to share the authored choice order (a
   * base question's translation shown for a variant). Such a set can only be
   * graded by its own answer key, never mapped onto the grading set by index.
   */
  aligned?: boolean;
}

export type ChoiceResolution =
  | {
      kind: "matched";
      /** The choice to grade with. */
      choice: Choice;
      /** Position in the grading set, when the match maps onto it. */
      gradingIndex?: number;
      sources: string[];
    }
  | { kind: "ambiguous"; sources: string[] }
  | { kind: "none" };

/** Lowercase, trimmed, whitespace collapsed, same punctuation rule as the grader. */
export function normalizeChoiceText(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replaceAll(/[!,،؛؟]/g, "")
    .replaceAll(/\s+/g, " ");
}

/** Parse stored choices: an array, a JSON string of one, or `{ choices: [...] }`. */
export function parseStoredChoices(value: unknown): Choice[] | undefined {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // Not JSON: there is no choice list to read.
      return undefined;
    }
    // Some rows were stored double-encoded.
    if (typeof parsed === "string") return parseStoredChoices(parsed);
  }
  if (
    parsed &&
    !Array.isArray(parsed) &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { choices?: unknown }).choices)
  ) {
    parsed = (parsed as { choices: unknown[] }).choices;
  }
  if (!Array.isArray(parsed)) return undefined;
  const choices = parsed.filter(
    (item): item is Choice =>
      !!item &&
      typeof item === "object" &&
      (typeof (item as Choice).choice === "string" ||
        typeof (item as Choice).choice === "number"),
  );
  return choices.length === parsed.length ? choices : undefined;
}

const scoreKey = (choice: Choice): string =>
  `${choice.isCorrect === true ? "correct" : "wrong"}:${Number(choice.points) || 0}`;

/** Same length, and every position carries the same answer key. */
function sharesAnswerKey(a: Choice[], b: Choice[]): boolean {
  return (
    a.length === b.length &&
    a.every((choice, index) => scoreKey(choice) === scoreKey(b[index]))
  );
}

/**
 * Find the choice a learner meant by `text` across every stored rendering of
 * the question. A match in a set that shares the grading set's order and
 * answer key maps to the grading choice at the same position. A match in any
 * other set is graded by that set's own answer key, unless `alignedOnly`.
 *
 * Matches that would score differently are ambiguous: the caller must not
 * award anything for them.
 */
export function resolveChoiceAcrossRenderings(
  text: unknown,
  gradingChoices: Choice[],
  renderings: ChoiceRendering[],
  options: { alignedOnly?: boolean } = {},
): ChoiceResolution {
  const wanted = normalizeChoiceText(text);
  if (!wanted) return { kind: "none" };

  const matches: { choice: Choice; gradingIndex?: number; source: string }[] =
    [];
  for (const rendering of renderings) {
    const mapsByIndex =
      rendering.aligned !== false &&
      sharesAnswerKey(rendering.choices, gradingChoices);
    if (!mapsByIndex && options.alignedOnly) continue;
    for (const [index, choice] of rendering.choices.entries()) {
      if (normalizeChoiceText(choice.choice) !== wanted) continue;
      matches.push(
        mapsByIndex
          ? {
              choice: gradingChoices[index],
              gradingIndex: index,
              source: rendering.source,
            }
          : { choice, source: rendering.source },
      );
    }
  }

  if (matches.length === 0) return { kind: "none" };

  const sources = [...new Set(matches.map((match) => match.source))];
  const outcomes = new Set(matches.map((match) => scoreKey(match.choice)));
  const gradingIndexes = new Set(
    matches
      .map((match) => match.gradingIndex)
      .filter((index) => index !== undefined),
  );
  // Multiple-correct grading tracks which grading choices were picked, so a
  // text that lands on two different positions is ambiguous even when both
  // would score the same.
  if (outcomes.size > 1 || (options.alignedOnly && gradingIndexes.size > 1)) {
    return { kind: "ambiguous", sources };
  }

  const best =
    matches.find((match) => match.gradingIndex !== undefined) ?? matches[0];
  return {
    kind: "matched",
    choice: best.choice,
    gradingIndex: best.gradingIndex,
    sources,
  };
}

/** The fields of a stored Translation row the renderings are built from. */
export interface StoredChoiceTranslation {
  languageCode: string;
  variantId: number | null;
  translatedChoices: unknown;
  untranslatedChoices: unknown;
}

/**
 * A translation is only trusted when it was made from the choices it is
 * being lined up against. A row with no record of its source is accepted;
 * the grader still checks it shares the grading set's answer key.
 */
function translatedFrom(
  row: StoredChoiceTranslation,
  sourceChoices: Choice[],
): boolean {
  if (row.untranslatedChoices === null || row.untranslatedChoices === undefined)
    return true;
  const source = parseStoredChoices(row.untranslatedChoices);
  if (!source || source.length !== sourceChoices.length) return false;
  return source.every(
    (choice, index) =>
      normalizeChoiceText(choice.choice) ===
      normalizeChoiceText(sourceChoices[index].choice),
  );
}

/**
 * Every set of choices the learner can have been shown for one question in
 * one attempt, mirroring the attempt read path: the question's (or variant's)
 * authored choices and their translations, plus, for a variant, the base
 * question's translation in any language the variant has none for.
 */
export function buildChoiceRenderings(input: {
  /** The authored choices being graded: the variant's, else the question's. */
  ownChoices: Choice[] | undefined;
  /** The base question's authored choices (variant attempts only). */
  baseChoices?: Choice[];
  /** Set when the attempt drew a variant for this question. */
  variantId: number | null;
  rows: StoredChoiceTranslation[];
}): ChoiceRendering[] {
  const { ownChoices, baseChoices, variantId, rows } = input;
  const renderings: ChoiceRendering[] = [];
  if (ownChoices?.length) {
    renderings.push({ source: "authored", choices: ownChoices });
  }

  const ownRows = rows.filter((row) => (row.variantId ?? null) === variantId);
  for (const row of ownRows) {
    const choices = parseStoredChoices(row.translatedChoices);
    if (!choices?.length || !ownChoices || !translatedFrom(row, ownChoices))
      continue;
    renderings.push({ source: `translation:${row.languageCode}`, choices });
  }

  if (variantId !== null && baseChoices?.length) {
    // A variant without its own choices grades the base choices, so the base
    // translations are in the grading order after all.
    const sameChoices =
      !!ownChoices &&
      ownChoices.length === baseChoices.length &&
      ownChoices.every(
        (choice, index) =>
          normalizeChoiceText(choice.choice) ===
          normalizeChoiceText(baseChoices[index].choice),
      );
    const variantLanguages = new Set(
      ownRows.map((row) => row.languageCode.toLowerCase()),
    );
    for (const row of rows) {
      if (row.variantId !== null) continue;
      const code = row.languageCode.toLowerCase();
      // The read path serves the variant itself in English and wherever the
      // variant has its own translation.
      if (code.split("-")[0] === "en" || variantLanguages.has(code)) continue;
      const choices = parseStoredChoices(row.translatedChoices);
      if (!choices?.length || !translatedFrom(row, baseChoices)) continue;
      renderings.push({
        source: `base-translation:${row.languageCode}`,
        choices,
        aligned: sameChoices,
      });
    }
  }

  return renderings;
}
