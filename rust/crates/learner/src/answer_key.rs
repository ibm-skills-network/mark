//! The answer-key sentences on `MULTIPLE_CORRECT` and `TRUE_FALSE` feedback
//! ("The correct option(s) were: ...", "The correct answer is True."). The
//! grader never stores them; they are appended when a result is read with
//! the answer key revealed, and removed (also from older stored rows) while
//! it is hidden.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Map, Value};

use crate::localization::localized;

const CORRECT_OPTIONS_KEY: &str = "correctOptions";
const CORRECT_OPTIONS_PLACEHOLDER: &str = "{correctOptions}";
const TRUE_FALSE_ANSWER_KEY: &str = "correctAnswerTF";
const TRUE_FALSE_PLACEHOLDER: &str = "{correctAnswer}";

/// Every language the sentences are written in.
const SENTENCE_LANGUAGES: [&str; 6] = ["en", "ar", "id", "de", "es", "fr"];

/// ECMAScript `\s`.
const JS_WHITESPACE_CLASS: &str = r"[\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";
/// ECMAScript `.` without the `s` flag.
const JS_DOT_CLASS: &str = r"[^\n\r\x{2028}\x{2029}]";

/// One pattern per distinct localized template, matching the sentence
/// whatever its placeholder held, with the whitespace before it.
fn patterns_for(key: &str, placeholder: &str) -> Vec<Regex> {
    let mut templates: Vec<String> = Vec::new();
    for language in SENTENCE_LANGUAGES {
        let template = localized(key, Some(language), &[]);
        if template.contains(placeholder) && !templates.contains(&template) {
            templates.push(template);
        }
    }
    templates
        .iter()
        .filter_map(|template| {
            let mut parts = template.split(placeholder);
            let before = parts.next().unwrap_or("");
            let after = parts.next().unwrap_or("");
            Regex::new(&format!(
                "{JS_WHITESPACE_CLASS}*{}{JS_DOT_CLASS}*?{}",
                regex::escape(before),
                regex::escape(after)
            ))
            .ok()
        })
        .collect()
}

static CORRECT_OPTIONS_PATTERNS: LazyLock<Vec<Regex>> =
    LazyLock::new(|| patterns_for(CORRECT_OPTIONS_KEY, CORRECT_OPTIONS_PLACEHOLDER));
static TRUE_FALSE_PATTERNS: LazyLock<Vec<Regex>> =
    LazyLock::new(|| patterns_for(TRUE_FALSE_ANSWER_KEY, TRUE_FALSE_PLACEHOLDER));

/// "The correct option(s) were: **a, b**." in the learner's language.
pub fn correct_options_sentence(language: Option<&str>, options: &[String]) -> String {
    localized(
        CORRECT_OPTIONS_KEY,
        language,
        &[("correctOptions", &options.join(", "))],
    )
}

/// "The correct answer is True." in the learner's language.
pub fn true_false_sentence(language: Option<&str>, correct_answer: bool) -> String {
    let word = localized(if correct_answer { "true" } else { "false" }, language, &[]);
    localized(TRUE_FALSE_ANSWER_KEY, language, &[("correctAnswer", &word)])
}

fn text_entry(entry: &Value) -> Option<(&Map<String, Value>, &str)> {
    let map = entry.as_object()?;
    let text = map.get("feedback")?.as_str()?;
    Some((map, text))
}

fn with_feedback(map: &Map<String, Value>, text: String) -> Value {
    let mut copy = map.clone();
    copy.insert("feedback".to_owned(), Value::String(text));
    Value::Object(copy)
}

fn apply_sentence(
    feedback: &[Value],
    reveal: bool,
    sentence: Option<String>,
    patterns: &[Regex],
    separator: &str,
) -> Vec<Value> {
    if !reveal {
        return feedback
            .iter()
            .map(|entry| match text_entry(entry) {
                Some((map, text)) => {
                    let mut text = text.to_owned();
                    for pattern in patterns {
                        text = pattern.replace(&text, "").into_owned();
                    }
                    with_feedback(map, text)
                }
                None => entry.clone(),
            })
            .collect();
    }
    let Some(sentence) = sentence else {
        return feedback.to_vec();
    };
    let last = feedback
        .iter()
        .rposition(|entry| text_entry(entry).is_some());
    let Some(last) = last else {
        let mut out = feedback.to_vec();
        let mut entry = Map::new();
        entry.insert("feedback".to_owned(), Value::String(sentence));
        out.push(Value::Object(entry));
        return out;
    };
    feedback
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            if index != last {
                return entry.clone();
            }
            match text_entry(entry) {
                Some((_, text)) if patterns.iter().any(|p| p.is_match(text)) => entry.clone(),
                Some((map, text)) => with_feedback(map, format!("{text}{separator}{sentence}")),
                None => entry.clone(),
            }
        })
        .collect()
}

/// Multiple-correct feedback as the learner may see it.
pub fn apply_correct_options(
    feedback: &[Value],
    reveal: bool,
    perfect_score: Option<bool>,
    correct_options: &[String],
    language: Option<&str>,
) -> Vec<Value> {
    let sentence = (perfect_score == Some(false) && !correct_options.is_empty())
        .then(|| correct_options_sentence(language, correct_options));
    apply_sentence(feedback, reveal, sentence, &CORRECT_OPTIONS_PATTERNS, "\n")
}

/// True/false feedback as the learner may see it.
pub fn apply_true_false(
    feedback: &[Value],
    reveal: bool,
    is_correct: Option<bool>,
    correct_answer: Option<bool>,
    language: Option<&str>,
) -> Vec<Value> {
    let sentence = match (is_correct, correct_answer) {
        (Some(false), Some(answer)) => Some(true_false_sentence(language, answer)),
        _ => None,
    };
    apply_sentence(feedback, reveal, sentence, &TRUE_FALSE_PATTERNS, " ")
}

/// `correctChoices` from grading metadata: its string entries.
pub fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// Fresh grading metadata applied to its feedback: multiple-correct
/// responses carry `perfectScore`/`correctChoices`, true/false responses
/// `isCorrect`/`correctAnswer`. Anything else passes through.
pub fn apply_from_metadata(
    feedback: &[Value],
    metadata: Option<&Value>,
    reveal: bool,
    language: Option<&str>,
) -> Vec<Value> {
    let record = metadata.and_then(Value::as_object);
    let field = |key: &str| record.and_then(|m| m.get(key));
    let is_true_false = field("correctAnswer").is_some_and(Value::is_boolean);
    let is_multiple = field("perfectScore").is_some_and(Value::is_boolean);
    if is_true_false {
        return apply_true_false(
            feedback,
            reveal,
            field("isCorrect").and_then(Value::as_bool),
            field("correctAnswer").and_then(Value::as_bool),
            language,
        );
    }
    if is_multiple {
        return apply_correct_options(
            feedback,
            reveal,
            field("perfectScore").and_then(Value::as_bool),
            &string_list(field("correctChoices")),
            language,
        );
    }
    feedback.to_vec()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn opts(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn correct_options_sentence_in_every_language() {
        assert_eq!(
            correct_options_sentence(Some("en"), &opts(&["a", "b"])),
            "The correct option(s) were: **a, b**."
        );
        assert_eq!(
            correct_options_sentence(Some("de"), &opts(&["x"])),
            "Die richtige(n) Option(en) waren: **x**."
        );
        assert_eq!(
            correct_options_sentence(Some("pt"), &opts(&["x"])),
            "The correct option(s) were: **x**."
        );
        assert_eq!(
            true_false_sentence(Some("fr"), false),
            "La bonne réponse est Faux."
        );
        assert_eq!(
            true_false_sentence(None, true),
            "The correct answer is True."
        );
    }

    #[test]
    fn revealed_sentence_is_appended_to_the_last_text_entry() {
        let feedback = vec![json!({"choice": "a, c", "feedback": "x.\ny."})];
        let out = apply_correct_options(&feedback, true, Some(false), &opts(&["a", "b"]), None);
        assert_eq!(
            out,
            vec![
                json!({"choice": "a, c", "feedback": "x.\ny.\nThe correct option(s) were: **a, b**."})
            ]
        );
        // Already carrying it: unchanged.
        assert_eq!(
            apply_correct_options(&out, true, Some(false), &opts(&["a", "b"]), None),
            out
        );
        // Perfect score or nothing to name: unchanged.
        assert_eq!(
            apply_correct_options(&feedback, true, Some(true), &opts(&["a"]), None),
            feedback
        );
        assert_eq!(
            apply_correct_options(&feedback, true, Some(false), &[], None),
            feedback
        );
        // No text entry: a new entry is added.
        let out = apply_true_false(&[json!(5)], true, Some(false), Some(true), Some("es"));
        assert_eq!(
            out,
            vec![
                json!(5),
                json!({"feedback": "La respuesta correcta es Verdadero."})
            ]
        );
        // True/false joins with a space.
        let out = apply_true_false(
            &[json!({"feedback": "Incorrect.", "choice": false})],
            true,
            Some(false),
            Some(true),
            None,
        );
        assert_eq!(
            out,
            vec![json!({"feedback": "Incorrect. The correct answer is True.", "choice": false})]
        );
    }

    #[test]
    fn hidden_sentences_are_removed_in_any_language() {
        let stored = vec![
            json!({"choice": "a", "feedback": "x.\nLes options correctes étaient: **a**."}),
            json!({"feedback": "y. The correct option(s) were: **b, c**. tail"}),
            json!({"feedback": 3}),
        ];
        let out = apply_correct_options(&stored, false, Some(false), &opts(&["a"]), Some("en"));
        assert_eq!(
            out,
            vec![
                json!({"choice": "a", "feedback": "x."}),
                json!({"feedback": "y. tail"}),
                json!({"feedback": 3}),
            ]
        );
        let out = apply_true_false(
            &[json!({"feedback": "Falsch. Die richtige Antwort ist Wahr.", "choice": true})],
            false,
            Some(false),
            Some(false),
            None,
        );
        assert_eq!(out, vec![json!({"feedback": "Falsch.", "choice": true})]);
    }

    #[test]
    fn metadata_decides_which_sentence() {
        let feedback = vec![json!({"feedback": "Incorrect.", "choice": true})];
        let tf = json!({"isCorrect": false, "correctAnswer": false});
        assert_eq!(
            apply_from_metadata(&feedback, Some(&tf), true, Some("id"))[0]["feedback"],
            "Incorrect. Jawaban yang benar adalah Salah."
        );
        let mc = json!({"perfectScore": false, "correctChoices": ["a", 2, "b"]});
        assert_eq!(
            apply_from_metadata(&feedback, Some(&mc), true, None)[0]["feedback"],
            "Incorrect.\nThe correct option(s) were: **a, b**."
        );
        assert_eq!(apply_from_metadata(&feedback, None, true, None), feedback);
    }
}
