import type { Translation } from "@prisma/client";
import type { PrismaService } from "src/database/prisma.service";
import type {
  Choice,
  QuestionDto,
} from "src/api/assignment/dto/update.questions.request.dto";

/** Shared by display and grading: exact locale, base language, then sibling. */
export function pickTranslation<T>(
  translations: Record<string, T>,
  language: string,
): T | undefined {
  const requested = language.trim().toLowerCase();
  const family = requested.split("-")[0];
  const codes = Object.keys(translations).sort();
  const key =
    codes.find((code) => code.toLowerCase() === requested) ??
    codes.find((code) => code.toLowerCase() === family) ??
    codes.find((code) => code.toLowerCase().split("-")[0] === family);
  return key === undefined ? undefined : translations[key];
}

/** A variant's matching translation takes precedence over the base question. */
export async function findQuestionTranslation(
  prisma: Pick<PrismaService, "translation">,
  questionId: number,
  variantId: number | null | undefined,
  language: string,
): Promise<Translation | undefined> {
  const family = language.trim().toLowerCase().split("-")[0];
  const rows = await prisma.translation.findMany({
    where: {
      questionId,
      languageCode: { startsWith: family, mode: "insensitive" },
      OR: [{ variantId: null }, ...(variantId ? [{ variantId }] : [])],
    },
  });
  const variants: Record<string, Translation> = {};
  const questions: Record<string, Translation> = {};
  for (const row of rows) {
    (row.variantId ? variants : questions)[row.languageCode] = row;
  }
  return (
    pickTranslation(variants, language) ?? pickTranslation(questions, language)
  );
}

/** Do not mutate the canonical question held in the per-job cache. */
export function applyQuestionTranslation(
  question: QuestionDto,
  translation: Translation | null | undefined,
): QuestionDto {
  if (!translation) return question;
  let choices = question.choices;
  if (translation.translatedChoices) {
    try {
      choices = (
        typeof translation.translatedChoices === "string"
          ? JSON.parse(translation.translatedChoices)
          : translation.translatedChoices
      ) as Choice[];
    } catch {
      choices = [];
    }
  }
  return { ...question, question: translation.translatedText, choices };
}
