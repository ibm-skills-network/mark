import { LocalizationService } from "./localization.service";

const localization = new LocalizationService();

const CORRECT_OPTIONS_KEY = "correctOptions";
const CORRECT_OPTIONS_PLACEHOLDER = "{correctOptions}";
const TRUE_FALSE_ANSWER_KEY = "correctAnswerTF";
const TRUE_FALSE_PLACEHOLDER = "{correctAnswer}";

/** Every language the answer-key sentences are written in. */
const SENTENCE_LANGUAGES = ["en", "ar", "id", "de", "es", "fr"];

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

/**
 * One pattern per localized template of `key`, matching the sentence
 * whatever its placeholder held. Templates that fall back to English
 * collapse into one.
 */
const patternsFor = (key: string, placeholder: string): RegExp[] =>
  [
    ...new Set(
      SENTENCE_LANGUAGES.map((language) =>
        localization.getLocalizedString(key, language),
      ).filter((template) => template.includes(placeholder)),
    ),
  ].map((template) => {
    const [before, after] = template.split(placeholder);
    return new RegExp(`\\s*${escapeRegExp(before)}.*?${escapeRegExp(after)}`);
  });

const correctOptionsPatterns = patternsFor(
  CORRECT_OPTIONS_KEY,
  CORRECT_OPTIONS_PLACEHOLDER,
);
const trueFalseAnswerPatterns = patternsFor(
  TRUE_FALSE_ANSWER_KEY,
  TRUE_FALSE_PLACEHOLDER,
);

/** "The correct option(s) were: **a, b**." in the learner's language. */
export const correctOptionsSentence = (
  language: string | null | undefined,
  correctOptions: ReadonlyArray<string>,
): string =>
  localization.getLocalizedString(CORRECT_OPTIONS_KEY, language ?? "en", {
    correctOptions: correctOptions.join(", "),
  });

/** "The correct answer is True." in the learner's language. */
export const trueFalseAnswerSentence = (
  language: string | null | undefined,
  correctAnswer: boolean,
): string => {
  const resolvedLanguage = language ?? "en";
  return localization.getLocalizedString(
    TRUE_FALSE_ANSWER_KEY,
    resolvedLanguage,
    {
      correctAnswer: localization.getLocalizedString(
        correctAnswer ? "true" : "false",
        resolvedLanguage,
      ),
    },
  );
};

type FeedbackEntry = Record<string, unknown> & { feedback?: unknown };

const isFeedbackEntry = (value: unknown): value is FeedbackEntry =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Stored feedback with one answer-key sentence made visible or not. Shown:
 * `sentence` (null when there is nothing to name) is appended to the last
 * text entry unless that entry already carries it. Hidden: every copy of
 * the sentence is removed, including from rows stored before the grader
 * stopped writing it.
 */
const applySentenceVisibility = (
  feedback: unknown[],
  parameters: {
    revealAnswers: boolean;
    sentence: string | null;
    patterns: RegExp[];
    separator: string;
  },
): unknown[] => {
  const { patterns, revealAnswers, sentence, separator } = parameters;
  if (!revealAnswers) {
    return feedback.map((entry) => {
      if (!isFeedbackEntry(entry) || typeof entry.feedback !== "string") {
        return entry;
      }
      let text = entry.feedback;
      for (const pattern of patterns) {
        text = text.replace(pattern, "");
      }
      return { ...entry, feedback: text };
    });
  }
  if (sentence === null) {
    return feedback;
  }
  let lastIndex = -1;
  for (const [index, entry] of feedback.entries()) {
    if (isFeedbackEntry(entry) && typeof entry.feedback === "string") {
      lastIndex = index;
    }
  }
  if (lastIndex === -1) {
    return [...feedback, { feedback: sentence }];
  }
  return feedback.map((entry, index) => {
    if (index !== lastIndex || !isFeedbackEntry(entry)) return entry;
    const text = entry.feedback as string;
    if (patterns.some((pattern) => pattern.test(text))) return entry;
    return { ...entry, feedback: `${text}${separator}${sentence}` };
  });
};

/**
 * Multiple-correct feedback as the learner may see it. The grader never
 * stores which options were correct in the feedback text; when the answer
 * key is revealed and the learner missed something, the sentence naming the
 * correct options is appended here. When the key is hidden, any copy of that
 * sentence in older stored feedback is removed instead.
 */
export const applyCorrectOptionsVisibility = (
  feedback: unknown[],
  parameters: {
    revealAnswers: boolean;
    perfectScore: boolean | undefined;
    correctOptions: ReadonlyArray<string>;
    language: string | null | undefined;
  },
): unknown[] =>
  applySentenceVisibility(feedback, {
    revealAnswers: parameters.revealAnswers,
    sentence:
      parameters.perfectScore === false && parameters.correctOptions.length > 0
        ? correctOptionsSentence(parameters.language, parameters.correctOptions)
        : null,
    patterns: correctOptionsPatterns,
    separator: "\n",
  });

/**
 * True/false feedback as the learner may see it: the grader stores only
 * "Incorrect."; the correct answer is named here when the key is revealed,
 * and stripped from older stored rows while it is hidden.
 */
export const applyTrueFalseAnswerVisibility = (
  feedback: unknown[],
  parameters: {
    revealAnswers: boolean;
    isCorrect: boolean | undefined;
    correctAnswer: boolean | undefined;
    language: string | null | undefined;
  },
): unknown[] =>
  applySentenceVisibility(feedback, {
    revealAnswers: parameters.revealAnswers,
    sentence:
      parameters.isCorrect === false &&
      typeof parameters.correctAnswer === "boolean"
        ? trueFalseAnswerSentence(parameters.language, parameters.correctAnswer)
        : null,
    patterns: trueFalseAnswerPatterns,
    separator: " ",
  });

/**
 * Grading metadata of a stored or fresh response, applied to its feedback:
 * multiple-correct responses carry `perfectScore`/`correctChoices`,
 * true/false responses `isCorrect`/`correctAnswer`. Anything else passes
 * through unchanged.
 */
export const applyAnswerKeyVisibility = (
  feedback: unknown[],
  metadata: unknown,
  parameters: {
    revealAnswers: boolean;
    language: string | null | undefined;
    isTrueFalse: boolean;
    isMultipleCorrect: boolean;
  },
): unknown[] => {
  const record: Record<string, unknown> = isFeedbackEntry(metadata)
    ? metadata
    : {};
  if (parameters.isTrueFalse) {
    return applyTrueFalseAnswerVisibility(feedback, {
      revealAnswers: parameters.revealAnswers,
      isCorrect:
        typeof record.isCorrect === "boolean" ? record.isCorrect : undefined,
      correctAnswer:
        typeof record.correctAnswer === "boolean"
          ? record.correctAnswer
          : undefined,
      language: parameters.language,
    });
  }
  if (parameters.isMultipleCorrect) {
    const correctChoices: unknown = record.correctChoices;
    return applyCorrectOptionsVisibility(feedback, {
      revealAnswers: parameters.revealAnswers,
      perfectScore:
        typeof record.perfectScore === "boolean"
          ? record.perfectScore
          : undefined,
      correctOptions: Array.isArray(correctChoices)
        ? correctChoices.filter(
            (choice): choice is string => typeof choice === "string",
          )
        : [],
      language: parameters.language,
    });
  }
  return feedback;
};
