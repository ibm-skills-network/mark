//! Route and query parameter parsing, plus the wire timestamp format.

use axum::http::StatusCode;
use chrono::NaiveDateTime;

use crate::error::ApiError;

/// `ParseIntPipe` semantics for `/assignments/{id}` and `/languages`:
/// `^-?\d+$` or 400. A well-formed integer outside `1..=i32::MAX` cannot name
/// a row, so it comes back as `Ok(None)` and the caller answers as for a
/// missing assignment.
pub fn parse_int_pipe(raw: &str) -> Result<Option<i32>, ApiError> {
    let digits = raw.strip_prefix('-').unwrap_or(raw);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ApiError::nest(
            StatusCode::BAD_REQUEST,
            "Validation failed (numeric string is expected)",
        ));
    }
    Ok(raw.parse::<i64>().ok().and_then(positive_i32))
}

/// Attempt-route parsing: `String(Number(x)) === x` and positive, i.e. plain
/// decimal digits without sign or leading zero. Values beyond `i32::MAX`
/// cannot name a row and are refused too.
pub fn parse_strict_positive(raw: &str) -> Option<i32> {
    if raw.is_empty() || raw.starts_with('0') || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    raw.parse::<i64>().ok().and_then(positive_i32)
}

fn positive_i32(n: i64) -> Option<i32> {
    i32::try_from(n).ok().filter(|n| *n > 0)
}

/// The requested content language.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lang {
    /// Trimmed, lower-cased, region kept (`zh-cn`). `en` by default.
    pub code: String,
    /// The part before the first `-`.
    pub family: String,
}

const MAX_LANG_LEN: usize = 16;

impl Lang {
    pub fn english() -> Self {
        Self::from_code("en")
    }

    fn from_code(code: &str) -> Self {
        let family = code.split('-').next().unwrap_or(code).to_owned();
        Self {
            code: code.to_owned(),
            family,
        }
    }

    /// English is the authored language: stored `en*` rows are never served.
    pub fn is_authored(&self) -> bool {
        self.family == "en"
    }

    /// The first `lang` query value. Missing, empty, over-long or
    /// non-BCP-47-looking values fall back to authored content.
    pub fn from_query(raw_query: Option<&str>) -> Self {
        let first = raw_query.and_then(|q| {
            form_urlencoded::parse(q.as_bytes())
                .find(|(k, _)| k == "lang")
                .map(|(_, v)| v.into_owned())
        });
        let Some(value) = first else {
            return Self::english();
        };
        let code = value.trim().to_ascii_lowercase();
        let plausible = !code.is_empty()
            && code.len() <= MAX_LANG_LEN
            && code
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        if plausible {
            Self::from_code(&code)
        } else {
            if !code.is_empty() {
                tracing::warn!(len = code.len(), "ignoring malformed lang parameter");
            }
            Self::english()
        }
    }
}

/// A Postgres `LIKE` pattern matching codes that start with `prefix`.
pub fn like_prefix(prefix: &str) -> String {
    let mut out = String::with_capacity(prefix.len() + 1);
    for c in prefix.chars() {
        if matches!(c, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('%');
    out
}

/// `Date.prototype.toISOString()`: UTC, millisecond precision, `Z`.
/// `timestamp(3)` columns hold UTC wall time without a zone.
pub fn iso(ts: NaiveDateTime) -> String {
    ts.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// `iso` for nullable columns, as a serde-friendly value.
pub fn iso_opt(ts: Option<NaiveDateTime>) -> Option<String> {
    ts.map(iso)
}

/// Now, truncated to the millisecond precision the columns store.
pub fn now_millis() -> NaiveDateTime {
    use chrono::SubsecRound;
    chrono::Utc::now().naive_utc().trunc_subsecs(3)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn int_pipe() {
        assert_eq!(parse_int_pipe("42").unwrap(), Some(42));
        assert_eq!(parse_int_pipe("007").unwrap(), Some(7));
        assert_eq!(parse_int_pipe("0").unwrap(), None);
        assert_eq!(parse_int_pipe("-3").unwrap(), None);
        assert_eq!(parse_int_pipe("99999999999999999999").unwrap(), None);
        assert_eq!(parse_int_pipe("2147483648").unwrap(), None);
        for bad in ["", "-", "abc", "1.5", "1e3", " 1", "+1", "１"] {
            let err = parse_int_pipe(bad).unwrap_err();
            assert_eq!(err.status(), StatusCode::BAD_REQUEST, "{bad}");
            assert_eq!(
                err.message(),
                "Validation failed (numeric string is expected)"
            );
        }
    }

    #[test]
    fn strict_positive() {
        assert_eq!(parse_strict_positive("1"), Some(1));
        assert_eq!(parse_strict_positive("2147483647"), Some(i32::MAX));
        for bad in [
            "",
            "0",
            "01",
            "-1",
            "+1",
            "1.0",
            "1e3",
            " 1",
            "1 ",
            "abc",
            "2147483648",
            "9007199254740993",
        ] {
            assert_eq!(parse_strict_positive(bad), None, "{bad}");
        }
    }

    #[test]
    fn lang_query() {
        assert_eq!(Lang::from_query(None), Lang::english());
        assert_eq!(Lang::from_query(Some("")), Lang::english());
        let zh = Lang::from_query(Some("lang=%20zh-CN%20"));
        assert_eq!(zh.code, "zh-cn");
        assert_eq!(zh.family, "zh");
        assert!(!zh.is_authored());
        assert_eq!(Lang::from_query(Some("lang=fr&lang=de")).code, "fr");
        assert_eq!(Lang::from_query(Some("x=1&lang=")).code, "en");
        assert!(Lang::from_query(Some("lang=en-GB")).is_authored());
        assert_eq!(Lang::from_query(Some("lang=fr%25")).code, "en");
        assert_eq!(Lang::from_query(Some("lang=abcdefghijklmnopq")).code, "en");
    }

    #[test]
    fn like_escapes() {
        assert_eq!(like_prefix("zh"), "zh%");
        assert_eq!(like_prefix("a_b%c\\"), "a\\_b\\%c\\\\%");
    }

    #[test]
    fn iso_has_three_fraction_digits() {
        let ts = chrono::NaiveDate::from_ymd_opt(2026, 10, 23)
            .unwrap()
            .and_hms_micro_opt(22, 55, 2, 591_000)
            .unwrap();
        assert_eq!(iso(ts), "2026-10-23T22:55:02.591Z");
        let whole = chrono::NaiveDate::from_ymd_opt(2026, 1, 2)
            .unwrap()
            .and_hms_opt(3, 4, 5)
            .unwrap();
        assert_eq!(iso(whole), "2026-01-02T03:04:05.000Z");
    }
}
