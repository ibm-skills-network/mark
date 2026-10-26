import { ApiProperty } from "@nestjs/swagger";
import { IsDefined, IsString, MaxLength, ValidateBy } from "class-validator";
import {
  getAllLanguageCodes,
  getLanguageNameFromCode,
} from "../../attempt/helper/languages";

export interface SupportedLanguage {
  /** The code as the language catalogue spells it (`zh-CN`, `uk-UA`, `fr`). */
  code: string;
  /** The catalogue's display name, used in the translation prompt. */
  name: string;
}

/**
 * The catalogue entry for a requested code, matched case-insensitively, or
 * undefined when the code is not one Mark translates into.
 */
export function resolveSupportedLanguage(
  code: unknown,
): SupportedLanguage | undefined {
  if (typeof code !== "string") return undefined;
  const wanted = code.trim().toLowerCase();
  const canonical = getAllLanguageCodes().find(
    (candidate) => candidate.toLowerCase() === wanted,
  );
  if (!canonical) return undefined;
  const name = getLanguageNameFromCode(canonical);
  return name ? { code: canonical, name } : undefined;
}

/**
 * Body of `POST /assignments/:assignmentId/questions/:id/translations`.
 *
 * Only the code is read. The display name is derived from it on the server,
 * and anything else the client sends (the web app includes the whole question
 * and the display name) is stripped by the global whitelist pipe.
 */
export class QuestionTranslationRequestDto {
  @ApiProperty({
    description: "A code from the supported language list, e.g. `fr`, `zh-CN`.",
    type: String,
    maxLength: 16,
  })
  @IsDefined()
  @IsString()
  @MaxLength(16)
  @ValidateBy({
    name: "isSupportedLanguageCode",
    validator: {
      validate: (value: unknown) =>
        resolveSupportedLanguage(value) !== undefined,
      defaultMessage: () => "Unsupported language",
    },
  })
  selectedLanguageCode: string;
}
