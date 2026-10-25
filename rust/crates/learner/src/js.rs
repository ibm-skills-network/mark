//! JavaScript value semantics the legacy backend's stored text depends on:
//! number formatting, truthiness, `String(x)`, `Number(x)`, `trim()` and
//! `String.prototype.replace` with a string pattern. Feedback sentences and
//! grading metadata are compared byte for byte with what the legacy backend
//! wrote, so these follow the ECMAScript rules rather than Rust's.

use serde_json::{Map, Number, Value};

/// `Number.prototype.toString()` for a finite or non-finite `f64`.
pub fn number_to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".to_owned();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    if x == 0.0 {
        return "0".to_owned();
    }
    if x < 0.0 {
        return format!("-{}", number_to_string(-x));
    }
    // `{:e}` gives the shortest round-trip digits: "1.62e0", "1e21".
    let sci = format!("{x:e}");
    let (mantissa, exponent) = sci.split_once('e').unwrap_or((sci.as_str(), "0"));
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let exponent: i64 = exponent.parse().unwrap_or(0);
    let k = i64::try_from(digits.len()).unwrap_or(i64::MAX);
    let n = exponent + 1;
    if k <= n && n <= 21 {
        let zeros = usize::try_from(n - k).unwrap_or(0);
        return format!("{digits}{}", "0".repeat(zeros));
    }
    if 0 < n && n <= 21 {
        let split = usize::try_from(n).unwrap_or(0);
        return format!("{}.{}", &digits[..split], &digits[split..]);
    }
    if -6 < n && n <= 0 {
        let zeros = usize::try_from(-n).unwrap_or(0);
        return format!("0.{}{digits}", "0".repeat(zeros));
    }
    let e = n - 1;
    let sign = if e < 0 { '-' } else { '+' };
    if digits.len() == 1 {
        format!("{digits}e{sign}{}", e.abs())
    } else {
        format!("{}.{}e{sign}{}", &digits[..1], &digits[1..], e.abs())
    }
}

/// A JSON number as `JSON.stringify` writes it: whole values within the
/// exactly representable range as integers, everything else as a float.
pub fn num(x: f64) -> Value {
    const MAX_EXACT: f64 = 9_007_199_254_740_992.0; // 2^53
    if x.fract() == 0.0 && x.abs() <= MAX_EXACT {
        #[allow(clippy::cast_possible_truncation)] // whole and within 2^53
        return Value::Number(Number::from(x as i64));
    }
    Number::from_f64(x).map_or(Value::Null, Value::Number)
}

/// A stored JSON value as the legacy backend re-serialises it after reading
/// it: every number goes through a JS double, so `1.0` becomes `1`.
pub fn normalize(value: Value) -> Value {
    match value {
        Value::Number(n) => match (n.as_i64(), n.as_u64(), n.as_f64()) {
            (Some(_), _, _) | (_, Some(_), _) => Value::Number(n),
            (_, _, Some(f)) => num(f),
            _ => Value::Number(n),
        },
        Value::Array(items) => Value::Array(items.into_iter().map(normalize).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(k, v)| (k, normalize(v)))
                .collect::<Map<String, Value>>(),
        ),
        other => other,
    }
}

/// JS truthiness.
pub fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// Truthiness of a possibly absent (`undefined`) value.
pub fn truthy_opt(value: Option<&Value>) -> bool {
    value.is_some_and(truthy)
}

/// `String(value)`; `None` is `undefined`.
pub fn to_string(value: Option<&Value>) -> String {
    match value {
        None => "undefined".to_owned(),
        Some(Value::Null) => "null".to_owned(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => n.as_f64().map_or_else(|| n.to_string(), number_to_string),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::Null => String::new(),
                other => to_string(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_owned(),
    }
}

/// `Number(value)` for the shapes stored choices carry; `None` is
/// `undefined` (NaN).
pub fn to_number(value: Option<&Value>) -> f64 {
    match value {
        None | Some(Value::Object(_)) => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => {
            let t = trim(s);
            if t.is_empty() {
                0.0
            } else {
                t.parse::<f64>()
                    .ok()
                    .filter(|_| {
                        !t.contains(|c: char| c.is_ascii_alphabetic() && c != 'e' && c != 'E')
                    })
                    .unwrap_or(f64::NAN)
            }
        }
        Some(Value::Array(items)) => match items.as_slice() {
            [] => 0.0,
            [only] => to_number(Some(only)),
            _ => f64::NAN,
        },
    }
}

/// `Number(x) || 0`.
pub fn number_or_zero(value: Option<&Value>) -> f64 {
    let n = to_number(value);
    if n.is_nan() {
        0.0
    } else {
        n
    }
}

/// The characters `String.prototype.trim` removes (`WhiteSpace` and
/// `LineTerminator`).
pub fn is_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{B}' | '\u{C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// `String.prototype.trim`.
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_whitespace)
}

/// `haystack.replace(new RegExp(literal, "g"), replacement)` where the
/// pattern is a literal and the replacement a string, so `$$`, `$&`, `` $` ``
/// and `$'` in the replacement are expanded as JS does.
pub fn replace_all(haystack: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() {
        return haystack.to_owned();
    }
    let mut out = String::with_capacity(haystack.len());
    let mut last = 0;
    for (start, matched) in haystack.match_indices(needle) {
        out.push_str(&haystack[last..start]);
        expand_replacement(
            &mut out,
            replacement,
            matched,
            &haystack[..start],
            &haystack[start + matched.len()..],
        );
        last = start + matched.len();
    }
    out.push_str(&haystack[last..]);
    out
}

fn expand_replacement(
    out: &mut String,
    replacement: &str,
    matched: &str,
    before: &str,
    after: &str,
) {
    let mut chars = replacement.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '$' {
            out.push(c);
            continue;
        }
        match chars.peek() {
            Some('$') => {
                chars.next();
                out.push('$');
            }
            Some('&') => {
                chars.next();
                out.push_str(matched);
            }
            Some('`') => {
                chars.next();
                out.push_str(before);
            }
            Some('\'') => {
                chars.next();
                out.push_str(after);
            }
            // No capture groups: `$1`, `$<name>` and a lone `$` stay literal.
            _ => out.push('$'),
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn numbers_format_like_javascript() {
        for (x, expected) in [
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (1.5, "1.5"),
            (-2.25, "-2.25"),
            (1.62, "1.62"),
            (100.0, "100"),
            (0.1 + 0.2, "0.30000000000000004"),
            (1e21, "1e+21"),
            (1.5e21, "1.5e+21"),
            (1e20, "100000000000000000000"),
            (0.000_001, "0.000001"),
            (1e-7, "1e-7"),
            (1.25e-7, "1.25e-7"),
            (123_456_789_012_345_680_000.0, "123456789012345680000"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "Infinity"),
        ] {
            assert_eq!(number_to_string(x), expected, "{x}");
        }
    }

    #[test]
    fn whole_numbers_are_integers() {
        assert_eq!(num(2.0).to_string(), "2");
        assert_eq!(num(0.5).to_string(), "0.5");
        assert_eq!(
            normalize(json!({"a": [1.0, 2.5, {"b": 3.0}]})).to_string(),
            r#"{"a":[1,2.5,{"b":3}]}"#
        );
    }

    #[test]
    fn string_and_number_conversions() {
        assert_eq!(to_string(None), "undefined");
        assert_eq!(to_string(Some(&json!(null))), "null");
        assert_eq!(to_string(Some(&json!(3.0))), "3");
        assert_eq!(to_string(Some(&json!([1, null, "a"]))), "1,,a");
        assert_eq!(to_string(Some(&json!({"a": 1}))), "[object Object]");
        assert!(to_number(None).is_nan());
        assert!((to_number(Some(&json!(" 2 "))) - 2.0).abs() < f64::EPSILON);
        assert!(to_number(Some(&json!("two"))).is_nan());
        assert!(number_or_zero(Some(&json!("x"))).abs() < f64::EPSILON);
        assert!(truthy(&json!("x")) && !truthy(&json!("")) && !truthy(&json!(0)));
    }

    #[test]
    fn trim_matches_javascript() {
        assert_eq!(trim("\u{FEFF}\u{A0} a b \n"), "a b");
        assert_eq!(trim("\u{85}x"), "\u{85}x");
    }

    #[test]
    fn replacement_patterns_expand() {
        assert_eq!(replace_all("a {x} b {x}", "{x}", "1"), "a 1 b 1");
        assert_eq!(replace_all("{x}", "{x}", "$$ $& $1 $"), "$ {x} $1 $");
        assert_eq!(replace_all("L{x}R", "{x}", "[$`|$']"), "L[L|R]R");
        assert_eq!(replace_all("none", "{x}", "y"), "none");
    }
}
