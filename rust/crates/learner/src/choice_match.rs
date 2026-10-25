//! Matching a submitted choice text to an authored choice
//! (`choice-renderings.util.ts`, `numeric-choice-text.util.ts` and the text
//! helpers of `choice-grading.strategy.ts`). The learner client submits the
//! text of whatever rendering it last showed (a translation, a randomized
//! order, a numeric-looking label rewritten by an older client), so a miss
//! against the grading set is looked up in every stored rendering.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use crate::js;

/// JS `\s+`.
static WHITESPACE_RUN: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"[\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+").ok()
});

fn strip_punctuation(s: &str) -> String {
    s.chars()
        .filter(|c| !matches!(c, '!' | ',' | '\u{60C}' | '\u{61B}' | '\u{61F}'))
        .collect()
}

/// `coerceToString` of the grading strategy.
pub fn coerce_to_string(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(v @ (Value::Number(_) | Value::Bool(_))) => js::to_string(Some(v)),
        Some(Value::Object(record)) => {
            for key in ["choice", "value", "label", "text", "name", "title"] {
                match record.get(key) {
                    None | Some(Value::Null) => {}
                    Some(Value::String(s)) => return s.clone(),
                    Some(v @ (Value::Number(_) | Value::Bool(_))) => return js::to_string(Some(v)),
                    Some(v @ (Value::Object(_) | Value::Array(_))) => {
                        let nested = coerce_to_string(Some(v));
                        if !nested.is_empty() {
                            return nested;
                        }
                    }
                }
            }
            // The first string value, if it is non-empty; an object's own
            // string form ("[object Object]") is never used.
            record
                .values()
                .find_map(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .unwrap_or_default()
        }
        Some(Value::Array(items)) => items
            .iter()
            .find_map(Value::as_str)
            .filter(|s| !s.is_empty())
            .map_or_else(
                || js::to_string(Some(&Value::Array(items.clone()))),
                str::to_owned,
            ),
    }
}

/// The grading strategy's `normalizeText`: trim, lower-case, drop `!` `,`
/// and the Arabic comma, semicolon and question mark.
pub fn normalize_text(value: Option<&Value>) -> String {
    let text = coerce_to_string(value);
    if text.is_empty() {
        return String::new();
    }
    strip_punctuation(&js::trim(&text).to_lowercase())
}

/// `normalizeText` for a plain string.
pub fn normalize_str(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    strip_punctuation(&js::trim(text).to_lowercase())
}

/// `normalizeChoiceText`: as above, strings and numbers only, whitespace
/// runs collapsed.
pub fn normalize_choice_text(value: Option<&Value>) -> String {
    let text = match value {
        Some(Value::String(s)) => s.clone(),
        Some(v @ Value::Number(_)) => js::to_string(Some(v)),
        _ => return String::new(),
    };
    let base = strip_punctuation(&js::trim(&text).to_lowercase());
    match WHITESPACE_RUN.as_ref() {
        Some(re) => re.replace_all(&base, " ").into_owned(),
        None => base,
    }
}

fn is_wrapping_quote(c: char) -> bool {
    c == '"' || ('\u{201C}'..='\u{201F}').contains(&c)
}

/// `normalizeUnquotedChoiceText`.
pub fn normalize_unquoted(value: Option<&Value>) -> String {
    let normalized = normalize_choice_text(value);
    if normalized.is_empty() {
        return String::new();
    }
    js::trim(normalized.trim_matches(is_wrapping_quote)).to_owned()
}

/// How a lookup ended.
#[derive(Debug, Clone, PartialEq)]
pub enum Resolution<T> {
    Matched(T),
    Ambiguous,
    None,
}

/// `matchChoiceIgnoringWrappingQuotes`: the index of the one choice that
/// reads the same once quotation marks around either side are set aside.
pub fn match_ignoring_quotes(text: &str, choices: &[Value]) -> Resolution<usize> {
    let wanted = normalize_unquoted(Some(&Value::String(text.to_owned())));
    if wanted.is_empty() {
        return Resolution::None;
    }
    let indexes: Vec<usize> = choices
        .iter()
        .enumerate()
        .filter(|(_, c)| normalize_unquoted(c.get("choice")) == wanted)
        .map(|(i, _)| i)
        .collect();
    match indexes.as_slice() {
        [] => Resolution::None,
        [one] => Resolution::Matched(*one),
        _ => Resolution::Ambiguous,
    }
}

/// `parseStoredChoices`: an array, a JSON string of one (possibly encoded
/// twice), or `{choices: [...]}`; every entry must be an object with a
/// string or number `choice`.
pub fn parse_stored_choices(value: Option<&Value>) -> Option<Vec<Value>> {
    let mut parsed = value?.clone();
    if let Value::String(text) = &parsed {
        let inner: Value = serde_json::from_str(text).ok()?;
        if inner.is_string() {
            return parse_stored_choices(Some(&inner));
        }
        parsed = inner;
    }
    if let Value::Object(map) = &parsed {
        if let Some(list @ Value::Array(_)) = map.get("choices") {
            parsed = list.clone();
        }
    }
    let Value::Array(items) = parsed else {
        return None;
    };
    let all_valid = items.iter().all(|item| {
        item.as_object()
            .and_then(|m| m.get("choice"))
            .is_some_and(|c| c.is_string() || c.is_number())
    });
    all_valid.then_some(items)
}

/// One stored set of choices for a question.
#[derive(Debug, Clone, PartialEq)]
pub struct ChoiceRendering {
    /// For logs only (`authored`, `translation:ja`, ...).
    pub source: String,
    pub choices: Vec<Value>,
    /// False when the set is known not to share the authored order.
    pub aligned: bool,
}

/// `scoreKey`: what a choice is worth.
fn score_key(choice: &Value) -> (bool, f64) {
    (
        choice.get("isCorrect") == Some(&Value::Bool(true)),
        js::number_or_zero(choice.get("points")),
    )
}

fn shares_answer_key(a: &[Value], b: &[Value]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| score_key(x) == score_key(y))
}

/// A choice found in another rendering.
#[derive(Debug, Clone, PartialEq)]
pub struct RenderedMatch {
    /// The choice to grade with.
    pub choice: Value,
    /// Its position in the grading set, when the match maps onto it.
    pub grading_index: Option<usize>,
    pub sources: Vec<String>,
}

/// `resolveChoiceAcrossRenderings`.
pub fn resolve_across_renderings(
    text: &str,
    grading: &[Value],
    renderings: &[ChoiceRendering],
    aligned_only: bool,
) -> Resolution<RenderedMatch> {
    let text_value = Value::String(text.to_owned());
    let wanted = normalize_choice_text(Some(&text_value));
    if wanted.is_empty() {
        return Resolution::None;
    }
    let mut matches: Vec<(Value, Option<usize>, &str)> = Vec::new();
    for ignore_quotes in [false, true] {
        for rendering in renderings {
            let maps_by_index = rendering.aligned && shares_answer_key(&rendering.choices, grading);
            if !maps_by_index && aligned_only {
                continue;
            }
            let indexes: Vec<usize> = if ignore_quotes {
                match match_ignoring_quotes(text, &rendering.choices) {
                    Resolution::Matched(i) => vec![i],
                    _ => Vec::new(),
                }
            } else {
                rendering
                    .choices
                    .iter()
                    .enumerate()
                    .filter(|(_, c)| normalize_choice_text(c.get("choice")) == wanted)
                    .map(|(i, _)| i)
                    .collect()
            };
            for index in indexes {
                if maps_by_index {
                    if let Some(choice) = grading.get(index) {
                        matches.push((choice.clone(), Some(index), &rendering.source));
                    }
                } else if let Some(choice) = rendering.choices.get(index) {
                    matches.push((choice.clone(), None, &rendering.source));
                }
            }
        }
        if !matches.is_empty() {
            break;
        }
    }
    if matches.is_empty() {
        return Resolution::None;
    }
    let mut sources: Vec<String> = Vec::new();
    for (_, _, source) in &matches {
        if !sources.iter().any(|s| s == source) {
            sources.push((*source).to_owned());
        }
    }
    let first_outcome = score_key(&matches[0].0);
    let outcomes_differ = matches
        .iter()
        .any(|(c, _, _)| score_key(c) != first_outcome);
    let mut grading_indexes: Vec<usize> = matches.iter().filter_map(|(_, i, _)| *i).collect();
    grading_indexes.sort_unstable();
    grading_indexes.dedup();
    if outcomes_differ || (aligned_only && grading_indexes.len() > 1) {
        return Resolution::Ambiguous;
    }
    let best = matches
        .iter()
        .find(|(_, i, _)| i.is_some())
        .unwrap_or(&matches[0]);
    Resolution::Matched(RenderedMatch {
        choice: best.0.clone(),
        grading_index: best.1,
        sources,
    })
}

/// A stored `Translation` row, as the renderings use it.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredChoiceTranslation {
    pub language_code: String,
    pub variant_id: Option<i32>,
    pub translated_choices: Option<Value>,
    pub untranslated_choices: Option<Value>,
}

/// A translation is trusted only when made from these choices (or when it
/// records no source).
fn translated_from(row: &StoredChoiceTranslation, source_choices: &[Value]) -> bool {
    let Some(untranslated) = row.untranslated_choices.as_ref().filter(|v| !v.is_null()) else {
        return true;
    };
    let Some(source) = parse_stored_choices(Some(untranslated)) else {
        return false;
    };
    source.len() == source_choices.len()
        && source.iter().zip(source_choices).all(|(a, b)| {
            normalize_choice_text(a.get("choice")) == normalize_choice_text(b.get("choice"))
        })
}

/// `buildChoiceRenderings`: every set of choices the learner can have been
/// shown for one question in one attempt.
pub fn build_renderings(
    own_choices: Option<&[Value]>,
    base_choices: Option<&[Value]>,
    variant_id: Option<i32>,
    rows: &[StoredChoiceTranslation],
) -> Vec<ChoiceRendering> {
    let mut renderings = Vec::new();
    if let Some(own) = own_choices.filter(|c| !c.is_empty()) {
        renderings.push(ChoiceRendering {
            source: "authored".to_owned(),
            choices: own.to_vec(),
            aligned: true,
        });
    }
    let own_rows: Vec<&StoredChoiceTranslation> =
        rows.iter().filter(|r| r.variant_id == variant_id).collect();
    for row in &own_rows {
        let Some(choices) = parse_stored_choices(row.translated_choices.as_ref()) else {
            continue;
        };
        let Some(own) = own_choices else { continue };
        if choices.is_empty() || !translated_from(row, own) {
            continue;
        }
        renderings.push(ChoiceRendering {
            source: format!("translation:{}", row.language_code),
            choices,
            aligned: true,
        });
    }
    if let (Some(_), Some(base)) = (variant_id, base_choices.filter(|b| !b.is_empty())) {
        let same_choices = own_choices.is_some_and(|own| {
            own.len() == base.len()
                && own.iter().zip(base).all(|(a, b)| {
                    normalize_choice_text(a.get("choice")) == normalize_choice_text(b.get("choice"))
                })
        });
        let variant_languages: Vec<String> = own_rows
            .iter()
            .map(|r| r.language_code.to_lowercase())
            .collect();
        for row in rows.iter().filter(|r| r.variant_id.is_none()) {
            let code = row.language_code.to_lowercase();
            if code.split('-').next() == Some("en") || variant_languages.contains(&code) {
                continue;
            }
            let Some(choices) = parse_stored_choices(row.translated_choices.as_ref()) else {
                continue;
            };
            if choices.is_empty() || !translated_from(row, base) {
                continue;
            }
            renderings.push(ChoiceRendering {
                source: format!("base-translation:{}", row.language_code),
                choices,
                aligned: same_choices,
            });
        }
    }
    renderings
}

/// `jsonNumberForm`: the text a value becomes when read as a JSON number
/// and written back (`1.620` -> `1.62`), or `None` when it is not one.
pub fn json_number_form(text: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(text).ok()?;
    let f = parsed
        .as_f64()
        .filter(|f| f.is_finite() && parsed.is_number())?;
    Some(js::number_to_string(f))
}

/// `resolveNumberRewrittenChoice`: the one choice whose text rewrites to
/// exactly the submitted number form.
pub fn resolve_number_rewritten(submitted: &str, choices: &[Value]) -> Resolution<usize> {
    let text = js::trim(submitted);
    if text.is_empty() || json_number_form(text).as_deref() != Some(text) {
        return Resolution::None;
    }
    let indexes: Vec<usize> = choices
        .iter()
        .enumerate()
        .filter_map(|(i, c)| {
            let authored = js::trim(c.get("choice")?.as_str()?);
            (authored != text && json_number_form(authored).as_deref() == Some(text)).then_some(i)
        })
        .collect();
    match indexes.as_slice() {
        [] => Resolution::None,
        [one] => Resolution::Matched(*one),
        _ => Resolution::Ambiguous,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn abc() -> Vec<Value> {
        vec![
            json!({"choice": "Paris", "isCorrect": true, "points": 1}),
            json!({"choice": "\"Lyon\"", "isCorrect": false, "points": 0}),
            json!({"choice": "1.620", "isCorrect": false, "points": 0}),
        ]
    }

    #[test]
    fn normalization() {
        assert_eq!(normalize_str("  Hello, World! "), "hello world");
        assert_eq!(normalize_text(Some(&json!(4.5))), "4.5");
        assert_eq!(normalize_text(Some(&json!({"label": "X"}))), "x");
        assert_eq!(normalize_choice_text(Some(&json!("A  b\tc"))), "a b c");
        assert_eq!(normalize_choice_text(Some(&json!(true))), "");
        assert_eq!(
            normalize_unquoted(Some(&json!("\u{201C}Lyon\u{201D}"))),
            "lyon"
        );
    }

    #[test]
    fn quotes_and_numbers() {
        assert_eq!(
            match_ignoring_quotes("Lyon", &abc()),
            Resolution::Matched(1)
        );
        assert_eq!(match_ignoring_quotes("Rome", &abc()), Resolution::None);
        let dup = vec![json!({"choice": "\"a\""}), json!({"choice": "a"})];
        assert_eq!(match_ignoring_quotes("a", &dup), Resolution::Ambiguous);
        assert_eq!(
            resolve_number_rewritten("1.62", &abc()),
            Resolution::Matched(2)
        );
        assert_eq!(resolve_number_rewritten("1.620", &abc()), Resolution::None);
        assert_eq!(resolve_number_rewritten("1.6", &abc()), Resolution::None);
        let twice = vec![json!({"choice": "4.0"}), json!({"choice": "4.00"})];
        assert_eq!(resolve_number_rewritten("4", &twice), Resolution::Ambiguous);
        assert_eq!(json_number_form("01"), None);
        assert_eq!(json_number_form("1e21").as_deref(), Some("1e+21"));
    }

    #[test]
    fn stored_choices_parsing() {
        assert_eq!(
            parse_stored_choices(Some(&json!("[{\"choice\":\"a\"}]")))
                .unwrap()
                .len(),
            1
        );
        let twice = Value::String(Value::String("[{\"choice\":1}]".into()).to_string());
        assert_eq!(parse_stored_choices(Some(&twice)).unwrap().len(), 1);
        assert_eq!(
            parse_stored_choices(Some(&json!({"choices": [{"choice": "a"}]})))
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            parse_stored_choices(Some(&json!([{"choice": "a"}, {"x": 1}]))),
            None
        );
        assert_eq!(parse_stored_choices(Some(&json!("nope"))), None);
    }

    #[test]
    fn translated_and_randomized_renderings_map_to_the_grading_set() {
        let grading = abc();
        let rows = vec![
            StoredChoiceTranslation {
                language_code: "fr".into(),
                variant_id: None,
                translated_choices: Some(json!([
                    {"choice": "Paris (fr)", "isCorrect": true, "points": 1},
                    {"choice": "Lyon (fr)", "isCorrect": false, "points": 0},
                    {"choice": "1,620", "isCorrect": false, "points": 0}
                ])),
                untranslated_choices: None,
            },
            // Made from other choices: not trusted.
            StoredChoiceTranslation {
                language_code: "de".into(),
                variant_id: None,
                translated_choices: Some(
                    json!([{"choice": "Berlin", "isCorrect": true, "points": 1}]),
                ),
                untranslated_choices: Some(json!([{"choice": "Other"}])),
            },
        ];
        let renderings = build_renderings(Some(&grading), Some(&grading), None, &rows);
        assert_eq!(renderings.len(), 2);
        match resolve_across_renderings("paris (FR)", &grading, &renderings, true) {
            Resolution::Matched(m) => {
                assert_eq!(m.grading_index, Some(0));
                assert_eq!(m.choice, grading[0]);
                assert_eq!(m.sources, vec!["translation:fr".to_owned()]);
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(
            resolve_across_renderings("Berlin", &grading, &renderings, false),
            Resolution::None
        );
    }

    #[test]
    fn unaligned_renderings_grade_by_their_own_key_unless_aligned_only() {
        let grading = vec![
            json!({"choice": "v1", "isCorrect": true, "points": 2}),
            json!({"choice": "v2", "isCorrect": false, "points": 0}),
        ];
        let base = vec![
            json!({"choice": "b1", "isCorrect": false, "points": 0}),
            json!({"choice": "b2", "isCorrect": true, "points": 2}),
        ];
        let rows = vec![StoredChoiceTranslation {
            language_code: "es".into(),
            variant_id: None,
            translated_choices: Some(json!([
                {"choice": "b1-es", "isCorrect": false, "points": 0},
                {"choice": "b2-es", "isCorrect": true, "points": 2}
            ])),
            untranslated_choices: None,
        }];
        let renderings = build_renderings(Some(&grading), Some(&base), Some(9), &rows);
        assert_eq!(renderings.len(), 2);
        assert!(!renderings[1].aligned);
        match resolve_across_renderings("b2-es", &grading, &renderings, false) {
            Resolution::Matched(m) => {
                assert_eq!(m.grading_index, None);
                assert_eq!(m.choice["choice"], "b2-es");
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(
            resolve_across_renderings("b2-es", &grading, &renderings, true),
            Resolution::None
        );
    }

    #[test]
    fn matches_that_score_differently_are_ambiguous() {
        let grading = vec![
            json!({"choice": "a", "isCorrect": true, "points": 1}),
            json!({"choice": "b", "isCorrect": false, "points": 0}),
        ];
        let renderings = vec![
            ChoiceRendering {
                source: "authored".into(),
                choices: grading.clone(),
                aligned: true,
            },
            ChoiceRendering {
                source: "translation:x".into(),
                choices: vec![
                    json!({"choice": "same", "isCorrect": true, "points": 1}),
                    json!({"choice": "same"}),
                ],
                aligned: false,
            },
        ];
        assert_eq!(
            resolve_across_renderings("same", &grading, &renderings, false),
            Resolution::Ambiguous
        );
        // Two grading positions are ambiguous for multiple-correct even when
        // they score the same.
        let grading = vec![json!({"choice": "x"}), json!({"choice": "y"})];
        let renderings = vec![ChoiceRendering {
            source: "translation:z".into(),
            choices: vec![json!({"choice": "dup"}), json!({"choice": "dup"})],
            aligned: true,
        }];
        assert_eq!(
            resolve_across_renderings("dup", &grading, &renderings, true),
            Resolution::Ambiguous
        );
    }
}
