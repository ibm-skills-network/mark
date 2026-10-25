//! Grading feedback text in the six languages the legacy backend localises
//! (`localization.service.ts`). Strings are copied verbatim; feedback
//! already stored by the legacy backend is compared against them.

use crate::js;

/// The template for `key` in `language` (exact code, else English), with
/// `{name}` placeholders replaced in order as the legacy backend does. An
/// unknown key is returned as is.
pub fn localized(key: &str, language: Option<&str>, placeholders: &[(&str, &str)]) -> String {
    let table = match language.unwrap_or("en") {
        "ar" => AR,
        "id" => ID,
        "de" => DE,
        "es" => ES,
        "fr" => FR,
        _ => EN,
    };
    let mut text = table
        .iter()
        .find(|(k, _)| *k == key)
        .map_or(key, |(_, v)| *v)
        .to_owned();
    for (name, value) in placeholders {
        text = js::replace_all(&text, &format!("{{{name}}}"), value);
    }
    text
}

const EN: &[(&str, &str)] = &[
    (
        "noResponse",
        "You did not provide a response to this question.",
    ),
    (
        "expectedTextResponse",
        "Expected a text response, but did not receive one.",
    ),
    (
        "expectedUrlResponse",
        "Expected a URL response, but did not receive one.",
    ),
    ("invalidUrl", "Invalid URL: {url}"),
    (
        "unableToFetchUrl",
        "Unable to fetch content from URL: {url}",
    ),
    (
        "expectedTrueFalse",
        "Expected a true/false response, but did not receive one.",
    ),
    ("invalidTrueFalse", "Invalid true/false response."),
    ("correctTF", "Correct! Your answer is right."),
    (
        "incorrectTF",
        "Incorrect. The correct answer is {correctAnswer}.",
    ),
    ("incorrectTFNoAnswer", "Incorrect."),
    ("correctAnswerTF", "The correct answer is {correctAnswer}."),
    ("true", "True"),
    ("false", "False"),
    (
        "correctSelection",
        "**Correct selection:** {learnerChoice} (+{points} points)",
    ),
    (
        "incorrectSelection",
        "**Incorrect selection:** {learnerChoice} (-{points} points)",
    ),
    ("invalidSelection", "**Invalid selection:** {learnerChoice}"),
    ("noOptionSelected", "**You didn't select any option.**"),
    (
        "correctOptions",
        "The correct option(s) were: **{correctOptions}**.",
    ),
    (
        "allCorrectSelected",
        "**You selected all correct options!**",
    ),
];

const AR: &[(&str, &str)] = &[
    ("noResponse", "لم تقدم إجابة على هذا السؤال."),
    (
        "expectedTextResponse",
        "كان من المتوقع الحصول على نص، ولكن لم يتم الحصول عليه.",
    ),
    (
        "expectedUrlResponse",
        "كان من المتوقع الحصول على رابط، ولكن لم يتم الحصول عليه.",
    ),
    ("invalidUrl", "رابط غير صالح: {url}"),
    (
        "unableToFetchUrl",
        "غير قادر على جلب المحتوى من الرابط: {url}",
    ),
    (
        "expectedTrueFalse",
        "كان من المتوقع الحصول على إجابة صحيحة/خاطئة، ولكن لم يتم الحصول عليها.",
    ),
    ("invalidTrueFalse", "إجابة صحيحة/خاطئة غير صالحة."),
    ("correctTF", "صحيح! إجابتك صحيحة."),
    ("incorrectTF", "خطأ. الإجابة الصحيحة هي {correctAnswer}."),
    ("incorrectTFNoAnswer", "خطأ."),
    ("correctAnswerTF", "الإجابة الصحيحة هي {correctAnswer}."),
    ("true", "صحيح"),
    ("false", "خطأ"),
    (
        "correctSelection",
        "**الاختيار الصحيح:** {learnerChoice} (+{points} نقطة)",
    ),
    (
        "incorrectSelection",
        "**الاختيار غير الصحيح:** {learnerChoice} (-{points} نقطة)",
    ),
    ("invalidSelection", "**الاختيار غير صالح:** {learnerChoice}"),
    ("noOptionSelected", "**لم تختر أي خيار.**"),
    (
        "correctOptions",
        "الخيارات الصحيحة هي: **{correctOptions}**.",
    ),
    ("allCorrectSelected", "**لقد اخترت جميع الخيارات الصحيحة!**"),
];

const ID: &[(&str, &str)] = &[
    (
        "noResponse",
        "Anda tidak memberikan jawaban untuk pertanyaan ini.",
    ),
    (
        "expectedTextResponse",
        "Diharapkan respons teks, tetapi tidak diterima.",
    ),
    (
        "expectedUrlResponse",
        "Diharapkan respons URL, tetapi tidak diterima.",
    ),
    ("invalidUrl", "URL tidak valid: {url}"),
    (
        "unableToFetchUrl",
        "Tidak dapat mengambil konten dari URL: {url}",
    ),
    (
        "expectedTrueFalse",
        "Diharapkan jawaban benar/salah, tetapi tidak diterima.",
    ),
    ("invalidTrueFalse", "Jawaban benar/salah tidak valid."),
    ("correctTF", "Benar! Jawaban Anda benar."),
    (
        "incorrectTF",
        "Salah. Jawaban yang benar adalah {correctAnswer}.",
    ),
    ("incorrectTFNoAnswer", "Salah."),
    (
        "correctAnswerTF",
        "Jawaban yang benar adalah {correctAnswer}.",
    ),
    ("true", "Benar"),
    ("false", "Salah"),
    (
        "correctSelection",
        "**Pilihan benar:** {learnerChoice} (+{points} poin)",
    ),
    (
        "incorrectSelection",
        "**Pilihan salah:** {learnerChoice} (-{points} poin)",
    ),
    (
        "invalidSelection",
        "**Pilihan tidak valid:** {learnerChoice}",
    ),
    ("noOptionSelected", "**Anda tidak memilih opsi apa pun.**"),
    (
        "correctOptions",
        "Opsi yang benar adalah: **{correctOptions}**.",
    ),
    (
        "allCorrectSelected",
        "**Anda memilih semua opsi yang benar!**",
    ),
];

const DE: &[(&str, &str)] = &[
    (
        "noResponse",
        "Sie haben keine Antwort auf diese Frage gegeben.",
    ),
    (
        "expectedTextResponse",
        "Eine Textantwort wurde erwartet, aber nicht erhalten.",
    ),
    (
        "expectedUrlResponse",
        "Eine URL-Antwort wurde erwartet, aber nicht erhalten.",
    ),
    ("invalidUrl", "Ungültige URL: {url}"),
    (
        "unableToFetchUrl",
        "Inhalt von URL konnte nicht abgerufen werden: {url}",
    ),
    (
        "expectedTrueFalse",
        "Eine Ja/Nein-Antwort wurde erwartet, aber nicht erhalten.",
    ),
    ("invalidTrueFalse", "Ungültige Ja/Nein-Antwort."),
    ("correctTF", "Richtig! Ihre Antwort ist korrekt."),
    (
        "incorrectTF",
        "Falsch. Die richtige Antwort ist {correctAnswer}.",
    ),
    ("incorrectTFNoAnswer", "Falsch."),
    (
        "correctAnswerTF",
        "Die richtige Antwort ist {correctAnswer}.",
    ),
    ("true", "Wahr"),
    ("false", "Falsch"),
    (
        "correctSelection",
        "**Richtige Auswahl:** {learnerChoice} (+{points} Punkte)",
    ),
    (
        "incorrectSelection",
        "**Falsche Auswahl:** {learnerChoice} (-{points} Punkte)",
    ),
    ("invalidSelection", "**Ungültige Auswahl:** {learnerChoice}"),
    ("noOptionSelected", "**Sie haben keine Option ausgewählt.**"),
    (
        "correctOptions",
        "Die richtige(n) Option(en) waren: **{correctOptions}**.",
    ),
    (
        "allCorrectSelected",
        "**Sie haben alle richtigen Optionen ausgewählt!**",
    ),
];

const ES: &[(&str, &str)] = &[
    (
        "noResponse",
        "No proporcionaste una respuesta a esta pregunta.",
    ),
    (
        "expectedTextResponse",
        "Se esperaba una respuesta de texto, pero no se recibió.",
    ),
    (
        "expectedUrlResponse",
        "Se esperaba una respuesta URL, pero no se recibió.",
    ),
    ("invalidUrl", "URL inválida: {url}"),
    (
        "unableToFetchUrl",
        "No se pudo obtener contenido de la URL: {url}",
    ),
    (
        "expectedTrueFalse",
        "Se esperaba una respuesta verdadero/falso, pero no se recibió.",
    ),
    ("invalidTrueFalse", "Respuesta verdadero/falso inválida."),
    ("correctTF", "¡Correcto! Tu respuesta es correcta."),
    (
        "incorrectTF",
        "Incorrecto. La respuesta correcta es {correctAnswer}.",
    ),
    ("incorrectTFNoAnswer", "Incorrecto."),
    (
        "correctAnswerTF",
        "La respuesta correcta es {correctAnswer}.",
    ),
    ("true", "Verdadero"),
    ("false", "Falso"),
    (
        "correctSelection",
        "**Selección correcta:** {learnerChoice} (+{points} puntos)",
    ),
    (
        "incorrectSelection",
        "**Selección incorrecta:** {learnerChoice} (-{points} puntos)",
    ),
    (
        "invalidSelection",
        "**Selección inválida:** {learnerChoice}",
    ),
    ("noOptionSelected", "**No seleccionaste ninguna opción.**"),
    (
        "correctOptions",
        "La(s) opción(es) correcta(s) eran: **{correctOptions}**.",
    ),
    (
        "allCorrectSelected",
        "**¡Seleccionaste todas las opciones correctas!**",
    ),
];

const FR: &[(&str, &str)] = &[
    ("noResponse", "Vous n'avez pas répondu à cette question."),
    (
        "expectedTextResponse",
        "Une réponse texte était attendue, mais non reçue.",
    ),
    (
        "expectedUrlResponse",
        "Une réponse URL était attendue, mais non reçue.",
    ),
    ("invalidUrl", "URL invalide: {url}"),
    (
        "unableToFetchUrl",
        "Impossible de récupérer le contenu de l'URL: {url}",
    ),
    (
        "expectedTrueFalse",
        "Une réponse vrai/faux était attendue, mais non reçue.",
    ),
    ("invalidTrueFalse", "Réponse vrai/faux invalide."),
    ("correctTF", "Correct ! Votre réponse est juste."),
    (
        "incorrectTF",
        "Incorrect. La bonne réponse est {correctAnswer}.",
    ),
    ("incorrectTFNoAnswer", "Incorrect."),
    ("correctAnswerTF", "La bonne réponse est {correctAnswer}."),
    ("true", "Vrai"),
    ("false", "Faux"),
    (
        "correctSelection",
        "**Sélection correcte:** {learnerChoice} (+{points} points)",
    ),
    (
        "incorrectSelection",
        "**Sélection incorrecte:** {learnerChoice} (-{points} points)",
    ),
    (
        "invalidSelection",
        "**Sélection invalide:** {learnerChoice}",
    ),
    (
        "noOptionSelected",
        "**Vous n'avez sélectionné aucune option.**",
    ),
    (
        "correctOptions",
        "Les options correctes étaient: **{correctOptions}**.",
    ),
    (
        "allCorrectSelected",
        "**Vous avez sélectionné toutes les options correctes !**",
    ),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn falls_back_to_english_and_to_the_key() {
        assert_eq!(
            localized("noResponse", Some("zh-CN"), &[]),
            "You did not provide a response to this question."
        );
        assert_eq!(
            localized("noResponse", Some("FR"), &[]),
            localized("noResponse", None, &[])
        );
        assert_eq!(
            localized("tooManyChoicesSelected", Some("fr"), &[]),
            "tooManyChoicesSelected"
        );
        assert_eq!(localized("incorrectTFNoAnswer", Some("de"), &[]), "Falsch.");
    }

    #[test]
    fn placeholders_replace_every_occurrence() {
        assert_eq!(
            localized(
                "correctSelection",
                Some("es"),
                &[("learnerChoice", "A"), ("points", "2")]
            ),
            "**Selección correcta:** A (+2 puntos)"
        );
        assert_eq!(
            localized("correctOptions", Some("ar"), &[("correctOptions", "a, b")]),
            "الخيارات الصحيحة هي: **a, b**."
        );
    }

    #[test]
    fn every_language_has_every_key() {
        for table in [AR, ID, DE, ES, FR] {
            assert_eq!(table.len(), EN.len());
            for ((a, _), (b, _)) in EN.iter().zip(table.iter()) {
                assert_eq!(a, b);
            }
        }
    }
}
