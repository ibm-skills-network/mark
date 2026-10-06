import type { Choice, QuestionStore } from "@/config/types";

type ChoiceQuestion = Pick<
  QuestionStore,
  "choices" | "translations" | "learnerChoices" | "contentLanguage"
>;

/**
 * The text of each choice the learner selected, taken from the same set the
 * question renders: the translation for the learner's language when the
 * attempt carries one, otherwise the plain choices, which are in whatever
 * language the attempt was last fetched in. `language` says which.
 */
export function selectedChoiceTexts(
  question: ChoiceQuestion,
  preferredLanguage: string,
): { texts: string[]; language?: string } {
  const translated =
    question.translations?.[preferredLanguage]?.translatedChoices;
  const rendered: Choice[] | undefined = translated ?? question.choices;
  const language = translated ? preferredLanguage : question.contentLanguage;
  const selected = new Set((question.learnerChoices ?? []).map(String));
  const texts = (rendered ?? [])
    .map((choice, index) =>
      selected.has(String(index)) ? choice.choice : undefined,
    )
    .filter((choice): choice is string => choice !== undefined);
  return { texts, language };
}

/**
 * The language a submit should name: the one the selected choices were
 * rendered in, when every answered choice question agrees on it. The server
 * grades choices against that language first, so naming another one only
 * forces it to search the other languages. With no answered choices, mixed
 * languages or an unknown fetch language, the learner's preference stands.
 */
export function submissionLanguage(
  questions: ChoiceQuestion[],
  preferredLanguage: string,
): string {
  const languages = new Set<string | undefined>();
  for (const question of questions) {
    const { texts, language } = selectedChoiceTexts(
      question,
      preferredLanguage,
    );
    if (texts.length > 0) languages.add(language);
  }
  if (languages.size !== 1) return preferredLanguage;
  const [only] = languages;
  return only ?? preferredLanguage;
}
