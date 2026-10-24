//! Building `questions[]` for `GET .../attempts/{attemptId}`: the frozen
//! variant and choice order, translations for the requested family, and
//! learner stripping. Pure; the handler loads the rows.

use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};
use serde_json::Value;

use crate::choices::{self, LearnerChoice};
use crate::params::Lang;
use crate::store::{FrozenSelectionRow, SourceQuestion, TranslationRow, VariantRow};
use crate::translation;

/// Whether `isCorrect`/`feedback` may be shown: only once submitted, and
/// then per `correctAnswerVisibility` (`ON_PASS`: grade >= passingGrade/100).
pub fn reveal_answers(
    submitted: bool,
    visibility: &str,
    grade: Option<f64>,
    passing_grade: i32,
) -> bool {
    if !submitted {
        return false;
    }
    match visibility {
        "ALWAYS" => true,
        "ON_PASS" => grade.unwrap_or(0.0) >= f64::from(passing_grade) / 100.0,
        _ => false,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionTranslation {
    pub translated_text: String,
    pub translated_choices: Option<Vec<LearnerChoice>>,
}

/// String-keyed map that serialises in insertion order.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct OrderedMap<T>(pub Vec<(String, T)>);

impl<T> OrderedMap<T> {
    /// Insert or replace in place (JS object spread semantics).
    fn upsert(&mut self, key: String, value: T) {
        if let Some(slot) = self.0.iter_mut().find(|(k, _)| *k == key) {
            slot.1 = value;
        } else {
            self.0.push((key, value));
        }
    }
}

impl<T: Serialize> Serialize for OrderedMap<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 {
            map.serialize_entry(k, v)?;
        }
        map.end()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptQuestion {
    pub id: i32,
    pub question: String,
    #[serde(rename = "type")]
    pub question_type: String,
    pub response_type: Option<String>,
    pub choices: Vec<LearnerChoice>,
    pub translations: OrderedMap<QuestionTranslation>,
    pub author_comment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_words: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_characters: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scoring: Option<Value>,
    pub total_points: i32,
    pub assignment_id: i32,
    pub grading_context_question_ids: Vec<i32>,
    pub is_deleted: bool,
    pub randomized_choices: Option<Vec<LearnerChoice>>,
    pub video_presentation_config: Option<Value>,
    pub live_recording_config: Option<Value>,
}

/// Stored translated content keyed by code, `en*` already removed.
#[derive(Debug, Clone, Default)]
struct StoredTranslations(Vec<(String, String, Option<Vec<Value>>)>);

impl StoredTranslations {
    fn collect<'a>(rows: impl Iterator<Item = &'a TranslationRow>, lang: &Lang) -> Self {
        let mut out: Vec<(String, String, Option<Vec<Value>>)> = Vec::new();
        for row in rows {
            if translation::is_authored_code(&row.language_code)
                || translation::family_of(&row.language_code) != lang.family
            {
                continue;
            }
            let entry = (
                row.language_code.clone(),
                row.translated_text.clone(),
                choices::parse_optional_choices(row.translated_choices.as_ref()),
            );
            // Later rows win, as the legacy map assignment did.
            if let Some(slot) = out.iter_mut().find(|(c, _, _)| *c == row.language_code) {
                *slot = entry;
            } else {
                out.push(entry);
            }
        }
        Self(out)
    }

    fn pick(&self, lang: &Lang) -> Option<&(String, String, Option<Vec<Value>>)> {
        let codes: Vec<&str> = self.0.iter().map(|(c, _, _)| c.as_str()).collect();
        translation::pick(&codes, &lang.code).map(|i| &self.0[i])
    }

    /// Put translated choices in the attempt's frozen order (same-length
    /// lists only).
    fn reorder(&mut self, perm: Option<&[usize]>, base_len: usize) {
        let Some(perm) = perm else { return };
        for (_, _, choices) in &mut self.0 {
            if let Some(list) = choices.as_ref().filter(|l| l.len() == base_len) {
                if let Some(ordered) = choices::reorder(list, perm) {
                    *choices = Some(ordered);
                }
            }
        }
    }

    fn sanitized(&self, reveal: bool) -> OrderedMap<QuestionTranslation> {
        OrderedMap(
            self.0
                .iter()
                .map(|(code, text, choices)| {
                    (
                        code.clone(),
                        QuestionTranslation {
                            translated_text: text.clone(),
                            translated_choices: choices
                                .as_ref()
                                .map(|c| choices::sanitize(c, reveal)),
                        },
                    )
                })
                .collect(),
        )
    }
}

/// The variant's scoring, else the question's; omitted unless it is an
/// object. Rubrics are stripped unless `showRubricsToLearner` is true.
fn learner_scoring(variant: Option<&Value>, question: Option<&Value>) -> Option<Value> {
    let mut scoring =
        choices::parse_json_value(variant).or_else(|| choices::parse_json_value(question))?;
    let obj = scoring.as_object_mut()?;
    if obj.get("showRubricsToLearner") != Some(&Value::Bool(true)) {
        obj.remove("rubrics");
    }
    Some(scoring)
}

fn object_or_null(value: Option<&Value>) -> Option<Value> {
    choices::parse_json_value(value).filter(Value::is_object)
}

/// Everything the builder needs besides the rows.
#[derive(Debug, Clone)]
pub struct ViewContext<'a> {
    pub assignment_id: i32,
    pub lang: &'a Lang,
    pub reveal: bool,
    pub question_order: &'a [i32],
}

fn translations_for(rows: &[TranslationRow], key: Key) -> impl Iterator<Item = &TranslationRow> {
    rows.iter().filter(move |r| match key {
        Key::Variant(id) => r.variant_id == Some(id),
        Key::Question(id) => r.variant_id.is_none() && r.question_id == Some(id),
    })
}

#[derive(Debug, Clone, Copy)]
enum Key {
    Variant(i32),
    Question(i32),
}

fn authored_choices(q: &SourceQuestion) -> Value {
    // Authored choices parsed with a [] fallback (legacy parseJsonValue).
    choices::parse_json_value(q.choices.as_ref()).unwrap_or(Value::Array(Vec::new()))
}

/// Variant choices when the variant has any truthy value, else authored.
fn base_choices(q: &SourceQuestion, variant: Option<&VariantRow>) -> Vec<Value> {
    let authored = authored_choices(q);
    let variant_choices = variant.and_then(|v| v.choices.as_ref()).filter(|c| {
        !matches!(c, Value::Null | Value::Bool(false)) && *c != &Value::String(String::new())
    });
    choices::parse_choices(variant_choices.or(Some(&authored)))
}

fn frozen_question(
    q: &SourceQuestion,
    sel: &FrozenSelectionRow,
    rows: &[TranslationRow],
    ctx: &ViewContext<'_>,
) -> AttemptQuestion {
    let variant = sel.variant.as_ref();
    let mut variant_tr = variant
        .map(|v| StoredTranslations::collect(translations_for(rows, Key::Variant(v.id)), ctx.lang))
        .unwrap_or_default();
    let mut question_tr =
        StoredTranslations::collect(translations_for(rows, Key::Question(q.id)), ctx.lang);

    let base = base_choices(q, variant);
    let frozen = choices::parse_frozen(sel.randomized_choices.as_ref());
    let perm = frozen.as_ref().map(|f| choices::permutation(&base, f));
    let full_perm = perm.as_deref().filter(|p| p.len() == base.len());
    let final_choices = full_perm
        .and_then(|p| choices::reorder(&base, p))
        .unwrap_or_else(|| base.clone());

    variant_tr.reorder(full_perm, base.len());
    question_tr.reorder(full_perm, base.len());

    let stored = variant_tr
        .pick(ctx.lang)
        .or_else(|| question_tr.pick(ctx.lang))
        .cloned();
    let (text, shown_choices) = match stored {
        Some((_, text, translated)) => (text, translated.unwrap_or_else(|| final_choices.clone())),
        None => {
            let authored_text = variant
                .map(|v| v.variant_content.clone())
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| q.question.clone());
            (authored_text, final_choices.clone())
        }
    };

    let mut merged = question_tr.sanitized(ctx.reveal);
    for (code, value) in variant_tr.sanitized(ctx.reveal).0 {
        merged.upsert(code, value);
    }

    // The frozen list itself, carrying isCorrect/feedback only when revealed.
    let randomized_choices = frozen
        .as_ref()
        .filter(|f| !f.is_empty())
        .map(|f| choices::sanitize(f, ctx.reveal));

    AttemptQuestion {
        id: q.id,
        question: text,
        question_type: q.question_type.clone(),
        response_type: q.response_type.clone(),
        choices: choices::sanitize(&shown_choices, false),
        translations: merged,
        author_comment: None,
        max_words: variant.and_then(|v| v.max_words).or(q.max_words),
        max_characters: variant.and_then(|v| v.max_characters).or(q.max_characters),
        scoring: learner_scoring(variant.and_then(|v| v.scoring.as_ref()), q.scoring.as_ref()),
        total_points: q.total_points,
        assignment_id: ctx.assignment_id,
        grading_context_question_ids: q.grading_context_question_ids.clone(),
        is_deleted: q.is_deleted,
        randomized_choices,
        video_presentation_config: object_or_null(q.video_presentation_config.as_ref()),
        live_recording_config: object_or_null(q.live_recording_config.as_ref()),
    }
}

fn unfrozen_question(
    q: &SourceQuestion,
    rows: &[TranslationRow],
    ctx: &ViewContext<'_>,
) -> AttemptQuestion {
    let question_tr =
        StoredTranslations::collect(translations_for(rows, Key::Question(q.id)), ctx.lang);
    let stored = question_tr.pick(ctx.lang);
    let shown = match stored.and_then(|(_, _, c)| c.clone()) {
        Some(translated) => translated,
        None => choices::parse_choices(Some(&authored_choices(q))),
    };
    let text = stored
        .map(|(_, t, _)| t.clone())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| q.question.clone());
    AttemptQuestion {
        id: q.id,
        question: text,
        question_type: q.question_type.clone(),
        response_type: q.response_type.clone(),
        choices: choices::sanitize(&shown, false),
        translations: question_tr.sanitized(ctx.reveal),
        author_comment: None,
        max_words: q.max_words,
        max_characters: q.max_characters,
        scoring: learner_scoring(None, q.scoring.as_ref()),
        total_points: q.total_points,
        assignment_id: ctx.assignment_id,
        grading_context_question_ids: q.grading_context_question_ids.clone(),
        is_deleted: q.is_deleted,
        randomized_choices: None,
        video_presentation_config: object_or_null(q.video_presentation_config.as_ref()),
        live_recording_config: object_or_null(q.live_recording_config.as_ref()),
    }
}

/// Questions with a frozen selection row come first (in row order), then
/// the rest; the result follows `question_order` when it is non-empty
/// (ids not listed are dropped).
pub fn build_questions(
    sources: &[SourceQuestion],
    selections: &[FrozenSelectionRow],
    translations: &[TranslationRow],
    ctx: &ViewContext<'_>,
) -> Vec<AttemptQuestion> {
    let rows: &[TranslationRow] = if ctx.lang.is_authored() {
        &[]
    } else {
        translations
    };
    let mut all: Vec<AttemptQuestion> = selections
        .iter()
        .filter_map(|sel| {
            let q = sources.iter().find(|q| q.id == sel.question_id)?;
            Some(frozen_question(q, sel, rows, ctx))
        })
        .collect();
    all.extend(
        sources
            .iter()
            .filter(|q| !selections.iter().any(|s| s.question_id == q.id))
            .map(|q| unfrozen_question(q, rows, ctx)),
    );
    if ctx.question_order.is_empty() {
        return all;
    }
    ctx.question_order
        .iter()
        .filter_map(|id| all.iter().find(|q| q.id == *id).cloned())
        .collect()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn source(id: i32, choices: Value) -> SourceQuestion {
        SourceQuestion {
            id,
            question: format!("Q{id}"),
            question_type: "SINGLE_CORRECT".into(),
            total_points: 2,
            max_words: Some(0),
            scoring: Some(
                json!({"type": "CRITERIA_BASED", "showRubricsToLearner": false, "rubrics": [{"rubricQuestion": "r", "criteria": []}]}),
            ),
            choices: Some(choices),
            randomized_choices: Some(true),
            ..SourceQuestion::default()
        }
    }

    fn abc() -> Value {
        json!([
            {"id": 1, "choice": "a", "isCorrect": true, "points": 1, "feedback": "right"},
            {"id": 2, "choice": "b", "isCorrect": false, "points": 0, "feedback": "wrong"},
            {"id": 3, "choice": "c", "isCorrect": false, "points": 0, "feedback": null}
        ])
    }

    fn frozen(question_id: i32, order: &[i32]) -> FrozenSelectionRow {
        let list: Vec<Value> = order
            .iter()
            .map(|i| json!({"id": i, "choice": "x", "isCorrect": true}))
            .collect();
        FrozenSelectionRow {
            question_id,
            randomized_choices: Some(Value::String(Value::Array(list).to_string())),
            variant: None,
        }
    }

    fn tr(question_id: i32, code: &str, choices: Option<Value>) -> TranslationRow {
        TranslationRow {
            question_id: Some(question_id),
            variant_id: None,
            language_code: code.into(),
            translated_text: format!("{code} text"),
            translated_choices: choices,
        }
    }

    fn build(
        lang: &str,
        reveal: bool,
        order: &[i32],
        translations: &[TranslationRow],
    ) -> Vec<AttemptQuestion> {
        let lang = Lang::from_query(Some(&format!("lang={lang}")));
        let sources = vec![source(10, abc()), source(11, abc())];
        let selections = vec![frozen(10, &[3, 1, 2])];
        build_questions(
            &sources,
            &selections,
            translations,
            &ViewContext {
                assignment_id: 7,
                lang: &lang,
                reveal,
                question_order: order,
            },
        )
    }

    #[test]
    fn frozen_order_and_stripping() {
        let qs = build("en", false, &[11, 10], &[]);
        assert_eq!(qs.iter().map(|q| q.id).collect::<Vec<_>>(), vec![11, 10]);
        let q10 = serde_json::to_value(&qs[1]).unwrap();
        assert_eq!(
            q10["choices"],
            json!([{"id": 3, "choice": "c"}, {"id": 1, "choice": "a"}, {"id": 2, "choice": "b"}])
        );
        assert_eq!(
            q10["randomizedChoices"],
            json!([{"id": 3, "choice": "x"}, {"id": 1, "choice": "x"}, {"id": 2, "choice": "x"}])
        );
        assert_eq!(q10["responseType"], Value::Null);
        assert_eq!(q10["videoPresentationConfig"], Value::Null);
        assert_eq!(q10["authorComment"], Value::Null);
        assert_eq!(q10["translations"], json!({}));
        assert!(q10.get("answer").is_none());
        assert_eq!(q10["maxWords"], 0);
        assert!(q10.get("maxCharacters").is_none());
        assert!(q10["scoring"].get("rubrics").is_none());
        assert_eq!(q10["assignmentId"], 7);
        // Unfrozen questions keep authored order and have no frozen order.
        let q11 = serde_json::to_value(&qs[0]).unwrap();
        assert_eq!(q11["choices"][0]["id"], 1);
        assert_eq!(q11["randomizedChoices"], Value::Null);
        assert!(!q11.to_string().contains("isCorrect"));
        assert!(!q11.to_string().contains("points"));
    }

    #[test]
    fn revealed_after_submission_only() {
        assert!(!reveal_answers(false, "ALWAYS", Some(1.0), 50));
        assert!(reveal_answers(true, "ALWAYS", None, 50));
        assert!(!reveal_answers(true, "NEVER", Some(1.0), 50));
        assert!(reveal_answers(true, "ON_PASS", Some(0.29), 29));
        assert!(!reveal_answers(true, "ON_PASS", Some(0.28), 29));
        assert!(!reveal_answers(true, "ON_PASS", None, 1));
        let qs = build("en", true, &[], &[]);
        let q10 = serde_json::to_value(&qs[0]).unwrap();
        // choices[] never carry the answer key; the frozen list does once revealed.
        assert_eq!(q10["choices"][0], json!({"id": 3, "choice": "c"}));
        assert_eq!(
            q10["randomizedChoices"][0],
            json!({"id": 3, "choice": "x", "isCorrect": true})
        );
        assert!(!q10.to_string().contains("points"));
        let hidden = serde_json::to_value(&build("en", false, &[], &[])[0]).unwrap();
        assert!(!hidden.to_string().contains("isCorrect"));
    }

    #[test]
    fn translations_follow_family_and_frozen_order() {
        let rows = vec![
            tr(
                10,
                "fr",
                Some(
                    json!([{"id": 1, "choice": "A"}, {"id": 2, "choice": "B"}, {"id": 3, "choice": "C"}]),
                ),
            ),
            tr(10, "fr-CA", None),
            tr(10, "en", Some(json!([{"id": 1, "choice": "paraphrase"}]))),
            tr(10, "de", None),
            tr(11, "fr-CA", Some(json!("[{\"id\":1,\"choice\":\"Un\"}]"))),
        ];
        let qs = build("fr-ca", false, &[], &rows);
        let q10 = serde_json::to_value(&qs[0]).unwrap();
        // fr-CA is the exact match; it has no choices so the frozen authored order shows.
        assert_eq!(q10["question"], "fr-CA text");
        assert_eq!(q10["choices"][0], json!({"id": 3, "choice": "c"}));
        assert_eq!(
            q10["translations"],
            json!({
                "fr": {"translatedText": "fr text", "translatedChoices": [
                    {"id": 3, "choice": "C"}, {"id": 1, "choice": "A"}, {"id": 2, "choice": "B"}]},
                "fr-CA": {"translatedText": "fr-CA text", "translatedChoices": null}
            })
        );
        let q11 = serde_json::to_value(&qs[1]).unwrap();
        assert_eq!(q11["question"], "fr-CA text");
        assert_eq!(q11["choices"], json!([{"id": 1, "choice": "Un"}]));

        // fr (base) picked for fr-be; English rows never served.
        let qs = build("fr-be", false, &[], &rows);
        assert_eq!(qs[0].question, "fr text");
        assert_eq!(qs[0].choices[0].choice, "C");
        let qs = build("en", false, &[], &rows);
        assert_eq!(qs[0].question, "Q10");
        assert!(qs[0].translations.0.is_empty());
    }

    #[test]
    fn variant_content_and_translations_win() {
        let lang = Lang::from_query(Some("lang=fr"));
        let sources = vec![source(10, abc())];
        let selections = vec![FrozenSelectionRow {
            question_id: 10,
            randomized_choices: Some(Value::String("[]".into())),
            variant: Some(VariantRow {
                id: 99,
                variant_content: "Variant text".into(),
                choices: Some(json!([{"id": 1, "choice": "va"}])),
                max_words: Some(50),
                max_characters: None,
                scoring: Some(
                    json!({"type": "CRITERIA_BASED", "showRubricsToLearner": true, "rubrics": [1]}),
                ),
            }),
        }];
        let ctx = ViewContext {
            assignment_id: 7,
            lang: &lang,
            reveal: false,
            question_order: &[],
        };
        let qs = build_questions(&sources, &selections, &[], &ctx);
        assert_eq!(qs[0].question, "Variant text");
        assert_eq!(qs[0].choices[0].choice, "va");
        assert_eq!(qs[0].max_words, Some(50));
        assert_eq!(qs[0].scoring.as_ref().unwrap()["rubrics"], json!([1]));
        assert_eq!(qs[0].randomized_choices, None);

        let rows = vec![
            TranslationRow {
                question_id: Some(10),
                variant_id: Some(99),
                language_code: "fr".into(),
                translated_text: "VT".into(),
                translated_choices: None,
            },
            tr(10, "fr", None),
        ];
        let qs = build_questions(&sources, &selections, &rows, &ctx);
        assert_eq!(qs[0].question, "VT");
        assert_eq!(qs[0].translations.0.len(), 1);
        assert_eq!(qs[0].translations.0[0].1.translated_text, "VT");
    }
}
