//! Choice JSON handling: parsing the loosely typed stored values, freezing a
//! per-attempt order, and sanitising choices for learners.

use rand::seq::SliceRandom;
use serde::Serialize;
use serde_json::{Map, Value};

/// JS truthiness for a JSON value.
fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `parseJsonValue(value, fallback)`: strings are parsed (fallback on
/// failure), null/absent is the fallback, anything else is returned as is.
pub fn parse_json_value(value: Option<&Value>) -> Option<Value> {
    match value {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => serde_json::from_str(s).ok(),
        Some(other) => Some(other.clone()),
    }
}

/// `parseChoices`: falsy -> [], string -> parsed, array -> items,
/// object -> its values, anything else -> [].
pub fn parse_choices(value: Option<&Value>) -> Vec<Value> {
    let Some(value) = value.filter(|v| truthy(v)) else {
        return Vec::new();
    };
    let parsed;
    let value = if let Value::String(s) = value {
        match serde_json::from_str::<Value>(s) {
            Ok(v) => {
                parsed = v;
                &parsed
            }
            Err(_) => return Vec::new(),
        }
    } else {
        value
    };
    match value {
        Value::Array(items) => items.clone(),
        Value::Object(map) => map.values().cloned().collect(),
        _ => Vec::new(),
    }
}

/// Stored translated choices: an array, or a string that parses to one.
/// Anything else (falsy, number, object, unparsable text, text that parses
/// to a non-array) is `None`, served as `translatedChoices: null`.
pub fn parse_optional_choices(value: Option<&Value>) -> Option<Vec<Value>> {
    match value? {
        Value::Array(items) => Some(items.clone()),
        Value::String(s) => match serde_json::from_str::<Value>(s).ok()? {
            Value::Array(items) => Some(items),
            _ => None,
        },
        _ => None,
    }
}

/// The frozen list served as `randomizedChoices`: `None` when nothing
/// survives sanitising, so the wire value is `null`, never `[]`.
pub fn sanitize_frozen(frozen: Option<&[Value]>, reveal: bool) -> Option<Vec<LearnerChoice>> {
    Some(sanitize(frozen?, reveal)).filter(|list| !list.is_empty())
}

/// The frozen order stored on `AssignmentAttemptQuestionVariant`: a JSON
/// string containing a JSON array. A bare array is tolerated. Anything else
/// (null, `"false"`, garbage) means no usable frozen order.
pub fn parse_frozen(value: Option<&Value>) -> Option<Vec<Value>> {
    let inner = match value? {
        Value::String(s) => serde_json::from_str::<Value>(s).ok()?,
        Value::Array(items) => return Some(items.clone()),
        _ => return None,
    };
    match inner {
        Value::Array(items) => Some(items),
        _ => None,
    }
}

/// Freeze the choice order for a new attempt, as the legacy
/// `maybeShuffleChoices(getChoices(choices), shuffle)` did. Returns the JSON
/// text to store as a JSON string value, or `None` for SQL NULL.
pub fn freeze_choices(
    choices: Option<&Value>,
    shuffle: bool,
    rng: &mut impl rand::Rng,
) -> Option<String> {
    // getChoices: falsy -> [], string -> parsed or [], else as is.
    let got = match choices.filter(|v| truthy(v)) {
        None => Value::Array(Vec::new()),
        Some(Value::String(s)) => serde_json::from_str(s).unwrap_or(Value::Array(Vec::new())),
        Some(other) => other.clone(),
    };
    // maybeShuffleChoices: falsy -> null; string -> must parse to an array;
    // non-array -> null.
    if !truthy(&got) {
        return None;
    }
    let mut items = match got {
        Value::Array(items) => items,
        Value::String(s) => match serde_json::from_str::<Value>(&s) {
            Ok(Value::Array(items)) => items,
            _ => return None,
        },
        _ => return None,
    };
    if shuffle {
        items.shuffle(rng);
    }
    serde_json::to_string(&Value::Array(items)).ok()
}

/// JS `===` between two possibly-absent JSON values. Objects and arrays are
/// never equal (reference comparison).
fn strict_eq(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (None, None) | (Some(Value::Null), Some(Value::Null)) => true,
        (Some(Value::Bool(x)), Some(Value::Bool(y))) => x == y,
        (Some(Value::String(x)), Some(Value::String(y))) => x == y,
        (Some(Value::Number(x)), Some(Value::Number(y))) => x.as_f64() == y.as_f64(),
        _ => false,
    }
}

/// Position in `base` of each frozen choice, matched by `id` when the frozen
/// choice has one, else by `choice` text. Unmatched entries are dropped.
pub fn permutation(base: &[Value], frozen: &[Value]) -> Vec<usize> {
    frozen
        .iter()
        .filter_map(|rc| {
            let rc_id = rc.get("id");
            if rc_id.is_some() {
                base.iter().position(|bc| strict_eq(bc.get("id"), rc_id))
            } else {
                let text = rc.get("choice");
                base.iter().position(|bc| strict_eq(bc.get("choice"), text))
            }
        })
        .collect()
}

/// Apply a permutation that covers every choice; otherwise leave the list
/// as authored.
pub fn reorder(choices: &[Value], perm: &[usize]) -> Option<Vec<Value>> {
    if perm.len() != choices.len() {
        return None;
    }
    perm.iter().map(|i| choices.get(*i).cloned()).collect()
}

/// A choice as served to a learner.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LearnerChoice {
    pub id: Option<i64>,
    pub choice: String,
    #[serde(rename = "isCorrect", skip_serializing_if = "Option::is_none")]
    pub is_correct: Option<bool>,
    /// Outer `None`: omitted (answers hidden). `Some(None)`: `null` (shown,
    /// but the author gave no feedback).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[allow(clippy::option_option)]
    pub feedback: Option<Option<String>>,
}

/// JS `String(n)` for the numbers a choice label can hold.
fn js_number_string(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    match n.as_f64() {
        Some(f) if f.fract() == 0.0 && f.abs() < 1e21 => format!("{f:.0}"),
        Some(f) => f.to_string(),
        None => n.to_string(),
    }
}

/// Keep `{id, choice}`; when `reveal` (the attempt is submitted and
/// visibility allows) add `isCorrect` if stored as a boolean and always add
/// `feedback` (the stored string, else `null`). `points` never. Entries
/// without a string or number `choice` are dropped; a non-integer `id` is
/// `null`.
pub fn sanitize(choices: &[Value], reveal: bool) -> Vec<LearnerChoice> {
    choices
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|c| {
            let choice = match c.get("choice")? {
                Value::String(s) => s.clone(),
                Value::Number(n) => js_number_string(n),
                _ => return None,
            };
            let id = c.get("id").and_then(integral_id);
            let (is_correct, feedback) = if reveal {
                (
                    c.get("isCorrect").and_then(Value::as_bool),
                    Some(feedback_of(c)),
                )
            } else {
                (None, None)
            };
            Some(LearnerChoice {
                id,
                choice,
                is_correct,
                feedback,
            })
        })
        .collect()
}

/// Stored feedback text; absent, null or non-string is `None`.
fn feedback_of(c: &Map<String, Value>) -> Option<String> {
    c.get("feedback").and_then(Value::as_str).map(str::to_owned)
}

fn integral_id(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| {
        let f = v.as_f64()?;
        #[allow(clippy::cast_possible_truncation)]
        // Only whole values in the exact range reach the cast.
        (f.fract() == 0.0 && f.abs() < 9_007_199_254_740_992.0).then_some(f as i64)
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_choices_accepts_legacy_shapes() {
        assert!(parse_choices(None).is_empty());
        assert!(parse_choices(Some(&json!(null))).is_empty());
        assert!(parse_choices(Some(&json!(""))).is_empty());
        assert!(parse_choices(Some(&json!("not json"))).is_empty());
        assert_eq!(
            parse_choices(Some(&json!("[1,2]"))),
            vec![json!(1), json!(2)]
        );
        assert_eq!(
            parse_choices(Some(&json!({"a": 1, "b": 2}))),
            vec![json!(1), json!(2)]
        );
        assert_eq!(parse_choices(Some(&json!([{"choice": "x"}]))).len(), 1);
        assert!(parse_choices(Some(&json!(5))).is_empty());
    }

    #[test]
    fn frozen_value_is_parsed_twice() {
        let stored = Value::String(r#"[{"id":2,"choice":"b"},{"id":1,"choice":"a"}]"#.into());
        let frozen = parse_frozen(Some(&stored)).unwrap();
        assert_eq!(frozen[0]["id"], 2);
        assert_eq!(parse_frozen(Some(&json!("false"))), None);
        assert_eq!(parse_frozen(Some(&json!(null))), None);
        assert_eq!(parse_frozen(None), None);
        assert_eq!(parse_frozen(Some(&json!([1]))), Some(vec![json!(1)]));
    }

    #[test]
    fn freeze_matches_legacy_storage() {
        let mut rng = rand::rng();
        let choices =
            json!([{"id":1,"choice":"a","isCorrect":true,"points":1},{"id":2,"choice":"b"}]);
        let frozen = freeze_choices(Some(&choices), false, &mut rng).unwrap();
        assert_eq!(
            frozen,
            r#"[{"id":1,"choice":"a","isCorrect":true,"points":1},{"id":2,"choice":"b"}]"#
        );
        let shuffled = freeze_choices(Some(&choices), true, &mut rng).unwrap();
        let back: Vec<Value> = serde_json::from_str(&shuffled).unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(freeze_choices(None, true, &mut rng).as_deref(), Some("[]"));
        assert_eq!(
            freeze_choices(Some(&json!("garbage")), false, &mut rng).as_deref(),
            Some("[]")
        );
        assert_eq!(
            freeze_choices(Some(&json!("[3]")), false, &mut rng).as_deref(),
            Some("[3]")
        );
        assert_eq!(freeze_choices(Some(&json!({"a":1})), false, &mut rng), None);
        assert_eq!(freeze_choices(Some(&json!("null")), false, &mut rng), None);
    }

    #[test]
    fn permutation_by_id_then_text() {
        let base = vec![
            json!({"id": 1, "choice": "a"}),
            json!({"id": 2, "choice": "b"}),
            json!({"id": 3, "choice": "c"}),
        ];
        let frozen = vec![json!({"id": 3.0}), json!({"id": 1}), json!({"id": 2})];
        assert_eq!(permutation(&base, &frozen), vec![2, 0, 1]);
        let by_text = vec![
            json!({"choice": "b"}),
            json!({"choice": "c"}),
            json!({"choice": "a"}),
        ];
        assert_eq!(permutation(&base, &by_text), vec![1, 2, 0]);
        let partial = vec![json!({"id": 9}), json!({"id": 1})];
        let perm = permutation(&base, &partial);
        assert_eq!(perm, vec![0]);
        assert_eq!(reorder(&base, &perm), None);
        assert_eq!(
            reorder(&base, &[2, 0, 1]).unwrap()[0],
            json!({"id": 3, "choice": "c"})
        );
    }

    #[test]
    fn sanitize_strips_answer_key_until_revealed() {
        let raw = vec![
            json!({"id": 1, "choice": "a", "isCorrect": true, "points": 2, "feedback": "yes"}),
            json!({"choice": 4, "isCorrect": false, "feedback": null}),
            json!({"id": 3}),
            json!("loose string"),
            json!({"id": "x", "choice": 1.5}),
        ];
        let hidden = serde_json::to_value(sanitize(&raw, false)).unwrap();
        assert_eq!(
            hidden,
            json!([{"id": 1, "choice": "a"}, {"id": null, "choice": "4"}, {"id": null, "choice": "1.5"}])
        );
        let shown = serde_json::to_value(sanitize(&raw, true)).unwrap();
        assert_eq!(
            shown,
            json!([
                {"id": 1, "choice": "a", "isCorrect": true, "feedback": "yes"},
                {"id": null, "choice": "4", "isCorrect": false, "feedback": null},
                {"id": null, "choice": "1.5", "feedback": null}
            ])
        );
        assert!(!shown.to_string().contains("points"));
    }

    #[test]
    fn revealed_feedback_is_always_present() {
        let raw = vec![
            json!({"id": 1, "choice": "a", "isCorrect": true}),
            json!({"id": 2, "choice": "b", "isCorrect": "yes", "feedback": 7}),
            json!({"id": 3, "choice": "c", "feedback": "why"}),
        ];
        let text = serde_json::to_string(&sanitize(&raw, true)).unwrap();
        assert_eq!(
            text,
            r#"[{"id":1,"choice":"a","isCorrect":true,"feedback":null},{"id":2,"choice":"b","feedback":null},{"id":3,"choice":"c","feedback":"why"}]"#
        );
        let hidden = serde_json::to_string(&sanitize(&raw, false)).unwrap();
        assert_eq!(
            hidden,
            r#"[{"id":1,"choice":"a"},{"id":2,"choice":"b"},{"id":3,"choice":"c"}]"#
        );
    }

    #[test]
    fn non_integer_ids_are_null() {
        let raw = vec![
            json!({"id": 1.5, "choice": "a"}),
            json!({"id": 2.0, "choice": "b"}),
            json!({"id": "3", "choice": "c"}),
            json!({"id": true, "choice": "d"}),
        ];
        assert_eq!(
            serde_json::to_value(sanitize(&raw, false)).unwrap(),
            json!([
                {"id": null, "choice": "a"},
                {"id": 2, "choice": "b"},
                {"id": null, "choice": "c"},
                {"id": null, "choice": "d"}
            ])
        );
    }

    #[test]
    fn frozen_list_that_sanitises_to_nothing_is_null() {
        assert_eq!(sanitize_frozen(None, true), None);
        assert_eq!(sanitize_frozen(Some(&[]), true), None);
        let junk = vec![json!(1), json!("x"), json!({"id": 1})];
        assert_eq!(sanitize_frozen(Some(&junk), false), None);
        let ok = vec![json!({"id": 1, "choice": "a"})];
        assert_eq!(sanitize_frozen(Some(&ok), false).map(|l| l.len()), Some(1));
    }

    #[test]
    fn translated_choices_must_be_an_array() {
        assert_eq!(parse_optional_choices(None), None);
        assert_eq!(parse_optional_choices(Some(&json!(null))), None);
        assert_eq!(parse_optional_choices(Some(&json!(5))), None);
        assert_eq!(
            parse_optional_choices(Some(&json!({"a": {"choice": "x"}}))),
            None
        );
        assert_eq!(parse_optional_choices(Some(&json!(""))), None);
        assert_eq!(parse_optional_choices(Some(&json!("not json"))), None);
        assert_eq!(parse_optional_choices(Some(&json!("7"))), None);
        assert_eq!(parse_optional_choices(Some(&json!("{\"a\":1}"))), None);
        assert_eq!(parse_optional_choices(Some(&json!("\"[]\""))), None);
        assert_eq!(parse_optional_choices(Some(&json!("[]"))), Some(vec![]));
        assert_eq!(
            parse_optional_choices(Some(&json!([{"choice": "x"}]))),
            Some(vec![json!({"choice": "x"})])
        );
        assert_eq!(
            parse_optional_choices(Some(&json!("[1]"))),
            Some(vec![json!(1)])
        );
    }
}
