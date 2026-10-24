//! Request-side base64 decoding, as the legacy request interceptor does it
//! (`data-transformer.ts`, `data-transform.interceptor.ts`). The web client
//! base64-encodes answer text, so submit bodies are decoded before they are
//! validated. The rules are copied, not improved: a value is decoded only
//! when it is strictly valid, printable base64 that round-trips, up to five
//! layers, which means plain learner text that happens to look like base64
//! is decoded too.

use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use base64::Engine;
use serde_json::{Map, Value};

/// The request fields the legacy interceptor decodes (`TRANSFORM_FIELDS`).
const TRANSFORM_FIELDS: &[&str] = &[
    "introduction",
    "instructions",
    "gradingCriteriaOverview",
    "question",
    "content",
    "choices.choice",
    "choices.feedback",
    "questions.choices.choice",
    "questions.choices.feedback",
    "questions.scoring.rubrics.rubricQuestion",
    "questions.scoring.rubrics.criteria.description",
    "learnerTextResponse",
    "learnerChoices",
    "questionVersions.choices.choice",
    "questionVersions.choices.feedback",
    "questionVersions.scoring.rubrics.rubricQuestion",
    "questionVersions.scoring.rubrics.criteria.description",
    "questionVersions.question",
];

const MAX_BASE64_DEPTH: usize = 5;

/// Decoding that accepts the trailing bits Node's decoder ignores; the
/// round-trip check below rejects those inputs anyway.
const LENIENT: GeneralPurpose = GeneralPurpose::new(
    &base64::alphabet::STANDARD,
    GeneralPurposeConfig::new()
        .with_decode_allow_trailing_bits(true)
        .with_decode_padding_mode(DecodePaddingMode::Indifferent),
);

/// Whether `key` (at `path`, object keys only, array indices dropped) is one
/// of the configured fields: a one-segment field matches the key anywhere,
/// a dotted one only the exact path.
fn matches_configured_field(key: &str, path: &[String]) -> bool {
    let candidate: Vec<&str> = path.iter().map(String::as_str).collect();
    TRANSFORM_FIELDS.iter().any(|field| {
        let configured: Vec<&str> = field.split('.').filter(|s| !s.is_empty()).collect();
        if configured.len() == 1 && configured[0] == key {
            return true;
        }
        configured.len() == candidate.len() && configured == candidate
    })
}

/// `isPrintableText`: at least 85% of UTF-16 code units are printable.
fn is_printable(text: &str) -> bool {
    if text.is_empty() {
        return true;
    }
    let mut total = 0usize;
    let mut printable = 0usize;
    for unit in text.encode_utf16() {
        total += 1;
        let ok = matches!(unit, 9 | 10 | 13) || (unit >= 32 && unit != 127);
        if ok {
            printable += 1;
        }
    }
    // printable / total >= 0.85, in integers.
    printable * 100 >= total * 85
}

fn is_base64_shape(s: &str) -> bool {
    let body = s.trim_end_matches('=');
    !body.is_empty()
        && body
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/')
}

/// `tryDecodeBase64`.
fn try_decode(value: &str) -> Option<String> {
    let trimmed = crate::js::trim(value);
    if trimmed.encode_utf16().count() < 4 || !is_base64_shape(trimmed) {
        return None;
    }
    let normalized = trimmed.trim_end_matches('=');
    let bytes = LENIENT.decode(normalized).ok()?;
    // Node decodes invalid UTF-8 to U+FFFD, which never round-trips.
    let decoded = String::from_utf8(bytes).ok()?;
    if !is_printable(&decoded) {
        return None;
    }
    let reencoded = STANDARD_NO_PAD.encode(decoded.as_bytes());
    (reencoded == normalized).then_some(decoded)
}

/// `decodeBase64Layers`.
fn decode_layers(value: &str) -> String {
    let mut current = value.to_owned();
    for _ in 0..MAX_BASE64_DEPTH {
        match try_decode(&current) {
            Some(decoded) if decoded != current => current = decoded,
            _ => break,
        }
    }
    current
}

/// Text that decoded to a JSON object or array came from one the encoder
/// stringified; anything else stays text.
fn structured_or_text(text: String, allow_structured: bool) -> Value {
    if allow_structured {
        if let Ok(parsed @ (Value::Object(_) | Value::Array(_))) = serde_json::from_str(&text) {
            return parsed;
        }
    }
    Value::String(text)
}

/// Node's lenient decoder for the legacy `comp:` prefix: characters outside
/// the alphabet are skipped and decoding stops at padding.
fn lenient_node_decode(input: &str) -> String {
    let cleaned: String = input
        .chars()
        .take_while(|c| *c != '=')
        .filter_map(|c| match c {
            '-' => Some('+'),
            '_' => Some('/'),
            c if c.is_ascii_alphanumeric() || c == '+' || c == '/' => Some(c),
            _ => None,
        })
        .collect();
    // A single dangling character carries no whole byte; Node drops it.
    let remainder = cleaned.len() % 4;
    let usable = cleaned.len() - usize::from(remainder == 1);
    let bytes = LENIENT.decode(&cleaned[..usable]).unwrap_or_default();
    String::from_utf8_lossy(&bytes).into_owned()
}

/// `decodeValue`: strings only; other values pass through unchanged.
pub fn decode_value(value: Value, allow_structured: bool) -> Value {
    let Value::String(text) = value else {
        return value;
    };
    if text.is_empty() {
        return Value::String(text);
    }
    if let Some(rest) = text.strip_prefix("comp:") {
        let decoded = lenient_node_decode(rest);
        return structured_or_text(decode_layers(&decoded), allow_structured);
    }
    let decoded = decode_layers(&text);
    if decoded == text {
        return Value::String(text);
    }
    structured_or_text(decoded, allow_structured)
}

fn is_learner_file_path(path: &[String]) -> bool {
    path.iter().any(|segment| segment == "learnerFileResponse")
}

fn decode_object(map: Map<String, Value>, path: &[String]) -> Map<String, Value> {
    map.into_iter()
        .map(|(key, value)| {
            let mut field_path = path.to_vec();
            field_path.push(key.clone());
            let decoded = if matches_configured_field(&key, &field_path) {
                match value {
                    Value::Array(items) => Value::Array(
                        items
                            .into_iter()
                            .map(|item| match item {
                                Value::String(_) => decode_value(item, false),
                                Value::Object(inner) => {
                                    Value::Object(decode_object(inner, &field_path))
                                }
                                other => other,
                            })
                            .collect(),
                    ),
                    other => decode_value(other, !is_learner_file_path(&field_path)),
                }
            } else {
                decode_any(value, &field_path)
            };
            (key, decoded)
        })
        .collect()
}

fn decode_any(value: Value, path: &[String]) -> Value {
    match value {
        Value::Object(map) => Value::Object(decode_object(map, path)),
        // Array indices are not path segments.
        Value::Array(items) => {
            Value::Array(items.into_iter().map(|v| decode_any(v, path)).collect())
        }
        other => other,
    }
}

/// Decode a request body the way the legacy interceptor does, at any depth.
pub fn decode_request(body: Value) -> Value {
    decode_any(body, &[])
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn b64(s: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
    }

    #[test]
    fn decodes_valid_printable_base64() {
        assert_eq!(
            try_decode(&b64("hello world")).as_deref(),
            Some("hello world")
        );
        // Too short, wrong alphabet, not printable, not round-tripping.
        assert_eq!(try_decode("abc"), None);
        assert_eq!(try_decode("ab cd"), None);
        assert_eq!(try_decode(&b64("\u{1}\u{2}\u{3}\u{4}")), None);
        assert_eq!(try_decode("QR=="), None);
        // Plain words that happen to be base64 decode only when printable.
        assert_eq!(try_decode("Test"), None);
        assert_eq!(try_decode(" aGVsbG8= ").as_deref(), Some("hello"));
        assert_eq!(try_decode("aGVsbG8").as_deref(), Some("hello"));
    }

    #[test]
    fn decodes_up_to_five_layers() {
        let mut v = "deep text".to_owned();
        for _ in 0..7 {
            v = b64(&v);
        }
        let out = decode_layers(&v);
        let mut expected = "deep text".to_owned();
        for _ in 0..2 {
            expected = b64(&expected);
        }
        assert_eq!(out, expected);
    }

    #[test]
    fn structured_text_only_where_allowed() {
        assert_eq!(decode_value(json!(b64("[1,2]")), true), json!([1, 2]));
        assert_eq!(decode_value(json!(b64("[1,2]")), false), json!("[1,2]"));
        // Primitives stay text.
        assert_eq!(decode_value(json!(b64("1.620")), true), json!("1.620"));
        assert_eq!(decode_value(json!(""), true), json!(""));
        assert_eq!(decode_value(json!(5), true), json!(5));
        assert_eq!(
            decode_value(json!(format!("comp:{}", b64("hi there"))), true),
            json!("hi there")
        );
    }

    #[test]
    fn decodes_submit_fields_at_any_depth() {
        let body = json!({
            "submitted": true,
            "language": b64("French"),
            "responsesForQuestions": [{
                "id": 1,
                "learnerTextResponse": b64("my answer"),
                "learnerUrlResponse": b64("not decoded"),
                "learnerChoices": [b64("Choice A"), 7, b64("{\"a\":1}")],
                "learnerFileResponse": [{"filename": "f", "content": b64("{\"cells\":[]}")}]
            }]
        });
        let out = decode_request(body);
        let item = &out["responsesForQuestions"][0];
        assert_eq!(item["learnerTextResponse"], "my answer");
        assert_eq!(item["learnerUrlResponse"], b64("not decoded"));
        assert_eq!(item["learnerChoices"], json!(["Choice A", 7, "{\"a\":1}"]));
        assert_eq!(item["learnerFileResponse"][0]["content"], "{\"cells\":[]}");
        assert_eq!(out["language"], b64("French"));
    }

    #[test]
    fn printable_ratio_counts_utf16_units() {
        assert!(is_printable("abc"));
        assert!(is_printable("😀"));
        assert!(!is_printable("\u{1}\u{2}a"));
        // 5 of 6 printable is below 85%; 6 of 7 is above.
        assert!(!is_printable("abcde\u{1}"));
        assert!(is_printable("abcdef\u{1}"));
        assert!(is_printable("abcdefghijklmnopqrst\u{1}"));
    }
}
