//! Which question row an attempt is graded and shown against
//! (`grading-question-source.util.ts`, `translation-language.util.ts`): the
//! attempt's pinned version row, else the live row; the drawn variant's
//! choices and scoring; the stored translation for a language.

use serde_json::Value;

use crate::grading::GradingQuestion;
use crate::store::{FrozenSelectionRow, GradingQuestionRow, QuestionTranslationRow};
use crate::translation;

/// Response types that are no longer graded.
pub const MEDIA_RESPONSE_TYPES: [&str; 4] = ["PRESENTATION", "VIDEO", "AUDIO", "LIVE_RECORDING"];

pub fn is_media_response_type(response_type: Option<&str>) -> bool {
    response_type.is_some_and(|t| MEDIA_RESPONSE_TYPES.contains(&t))
}

/// `parseJsonField`: absent, null or empty is `None`; a string is parsed
/// (`None` when it is not JSON); anything else is used as is.
pub fn parse_json_field(field: Option<&Value>) -> Option<Value> {
    match field? {
        Value::Null => None,
        Value::String(s) if s.is_empty() => None,
        Value::String(s) => serde_json::from_str(s).ok(),
        other => Some(other.clone()),
    }
}

/// Rows keyed by served id in first-seen order, a later row with the same
/// id replacing the earlier one in place (a JS `Map`).
pub fn keyed_by_served_id(rows: &[GradingQuestionRow]) -> Vec<&GradingQuestionRow> {
    let mut out: Vec<&GradingQuestionRow> = Vec::new();
    for row in rows {
        match out.iter_mut().find(|r| r.served_id() == row.served_id()) {
            Some(slot) => *slot = row,
            None => out.push(row),
        }
    }
    out
}

/// `findQuestionTranslation`: among `rows` (any languages), the one for this
/// question in `language`'s family, a variant's own row first.
pub fn find_translation<'a>(
    rows: &'a [QuestionTranslationRow],
    question_id: i32,
    variant_id: Option<i32>,
    language: &str,
) -> Option<&'a QuestionTranslationRow> {
    let family = language.trim().to_lowercase();
    let family = family.split('-').next().unwrap_or("").to_owned();
    let mut variants: Vec<(&str, &QuestionTranslationRow)> = Vec::new();
    let mut questions: Vec<(&str, &QuestionTranslationRow)> = Vec::new();
    for row in rows {
        let in_scope = row.question_id == Some(question_id)
            && (row.variant_id.is_none() || row.variant_id == variant_id)
            && row.language_code.to_lowercase().starts_with(&family);
        if !in_scope {
            continue;
        }
        let bucket = if row.variant_id.is_some() {
            &mut variants
        } else {
            &mut questions
        };
        match bucket
            .iter_mut()
            .find(|(code, _)| *code == row.language_code)
        {
            Some(slot) => slot.1 = row,
            None => bucket.push((row.language_code.as_str(), row)),
        }
    }
    let pick = |entries: &[(&str, &'a QuestionTranslationRow)]| {
        let codes: Vec<&str> = entries.iter().map(|(c, _)| *c).collect();
        translation::pick(&codes, language).map(|i| entries[i].1)
    };
    pick(&variants).or_else(|| pick(&questions))
}

/// The question as graded: the base row, the drawn variant's choices and
/// scoring, then the submit language's translated choices.
pub fn grading_question(
    base: &GradingQuestionRow,
    selection: Option<&FrozenSelectionRow>,
    translation: Option<&QuestionTranslationRow>,
) -> GradingQuestion {
    let mut choices = parse_json_field(base.choices.as_ref());
    let mut scoring = parse_json_field(base.scoring.as_ref());
    if let Some(variant) = selection.and_then(|s| s.variant.as_ref()) {
        choices = parse_json_field(variant.choices.as_ref()).or(choices);
        scoring = parse_json_field(variant.scoring.as_ref()).or(scoring);
    }
    if let Some(row) = translation {
        if let Some(translated) = row
            .translated_choices
            .as_ref()
            .filter(|v| crate::js::truthy(v))
        {
            choices = Some(match translated {
                Value::String(text) => {
                    serde_json::from_str(text).unwrap_or_else(|_| Value::Array(Vec::new()))
                }
                other => other.clone(),
            });
        }
    }
    GradingQuestion {
        id: base.served_id(),
        question_type: base.question_type.clone(),
        total_points: base.total_points,
        choices,
        scoring,
        grading_context_question_ids: base.grading_context_question_ids.clone(),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::store::VariantRow;
    use serde_json::json;

    fn tr(
        question_id: i32,
        variant_id: Option<i32>,
        code: &str,
        choices: Option<Value>,
    ) -> QuestionTranslationRow {
        QuestionTranslationRow {
            question_id: Some(question_id),
            variant_id,
            language_code: code.into(),
            translated_text: format!("{code}-{variant_id:?}"),
            translated_choices: choices,
            untranslated_choices: None,
        }
    }

    #[test]
    fn variant_translation_first_then_the_family() {
        let rows = vec![
            tr(1, None, "fr", None),
            tr(1, Some(9), "fr-CA", None),
            tr(1, Some(8), "fr", None),
            tr(2, None, "fr", None),
            tr(1, None, "de", None),
        ];
        assert_eq!(
            find_translation(&rows, 1, Some(9), "fr")
                .unwrap()
                .translated_text,
            "fr-CA-Some(9)"
        );
        assert_eq!(
            find_translation(&rows, 1, None, "fr-BE")
                .unwrap()
                .translated_text,
            "fr-None"
        );
        assert_eq!(find_translation(&rows, 1, None, "es"), None);
        assert_eq!(
            find_translation(&rows, 1, None, "DE")
                .unwrap()
                .translated_text,
            "de-None"
        );
    }

    #[test]
    fn variant_and_translation_override_choices() {
        let base = GradingQuestionRow {
            row_id: 5,
            question_id: Some(1),
            question_type: "SINGLE_CORRECT".into(),
            total_points: 3,
            choices: Some(json!("[{\"choice\":\"a\"}]")),
            scoring: Some(json!({"type": "CRITERIA_BASED"})),
            ..GradingQuestionRow::default()
        };
        let q = grading_question(&base, None, None);
        assert_eq!(q.id, 1);
        assert_eq!(q.choices, Some(json!([{"choice": "a"}])));
        let selection = FrozenSelectionRow {
            question_id: 1,
            randomized_choices: None,
            variant: Some(VariantRow {
                id: 9,
                variant_content: "v".into(),
                choices: Some(json!([{"choice": "v"}])),
                max_words: None,
                max_characters: None,
                scoring: Some(json!("")),
            }),
        };
        let q = grading_question(&base, Some(&selection), None);
        assert_eq!(q.choices, Some(json!([{"choice": "v"}])));
        assert_eq!(q.scoring, Some(json!({"type": "CRITERIA_BASED"})));
        let row = tr(1, None, "fr", Some(json!("not json")));
        assert_eq!(
            grading_question(&base, Some(&selection), Some(&row)).choices,
            Some(json!([]))
        );
        let row = tr(1, None, "fr", Some(json!("")));
        assert_eq!(
            grading_question(&base, Some(&selection), Some(&row)).choices,
            Some(json!([{"choice": "v"}]))
        );
        let version_only = GradingQuestionRow {
            question_id: None,
            ..base
        };
        assert_eq!(grading_question(&version_only, None, None).id, 5);
    }

    #[test]
    fn later_rows_replace_in_place() {
        let row = |row_id, question_id| GradingQuestionRow {
            row_id,
            question_id,
            ..GradingQuestionRow::default()
        };
        let rows = vec![row(1, Some(10)), row(2, Some(11)), row(3, Some(10))];
        let keyed: Vec<i32> = keyed_by_served_id(&rows).iter().map(|r| r.row_id).collect();
        assert_eq!(keyed, vec![3, 2]);
        assert!(is_media_response_type(Some("VIDEO")));
        assert!(!is_media_response_type(Some("CODE")));
        assert!(!is_media_response_type(None));
    }
}
