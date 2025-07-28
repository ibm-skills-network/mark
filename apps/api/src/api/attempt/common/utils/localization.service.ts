import { Injectable } from "@nestjs/common";

/**
 * Service for handling localization of messages
 */
@Injectable()
export class LocalizationService {
  /**
   * Get a localized string based on key and language
   * @param key The message key
   * @param language Language code (defaults to 'en')
   * @param placeholders Optional placeholders for variable content
   * @returns Localized string
   */
  getLocalizedString(
    key: string,
    language?: string,
    placeholders?: { [key: string]: string | number },
  ): string {
    const translations: Record<string, any> = {
      en: {
        noResponse: "You did not provide a response to this question.",

        expectedTrueFalse:
          "Expected a true/false response, but did not receive one.",
        invalidTrueFalse: "Invalid true/false response.",
        correctTF: "Correct! Your answer is right.",
        incorrectTF: "Incorrect. The correct answer is {correctAnswer}.",
        true: "True",
        false: "False",

        correctSelection:
          "**Correct selection:** {learnerChoice} (+{points} points)",
        incorrectSelection:
          "**Incorrect selection:** {learnerChoice} (-{points} points)",
        invalidSelection: "**Invalid selection:** {learnerChoice}",
        noOptionSelected: "**You didn't select any option.**",
        correctOptions: "The correct option(s) were: **{correctOptions}**.",
        allCorrectSelected: "**You selected all correct options!**",
      },
      ar: {
        noResponse: "لم تقدم إجابة على هذا السؤال.",
        expectedTrueFalse:
          "كان من المتوقع الحصول على إجابة صحيحة/خاطئة، ولكن لم يتم الحصول عليها.",
        invalidTrueFalse: "إجابة صحيحة/خاطئة غير صالحة.",
        correctTF: "صحيح! إجابتك صحيحة.",
        incorrectTF: "خطأ. الإجابة الصحيحة هي {correctAnswer}.",
        true: "صحيح",
        false: "خطأ",
        correctSelection:
          "**الاختيار الصحيح:** {learnerChoice} (+{points} نقطة)",
        incorrectSelection:
          "**الاختيار غير الصحيح:** {learnerChoice} (-{points} نقطة)",
        invalidSelection: "**الاختيار غير صالح:** {learnerChoice}",
        noOptionSelected: "**لم تختر أي خيار.**",
        correctOptions: "الخيارات الصحيحة هي: **{correctOptions}**.",
        allCorrectSelected: "**لقد اخترت جميع الخيارات الصحيحة!**",
      },
      id: {
        noResponse: "Anda tidak memberikan jawaban untuk pertanyaan ini.",
        expectedTrueFalse:
          "Diharapkan jawaban benar/salah, tetapi tidak diterima.",
        invalidTrueFalse: "Jawaban benar/salah tidak valid.",
        correctTF: "Benar! Jawaban Anda benar.",
        incorrectTF: "Salah. Jawaban yang benar adalah {correctAnswer}.",
        true: "Benar",
        false: "Salah",
        correctSelection: "**Pilihan benar:** {learnerChoice} (+{points} poin)",
        incorrectSelection:
          "**Pilihan salah:** {learnerChoice} (-{points} poin)",
        invalidSelection: "**Pilihan tidak valid:** {learnerChoice}",
        noOptionSelected: "**Anda tidak memilih opsi apa pun.**",
        correctOptions: "Opsi yang benar adalah: **{correctOptions}**.",
        allCorrectSelected: "**Anda memilih semua opsi yang benar!**",
      },
      de: {
        noResponse: "Sie haben keine Antwort auf diese Frage gegeben.",
        expectedTrueFalse:
          "Eine Ja/Nein-Antwort wurde erwartet, aber nicht erhalten.",
        invalidTrueFalse: "Ungültige Ja/Nein-Antwort.",
        correctTF: "Richtig! Ihre Antwort ist korrekt.",
        incorrectTF: "Falsch. Die richtige Antwort ist {correctAnswer}.",
        true: "Wahr",
        false: "Falsch",
        correctSelection:
          "**Richtige Auswahl:** {learnerChoice} (+{points} Punkte)",
        incorrectSelection:
          "**Falsche Auswahl:** {learnerChoice} (-{points} Punkte)",
        invalidSelection: "**Ungültige Auswahl:** {learnerChoice}",
        noOptionSelected: "**Sie haben keine Option ausgewählt.**",
        correctOptions:
          "Die richtige(n) Option(en) waren: **{correctOptions}**.",
        allCorrectSelected: "**Sie haben alle richtigen Optionen ausgewählt!**",
      },
      es: {
        noResponse: "No proporcionaste una respuesta a esta pregunta.",
        expectedTrueFalse:
          "Se esperaba una respuesta verdadero/falso, pero no se recibió.",
        invalidTrueFalse: "Respuesta verdadero/falso inválida.",
        correctTF: "¡Correcto! Tu respuesta es correcta.",
        incorrectTF: "Incorrecto. La respuesta correcta es {correctAnswer}.",
        true: "Verdadero",
        false: "Falso",
        correctSelection:
          "**Selección correcta:** {learnerChoice} (+{points} puntos)",
        incorrectSelection:
          "**Selección incorrecta:** {learnerChoice} (-{points} puntos)",
        invalidSelection: "**Selección inválida:** {learnerChoice}",
        noOptionSelected: "**No seleccionaste ninguna opción.**",
        correctOptions:
          "La(s) opción(es) correcta(s) eran: **{correctOptions}**.",
        allCorrectSelected: "**¡Seleccionaste todas las opciones correctas!**",
      },
      fr: {
        noResponse: "Vous n'avez pas répondu à cette question.",
        expectedTrueFalse:
          "Une réponse vrai/faux était attendue, mais non reçue.",
        invalidTrueFalse: "Réponse vrai/faux invalide.",
        correctTF: "Correct ! Votre réponse est juste.",
        incorrectTF: "Incorrect. La bonne réponse est {correctAnswer}.",
        true: "Vrai",
        false: "Faux",
        correctSelection:
          "**Sélection correcte:** {learnerChoice} (+{points} points)",
        incorrectSelection:
          "**Sélection incorrecte:** {learnerChoice} (-{points} points)",
        invalidSelection: "**Sélection invalide:** {learnerChoice}",
        noOptionSelected: "**Vous n'avez sélectionné aucune option.**",
        correctOptions: "Les options correctes étaient: **{correctOptions}**.",
        allCorrectSelected:
          "**Vous avez sélectionné toutes les options correctes !**",
      },
    };

    const langDict = (translations[language] || translations["en"]) as Record<
      string,
      string
    >;

    let string_ = langDict[key] || key;

    if (placeholders) {
      for (const placeholder in placeholders) {
        const regex = new RegExp(`{${placeholder}}`, "g");
        string_ = string_.replace(regex, String(placeholders[placeholder]));
      }
    }

    return string_;
  }

  /**
   * Parse boolean response from text in different languages
   * @param learnerChoice The learner's text response
   * @param language Language code
   * @returns Boolean interpretation or undefined if not recognized
   */
  parseBooleanResponse(
    learnerChoice: string,
    language: string,
  ): boolean | undefined {
    const mapping: Record<string, Record<string, boolean>> = {
      en: { true: true, false: false },
      id: { benar: true, salah: false },
      de: { wahr: true, falsch: false },
      es: { verdadero: true, falso: false },
      fr: { vrai: true, faux: false },
      it: { vero: true, falso: false },
      hu: { igaz: true, hamis: false },
      nl: { waar: true, onwaar: false },
      pl: { prawda: true, fałsz: false },
      pt: { verdadeiro: true, falso: false },
      sv: { sant: true, falskt: false },
      tr: { doğru: true, yanlış: false },
      el: { αληθές: true, ψευδές: false },
      kk: { рас: true, жалған: false },
      ru: { правда: true, ложь: false },
      uk: { правда: true, брехня: false },
      ar: { صحيح: true, خطأ: false },
      hi: { सही: true, गलत: false },
      th: { จริง: true, เท็จ: false },
      ko: { 참: true, 거짓: false },
      "zh-CN": { 真: true, 假: false },
      "zh-TW": { 真: true, 假: false },
      ja: { 正しい: true, 間違い: false },
    };

    const langMapping = mapping[language] || mapping["en"];
    const normalized = learnerChoice.trim().toLowerCase();

    return langMapping[normalized] === undefined
      ? undefined
      : langMapping[normalized];
  }

  /**
   * Normalize text for comparison (lowercase, trim, remove punctuation)
   * @param text Text to normalize
   * @returns Normalized text
   */
  normalizeText(text: string): string {
    return text
      .trim()
      .toLowerCase()

      .replaceAll(/[!,.،؛؟]/g, "");
  }
}
