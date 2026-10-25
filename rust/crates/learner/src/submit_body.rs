//! The submit body read straight from its bytes into only what the validator
//! reads. Unknown keys are skipped without being built, containers in fields
//! that must be scalars are kept as empty containers of the same kind, and
//! arrays keep one element past their limit (enough for the limit check).
//! Base64 is decoded as each kept string is read, under the same rules as
//! `wire::decode_request`, so the result validates exactly as the fully
//! decoded body would, apart from messages for elements past a limit.
//!
//! Lone UTF-16 surrogate escapes are replaced with U+FFFD before parsing, as
//! the legacy backend scrubs them before storing, instead of failing the
//! parse.

use std::borrow::Cow;
use std::fmt;

use serde::de::{DeserializeSeed, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};

use crate::submit_request::{
    FILE_KEYS, MAX_CHOICES, MAX_FILES, MAX_SUBMITTED_RESPONSES, RESPONSE_KEYS,
};
use crate::wire::{self, Decoded};

/// The top-level keys the validator reads.
const TOP_KEYS: [&str; 6] = [
    "submitted",
    "responsesForQuestions",
    "language",
    "authorQuestions",
    "authorAssignmentDetails",
    "preTranslatedQuestions",
];

/// Stands in for any key a file reference may not carry.
const UNKNOWN_FILE_KEY: &str = "?";

/// The body is not JSON.
#[derive(Debug)]
pub struct Unparsable(pub serde_json::Error);

impl fmt::Display for Unparsable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "submit body is not valid JSON: {}", self.0)
    }
}

/// Read a submit body. An empty body reads as `{}`. Returns the kept tree
/// and how many lone surrogate escapes were replaced.
pub fn read(raw: &[u8]) -> Result<(Value, usize), Unparsable> {
    if raw.is_empty() {
        return Ok((Value::Object(Map::new()), 0));
    }
    let (bytes, replaced) = scrub_lone_surrogates(raw);
    let mut de = serde_json::Deserializer::from_slice(&bytes);
    let value = Object::Top.deserialize(&mut de).map_err(Unparsable)?;
    de.end().map_err(Unparsable)?;
    Ok((value, replaced))
}

// ---------------------------------------------------------------- surrogates

/// The code unit of a `\uXXXX` escape starting at `raw[i]`.
fn escape_at(raw: &[u8], i: usize) -> Option<u16> {
    if raw.get(i) != Some(&b'\\') || raw.get(i + 1) != Some(&b'u') {
        return None;
    }
    let digits = raw.get(i + 2..i + 6)?;
    let mut unit: u16 = 0;
    for d in digits {
        let v = char::from(*d).to_digit(16)?;
        unit = unit * 16 + u16::try_from(v).ok()?;
    }
    Some(unit)
}

/// Replace every `\uXXXX` escape of an unpaired surrogate with `\uFFFD`.
/// Escaped backslashes are skipped as pairs, so `\\uD800` (literal text) is
/// left alone. The input is copied only when something is replaced.
pub fn scrub_lone_surrogates(raw: &[u8]) -> (Cow<'_, [u8]>, usize) {
    let mut out: Option<Vec<u8>> = None;
    let mut replaced = 0;
    let mut i = 0;
    while i < raw.len() {
        if raw[i] != b'\\' {
            i += 1;
            continue;
        }
        let lone = match escape_at(raw, i) {
            Some(0xD800..=0xDBFF) => {
                if matches!(escape_at(raw, i + 6), Some(0xDC00..=0xDFFF)) {
                    i += 12;
                    continue;
                }
                true
            }
            Some(0xDC00..=0xDFFF) => true,
            Some(_) => {
                i += 6;
                continue;
            }
            None => {
                i += 2;
                continue;
            }
        };
        if lone {
            out.get_or_insert_with(|| raw.to_vec())[i + 2..i + 6].copy_from_slice(b"FFFD");
            replaced += 1;
        }
        i += 6;
    }
    (out.map_or(Cow::Borrowed(raw), Cow::Owned), replaced)
}

// ---------------------------------------------------------------- keys

/// A map key, matched against `known` without allocating.
struct Key(&'static [&'static str]);

impl<'de> DeserializeSeed<'de> for Key {
    type Value = Option<&'static str>;

    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
        d.deserialize_str(self)
    }
}

impl Visitor<'_> for Key {
    type Value = Option<&'static str>;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a key")
    }

    fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
        Ok(self.0.iter().find(|k| **k == v).copied())
    }
}

// ---------------------------------------------------------------- leaves

/// How a kept string is decoded.
#[derive(Debug, Clone, Copy)]
enum Decode {
    /// Not a decoded field.
    No,
    /// Decoded; JSON text of an object or array stays text.
    Plain,
    /// Decoded; JSON text of an object or array becomes one (kept empty).
    Structured,
}

fn empty_like(json: &str) -> Value {
    if json.trim_start().starts_with('[') {
        Value::Array(Vec::new())
    } else {
        Value::Object(Map::new())
    }
}

fn decode_leaf(text: String, decode: Decode) -> Value {
    match decode {
        Decode::No => Value::String(text),
        Decode::Plain | Decode::Structured => {
            match wire::decode_string(text, matches!(decode, Decode::Structured)) {
                Decoded::Text(t) => Value::String(t),
                Decoded::Json(json) => empty_like(&json),
            }
        }
    }
}

fn drain_seq<'de, A: SeqAccess<'de>>(mut seq: A) -> Result<(), A::Error> {
    while seq.next_element::<IgnoredAny>()?.is_some() {}
    Ok(())
}

fn drain_map<'de, A: MapAccess<'de>>(mut map: A) -> Result<(), A::Error> {
    while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
    Ok(())
}

/// Scalars as they are; containers as empty containers of their kind.
macro_rules! scalar_visits {
    () => {
        fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Value, E> {
            Ok(Value::Bool(v))
        }

        fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Value, E> {
            Ok(Value::from(v))
        }

        fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Value, E> {
            Ok(Value::from(v))
        }

        fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Value, E> {
            Ok(serde_json::Number::from_f64(v).map_or(Value::Null, Value::Number))
        }

        fn visit_unit<E: serde::de::Error>(self) -> Result<Value, E> {
            Ok(Value::Null)
        }
    };
}

/// A field the validator reads as a scalar.
#[derive(Debug, Clone, Copy)]
struct Leaf(Decode);

impl<'de> DeserializeSeed<'de> for Leaf {
    type Value = Value;

    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Value, D::Error> {
        d.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for Leaf {
    type Value = Value;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("any JSON value")
    }

    scalar_visits!();

    fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Value, E> {
        Ok(decode_leaf(v.to_owned(), self.0))
    }

    fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Value, E> {
        Ok(decode_leaf(v, self.0))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, seq: A) -> Result<Value, A::Error> {
        drain_seq(seq)?;
        Ok(Value::Array(Vec::new()))
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Value, A::Error> {
        drain_map(map)?;
        Ok(Value::Object(Map::new()))
    }
}

/// An array kept up to `max + 1` elements, each read with `item`.
fn bounded_seq<'de, A, S>(mut seq: A, max: usize, item: S) -> Result<Value, A::Error>
where
    A: SeqAccess<'de>,
    S: DeserializeSeed<'de, Value = Value> + Copy,
{
    let mut kept = Vec::new();
    while kept.len() <= max {
        match seq.next_element_seed(item)? {
            Some(v) => kept.push(v),
            None => return Ok(Value::Array(kept)),
        }
    }
    drain_seq(seq)?;
    Ok(Value::Array(kept))
}

// ---------------------------------------------------------------- learnerChoices

/// `learnerChoices`: decoded element by element; a string that decodes to
/// a stringified array becomes that array (its elements left as they are).
struct Choices {
    decode: bool,
}

impl<'de> DeserializeSeed<'de> for Choices {
    type Value = Value;

    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Value, D::Error> {
        d.deserialize_any(self)
    }
}

impl Choices {
    fn read_string(self, text: String) -> Value {
        if !self.decode {
            return Value::String(text);
        }
        match wire::decode_string(text, true) {
            Decoded::Text(t) => Value::String(t),
            Decoded::Json(json) if json.trim_start().starts_with('[') => {
                let mut de = serde_json::Deserializer::from_str(&json);
                Choices { decode: false }
                    .deserialize(&mut de)
                    .unwrap_or_else(|_| Value::Array(Vec::new()))
            }
            Decoded::Json(_) => Value::Object(Map::new()),
        }
    }
}

impl<'de> Visitor<'de> for Choices {
    type Value = Value;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("any JSON value")
    }

    scalar_visits!();

    fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Value, E> {
        Ok(self.read_string(v.to_owned()))
    }

    fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Value, E> {
        Ok(self.read_string(v))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, seq: A) -> Result<Value, A::Error> {
        let decode = if self.decode {
            Decode::Plain
        } else {
            Decode::No
        };
        bounded_seq(seq, MAX_CHOICES, Leaf(decode))
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Value, A::Error> {
        drain_map(map)?;
        Ok(Value::Object(Map::new()))
    }
}

// ---------------------------------------------------------------- objects

/// Which object is being read.
#[derive(Debug, Clone, Copy)]
enum Object {
    /// The body.
    Top,
    /// One `responsesForQuestions` element.
    Answer,
    /// One `learnerFileResponse` element.
    File,
}

impl Object {
    fn keys(self) -> &'static [&'static str] {
        match self {
            Object::Top => &TOP_KEYS,
            Object::Answer => &RESPONSE_KEYS,
            Object::File => &FILE_KEYS,
        }
    }

    fn read_value<'de, A: MapAccess<'de>>(self, key: &str, map: &mut A) -> Result<Value, A::Error> {
        match (self, key) {
            (Object::Top, "responsesForQuestions") => map.next_value_seed(Array {
                max: MAX_SUBMITTED_RESPONSES,
                item: Object::Answer,
            }),
            (Object::Answer, "learnerTextResponse") => {
                map.next_value_seed(Leaf(Decode::Structured))
            }
            (Object::Answer, "learnerChoices") => map.next_value_seed(Choices { decode: true }),
            (Object::Answer, "learnerFileResponse") => map.next_value_seed(Array {
                max: MAX_FILES,
                item: Object::File,
            }),
            (Object::File, "content") => map.next_value_seed(Leaf(Decode::Plain)),
            _ => map.next_value_seed(Leaf(Decode::No)),
        }
    }
}

impl<'de> DeserializeSeed<'de> for Object {
    type Value = Value;

    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Value, D::Error> {
        d.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for Object {
    type Value = Value;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("any JSON value")
    }

    scalar_visits!();

    fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Value, E> {
        Ok(Value::String(v.to_owned()))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, seq: A) -> Result<Value, A::Error> {
        drain_seq(seq)?;
        Ok(Value::Array(Vec::new()))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        let mut out = Map::new();
        while let Some(key) = map.next_key_seed(Key(self.keys()))? {
            match key {
                Some(key) => {
                    let value = self.read_value(key, &mut map)?;
                    out.insert(key.to_owned(), value);
                }
                None => {
                    map.next_value::<IgnoredAny>()?;
                    // A file reference with any other key is refused, so
                    // its presence is all that is kept.
                    if matches!(self, Object::File) {
                        out.insert(UNKNOWN_FILE_KEY.to_owned(), Value::Null);
                    }
                }
            }
        }
        Ok(Value::Object(out))
    }
}

/// An array of `item` objects kept up to `max + 1`; anything else as a leaf.
struct Array {
    max: usize,
    item: Object,
}

impl<'de> DeserializeSeed<'de> for Array {
    type Value = Value;

    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Value, D::Error> {
        d.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for Array {
    type Value = Value;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("any JSON value")
    }

    scalar_visits!();

    fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Value, E> {
        Ok(Value::String(v.to_owned()))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, seq: A) -> Result<Value, A::Error> {
        bounded_seq(seq, self.max, self.item)
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Value, A::Error> {
        drain_map(map)?;
        Ok(Value::Object(Map::new()))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::submit_request;
    use base64::Engine;
    use serde_json::json;

    fn b64(s: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
    }

    /// What the validator says about the fully built and decoded body.
    fn reference(raw: &[u8]) -> Result<submit_request::SubmitRequest, Vec<String>> {
        let full: Value = serde_json::from_slice(raw).unwrap();
        submit_request::parse(&wire::decode_request(full))
    }

    fn bounded(raw: &[u8]) -> Result<submit_request::SubmitRequest, Vec<String>> {
        submit_request::parse(&read(raw).unwrap().0)
    }

    #[test]
    fn validates_like_the_fully_decoded_body() {
        let bodies = [
            json!({}),
            json!([1, 2]),
            json!("x"),
            json!({"submitted": "yes", "responsesForQuestions": {"a": 1}, "language": ["en"],
                   "authorQuestions": {}, "authorAssignmentDetails": 4, "preTranslatedQuestions": "x"}),
            json!({"submitted": true, "language": "fr", "extra": {"deep": [1, {"a": 2}]},
            "authorQuestions": [{"question": b64("q")}], "authorAssignmentDetails": {"a": 1},
            "responsesForQuestions": [
                {"id": 1, "learnerTextResponse": b64("my answer"), "question": "x",
                 "learnerUrlResponse": b64("not decoded"), "learnerAnswerChoice": null,
                 "learnerPresentationResponse": null},
                {"id": 2.0, "learnerChoices": [b64("Choice A"), "B"], "learnerAnswerChoice": false},
                {"id": 3, "learnerFileResponse": [
                    {"filename": "a.py", "key": "1/u/3/a.py", "bucket": "learner",
                     "fileType": null, "content": b64("{\"cells\":[]}")}
                ]},
                {"id": 4, "learnerChoices": b64("[\"A\",\"B\"]")},
                {"id": 5, "learnerChoices": format!("comp:{}", b64("[\"C\"]"))},
                {"id": 6, "learnerTextResponse": ""}
            ]}),
            json!({"submitted": true, "responsesForQuestions": [
                {"id": "7", "learnerTextResponse": b64("{\"a\":1}")},
                {"id": 8, "learnerTextResponse": b64("[1,2]"), "learnerChoices": b64("{\"a\":1}")},
                {"id": 9, "learnerChoices": [1, {"a": 1}, [2], b64("x".repeat(6000).as_str())]},
                {"id": 10, "learnerChoices": "plain"},
                {"id": 11, "learnerFileResponse": [{"filename": "a", "key": "k", "bucket": "b", "githubUrl": "x"}]},
                {"id": 12, "learnerFileResponse": {"filename": "a"}},
                {"id": 13, "learnerFileResponse": [{"filename": "a", "key": "k", "bucket": "b", "content": [b64("x")]}]},
                {"id": 14, "learnerPresentationResponse": {"slides": [1]}},
                {"id": 15, "learnerTextResponse": {"a": [1]}, "learnerUrlResponse": [1]},
                5, [1], "s", null
            ]}),
            json!({"submitted": true, "responsesForQuestions": [
                {"id": 1, "learnerChoices": (0..51).map(|i| i.to_string()).collect::<Vec<_>>()},
                {"id": 2, "learnerFileResponse": (0..21).map(|_| json!({"filename": "a", "key": "k", "bucket": "b"})).collect::<Vec<_>>()}
            ]}),
            json!({"submitted": true, "responsesForQuestions": (1..=201).map(|i| json!({"id": i})).collect::<Vec<_>>()}),
        ];
        for body in bodies {
            let raw = body.to_string();
            assert_eq!(bounded(raw.as_bytes()), reference(raw.as_bytes()), "{raw}");
        }
    }

    #[test]
    fn unknown_keys_and_containers_are_not_kept() {
        let junk = "{\"a\":1},".repeat(256 * 1024);
        let raw = format!(
            r#"{{"junk":[{junk}0],"submitted":true,"responsesForQuestions":[{{"id":1,"extra":[{junk}0],"learnerTextResponse":[{junk}0],
                "learnerFileResponse":[{{"filename":"a","key":"k","bucket":"b","x":[{junk}0]}}]}}]}}"#
        );
        assert!(raw.len() > 6 * 1024 * 1024);
        let (kept, _) = read(raw.as_bytes()).unwrap();
        assert!(kept.to_string().len() < 300, "{kept}");
        assert_eq!(
            submit_request::parse(&kept).unwrap_err(),
            vec![
                "responsesForQuestions.0.learnerTextResponse must be shorter than or equal to 200000 characters",
                "responsesForQuestions.0.learnerTextResponse must be a string",
                "responsesForQuestions.0.learnerFileResponse must be a list of uploaded file references",
            ]
        );
    }

    #[test]
    fn arrays_keep_one_element_past_their_limit() {
        let items = "{\"id\":1},".repeat(300_000);
        let raw = format!(r#"{{"submitted":true,"responsesForQuestions":[{items}{{"id":1}}]}}"#);
        let (kept, _) = read(raw.as_bytes()).unwrap();
        assert_eq!(
            kept["responsesForQuestions"].as_array().unwrap().len(),
            MAX_SUBMITTED_RESPONSES + 1
        );
        assert_eq!(
            submit_request::parse(&kept).unwrap_err(),
            vec!["responsesForQuestions must contain no more than 200 elements"]
        );
    }

    #[test]
    fn empty_and_invalid_bodies() {
        assert_eq!(read(b"").unwrap().0, json!({}));
        assert!(read(b"{not json").is_err());
        assert!(read(b"{} x").is_err());
        assert!(read(b"{\"a\":[").is_err());
    }

    #[test]
    fn lone_surrogate_escapes_become_replacement_characters() {
        let (out, n) = scrub_lone_surrogates(
            br#"["\ud83d\ude00","\ud800x","\udc00","\\ud800","\u0041","\ud800\ud800\udc00"]"#,
        );
        assert_eq!(n, 3);
        let parsed: Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(
            parsed,
            json!([
                "\u{1F600}",
                "\u{FFFD}x",
                "\u{FFFD}",
                "\\ud800",
                "A",
                "\u{FFFD}\u{10000}"
            ])
        );
        let (out, n) = scrub_lone_surrogates(b"{\"a\":\"plain\"}");
        assert_eq!(n, 0);
        assert!(matches!(out, Cow::Borrowed(_)));
        // A truncated escape is left for the parser to refuse.
        let (_, n) = scrub_lone_surrogates(br#""\ud8"#);
        assert_eq!(n, 0);

        let raw = r#"{"submitted":true,"responsesForQuestions":[{"id":1,"learnerTextResponse":"half \ud83d"}]}"#;
        let (kept, replaced) = read(raw.as_bytes()).unwrap();
        assert_eq!(replaced, 1);
        assert_eq!(
            submit_request::parse(&kept).unwrap().responses[0]
                .text
                .as_deref(),
            Some("half \u{FFFD}")
        );
    }
}
