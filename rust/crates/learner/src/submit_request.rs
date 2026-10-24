//! The submit body (`LearnerUpdateAssignmentAttemptRequestDto`): validation
//! with the legacy `ValidationPipe` messages and order, whitelisting, and the
//! "did the learner answer this" rules.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Map, Value};

use crate::js;

pub const MAX_SUBMITTED_RESPONSES: usize = 200;
pub const MAX_TEXT_LENGTH: usize = 200_000;
pub const MAX_URL_LENGTH: usize = 2048;
pub const MAX_CHOICES: usize = 50;
pub const MAX_CHOICE_LENGTH: usize = 5000;
pub const MAX_FILES: usize = 20;
const MAX_FILENAME_LENGTH: usize = 255;
const MAX_FILE_KEY_LENGTH: usize = 1024;
const MAX_FILE_BUCKET_LENGTH: usize = 255;
const MAX_FILE_TYPE_LENGTH: usize = 255;
const MAX_FILE_CONTENT_MARKER_LENGTH: usize = 255;
const MAX_LANGUAGE_LENGTH: usize = 16;
const MAX_QUESTION_ID: f64 = 2_147_483_647.0;

/// The keys a submitted answer may carry; others are stripped.
const RESPONSE_KEYS: [&str; 7] = [
    "id",
    "learnerTextResponse",
    "learnerUrlResponse",
    "learnerChoices",
    "learnerAnswerChoice",
    "learnerFileResponse",
    "learnerPresentationResponse",
];

/// The only keys a submitted file reference may carry.
const FILE_KEYS: [&str; 5] = ["filename", "key", "bucket", "fileType", "content"];

/// The languages a learner may answer in (`languages.json`).
pub const SUPPORTED_LANGUAGES: [&str; 23] = [
    "en", "id", "de", "es", "fr", "it", "hu", "nl", "pl", "pt", "sv", "tr", "el", "kk", "ru",
    "uk-UA", "ar", "hi", "th", "ko", "zh-CN", "zh-TW", "ja",
];

/// The catalogue spelling of a supported code, matched case-insensitively
/// after trimming.
pub fn supported_language(code: &str) -> Option<&'static str> {
    let wanted = js::trim(code).to_lowercase();
    SUPPORTED_LANGUAGES
        .iter()
        .copied()
        .find(|c| c.to_lowercase() == wanted)
}

/// One validated answer.
#[derive(Debug, Clone, PartialEq)]
pub struct SubmittedResponse {
    pub id: i32,
    pub text: Option<String>,
    pub url: Option<String>,
    pub choices: Option<Vec<String>>,
    pub answer_choice: Option<bool>,
    pub files: Option<Vec<Map<String, Value>>>,
    /// The answer with only its declared keys, as the grading queue gets it.
    pub forwarded: Map<String, Value>,
}

impl SubmittedResponse {
    /// The stand-in for a served question the payload left out.
    pub fn empty(id: i32) -> Self {
        Self {
            id,
            text: Some(String::new()),
            url: Some(String::new()),
            choices: Some(Vec::new()),
            answer_choice: None,
            files: Some(Vec::new()),
            forwarded: Map::new(),
        }
    }
}

/// A validated submit body.
#[derive(Debug, Clone, PartialEq)]
pub struct SubmitRequest {
    pub responses: Vec<SubmittedResponse>,
    /// As sent (the catalogue match is case-insensitive); stored as the
    /// attempt's `preferredLanguage`.
    pub language: Option<String>,
}

/// `validator.isLength`: code points, not counting variation selectors.
fn js_length(s: &str) -> usize {
    s.chars()
        .filter(|c| *c != '\u{FE0F}' && *c != '\u{FE0E}')
        .count()
}

fn max_length(value: &Value, max: usize) -> bool {
    value.as_str().is_some_and(|s| js_length(s) <= max)
}

fn present(value: Option<&Value>) -> Option<&Value> {
    value.filter(|v| !v.is_null())
}

/// `isBoundedString`.
fn bounded(value: Option<&Value>, max: usize, allow_empty: bool) -> bool {
    match value {
        Some(Value::String(s)) => {
            s.encode_utf16().count() <= max && (allow_empty || !js::trim(s).is_empty())
        }
        _ => false,
    }
}

fn optional_bounded(value: Option<&Value>, max: usize) -> bool {
    matches!(value, None | Some(Value::Null)) || bounded(value, max, true)
}

/// `isLearnerFileReferenceList`.
pub fn is_file_reference_list(value: &Value) -> bool {
    let Some(items) = value.as_array() else {
        return false;
    };
    items.len() <= MAX_FILES
        && items.iter().all(|item| {
            let Some(record) = item.as_object() else {
                return false;
            };
            record.keys().all(|k| FILE_KEYS.contains(&k.as_str()))
                && bounded(record.get("filename"), MAX_FILENAME_LENGTH, false)
                && bounded(record.get("key"), MAX_FILE_KEY_LENGTH, false)
                && bounded(record.get("bucket"), MAX_FILE_BUCKET_LENGTH, false)
                && optional_bounded(record.get("fileType"), MAX_FILE_TYPE_LENGTH)
                && optional_bounded(record.get("content"), MAX_FILE_CONTENT_MARKER_LENGTH)
        })
}

fn whole_number(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|f| f.is_finite() && f.fract() == 0.0)
}

/// Messages for one answer object, in the legacy order (properties in
/// declaration order, each property's constraints last-declared first).
fn item_messages(item: &Map<String, Value>) -> Vec<String> {
    let mut out = Vec::new();
    let id = item.get("id");
    let id_number = id.and_then(Value::as_f64);
    if !id_number.is_some_and(|f| f <= MAX_QUESTION_ID) {
        out.push(format!("id must not be greater than {MAX_QUESTION_ID}"));
    }
    if !id_number.is_some_and(|f| f >= 1.0) {
        out.push("id must not be less than 1".to_owned());
    }
    if whole_number(id).is_none() {
        out.push("id must be an integer number".to_owned());
    }

    for (key, max) in [
        ("learnerTextResponse", MAX_TEXT_LENGTH),
        ("learnerUrlResponse", MAX_URL_LENGTH),
    ] {
        if let Some(value) = present(item.get(key)) {
            if !max_length(value, max) {
                out.push(format!(
                    "{key} must be shorter than or equal to {max} characters"
                ));
            }
            if !value.is_string() {
                out.push(format!("{key} must be a string"));
            }
        }
    }

    if let Some(value) = present(item.get("learnerChoices")) {
        let each = |check: &dyn Fn(&Value) -> bool| match value {
            Value::Array(items) => items.iter().all(check),
            other => check(other),
        };
        if !each(&|v| max_length(v, MAX_CHOICE_LENGTH)) {
            out.push(format!(
                "each value in learnerChoices must be shorter than or equal to {MAX_CHOICE_LENGTH} characters"
            ));
        }
        if !each(&Value::is_string) {
            out.push("each value in learnerChoices must be a string".to_owned());
        }
        if value.as_array().is_none_or(|a| a.len() > MAX_CHOICES) {
            out.push(format!(
                "learnerChoices must contain no more than {MAX_CHOICES} elements"
            ));
        }
        if !value.is_array() {
            out.push("learnerChoices must be an array".to_owned());
        }
    }

    if present(item.get("learnerAnswerChoice")).is_some_and(|v| !v.is_boolean()) {
        out.push("learnerAnswerChoice must be a boolean value".to_owned());
    }
    if present(item.get("learnerFileResponse")).is_some_and(|v| !is_file_reference_list(v)) {
        out.push("learnerFileResponse must be a list of uploaded file references".to_owned());
    }
    if present(item.get("learnerPresentationResponse")).is_some() {
        out.push("learnerPresentationResponse is not supported".to_owned());
    }
    out
}

fn responses_messages(value: Option<&Value>) -> Vec<String> {
    const NAME: &str = "responsesForQuestions";
    let mut own = Vec::new();
    if present(value).is_none() {
        own.push(format!("{NAME} should not be null or undefined"));
    }
    let array = value.and_then(Value::as_array);
    if array.is_none_or(|a| a.len() > MAX_SUBMITTED_RESPONSES) {
        own.push(format!(
            "{NAME} must contain no more than {MAX_SUBMITTED_RESPONSES} elements"
        ));
    }
    if array.is_none() {
        own.push(format!("{NAME} must be an array"));
    }
    let mut children = Vec::new();
    for (index, item) in array.into_iter().flatten().enumerate() {
        match item.as_object() {
            Some(map) => children.extend(
                item_messages(map)
                    .into_iter()
                    .map(|m| format!("{NAME}.{index}.{m}")),
            ),
            None => children.push(format!(
                "{NAME}.nested property {index} must be either object or array"
            )),
        }
    }
    // The legacy pipe reports only the nested messages when there are any.
    if children.is_empty() {
        own
    } else {
        children
    }
}

fn top_messages(body: &Map<String, Value>) -> Vec<String> {
    let mut out = Vec::new();
    let submitted = body.get("submitted");
    if present(submitted).is_none() {
        out.push("submitted should not be null or undefined".to_owned());
    }
    if submitted != Some(&Value::Bool(true)) {
        out.push("submitted must be true".to_owned());
    }
    if !submitted.is_some_and(Value::is_boolean) {
        out.push("submitted must be a boolean value".to_owned());
    }
    out.extend(responses_messages(body.get("responsesForQuestions")));
    if let Some(language) = present(body.get("language")) {
        if language
            .as_str()
            .is_none_or(|l| supported_language(l).is_none())
        {
            out.push("Unsupported language".to_owned());
        }
        if !max_length(language, MAX_LANGUAGE_LENGTH) {
            out.push(format!(
                "language must be shorter than or equal to {MAX_LANGUAGE_LENGTH} characters"
            ));
        }
        if !language.is_string() {
            out.push("language must be a string".to_owned());
        }
    }
    if present(body.get("authorQuestions")).is_some_and(|v| !v.is_array()) {
        out.push("authorQuestions must be an array".to_owned());
    }
    if present(body.get("authorAssignmentDetails")).is_some_and(|v| !v.is_object() && !v.is_array())
    {
        out.push(
            "nested property authorAssignmentDetails must be either object or array".to_owned(),
        );
    }
    if present(body.get("preTranslatedQuestions")).is_some_and(|v| !v.is_array()) {
        out.push("preTranslatedQuestions must be an array".to_owned());
    }
    out
}

fn string_of(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_owned)
}

fn response_of(item: &Map<String, Value>) -> SubmittedResponse {
    let forwarded: Map<String, Value> = item
        .iter()
        .filter(|(k, _)| RESPONSE_KEYS.contains(&k.as_str()))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    #[allow(clippy::cast_possible_truncation)] // validated whole and within i32
    let id = whole_number(item.get("id")).map_or(0, |f| f as i32);
    SubmittedResponse {
        id,
        text: string_of(item.get("learnerTextResponse")),
        url: string_of(item.get("learnerUrlResponse")),
        choices: item
            .get("learnerChoices")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect()
            }),
        answer_choice: item.get("learnerAnswerChoice").and_then(Value::as_bool),
        files: item
            .get("learnerFileResponse")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|v| v.as_object().cloned())
                    .collect()
            }),
        forwarded,
    }
}

/// Validate a decoded submit body. `Err` carries the 400 messages.
pub fn parse(body: &Value) -> Result<SubmitRequest, Vec<String>> {
    let empty = Map::new();
    let map = body.as_object().unwrap_or(&empty);
    let messages = top_messages(map);
    if !messages.is_empty() {
        return Err(messages);
    }
    let responses = map
        .get("responsesForQuestions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_object)
                .map(response_of)
                .collect()
        })
        .unwrap_or_default();
    Ok(SubmitRequest {
        responses,
        language: string_of(map.get("language")),
    })
}

/// What an emptied rich-text editor serialises to.
static EMPTY_RICH_TEXT: LazyLock<Option<Regex>> = LazyLock::new(|| {
    const WS: &str = r"[\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";
    Regex::new(&format!(
        r"(?i)^(?:<p(?:{WS}[^>]*)?>(?:{WS}|&nbsp;|&#160;|&#xa0;|<br{WS}*/?>)*</p>|<br{WS}*/?>|&nbsp;|&#160;|&#xa0;|{WS})*$"
    ))
    .ok()
});

/// `hasTextContent`.
pub fn has_text_content(value: Option<&str>) -> bool {
    let Some(text) = value else { return false };
    let trimmed = js::trim(text);
    !trimmed.is_empty()
        && !EMPTY_RICH_TEXT
            .as_ref()
            .is_some_and(|re| re.is_match(trimmed))
}

/// `hasLearnerResponse`: the learner put something in this answer.
pub fn has_learner_response(response: Option<&SubmittedResponse>) -> bool {
    let Some(r) = response else { return false };
    has_text_content(r.text.as_deref())
        || r.url.as_deref().is_some_and(|u| !js::trim(u).is_empty())
        || r.choices.as_ref().is_some_and(|c| !c.is_empty())
        || r.answer_choice.is_some()
        || r.files.as_ref().is_some_and(|f| !f.is_empty())
}

/// `isEmptyResponse`: graded as "no response" without a strategy.
pub fn is_empty_response(r: &SubmittedResponse) -> bool {
    r.files.as_ref().is_none_or(Vec::is_empty)
        && r.url.as_deref().is_none_or(|u| js::trim(u).is_empty())
        && r.text.as_deref().is_none_or(|t| js::trim(t).is_empty())
        && r.choices.as_ref().is_none_or(Vec::is_empty)
        && r.answer_choice.is_none()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_web_client_body_is_accepted() {
        let body = json!({
            "submitted": true,
            "language": "ZH-cn",
            "authorQuestions": [],
            "extra": 1,
            "responsesForQuestions": [
                {"id": 3, "learnerTextResponse": "", "learnerUrlResponse": "", "learnerChoices": ["A"],
                 "learnerAnswerChoice": null, "learnerFileResponse": [], "learnerPresentationResponse": null,
                 "question": "stripped"},
                {"id": 4.0, "learnerAnswerChoice": false}
            ]
        });
        let parsed = parse(&body).unwrap();
        assert_eq!(parsed.language.as_deref(), Some("ZH-cn"));
        assert_eq!(parsed.responses.len(), 2);
        assert_eq!(parsed.responses[0].choices, Some(vec!["A".to_owned()]));
        assert!(!parsed.responses[0].forwarded.contains_key("question"));
        assert_eq!(parsed.responses[1].id, 4);
        assert_eq!(parsed.responses[1].answer_choice, Some(false));
    }

    #[test]
    fn messages_follow_the_legacy_order() {
        assert_eq!(
            parse(&json!({})).unwrap_err(),
            vec![
                "submitted should not be null or undefined",
                "submitted must be true",
                "submitted must be a boolean value",
                "responsesForQuestions should not be null or undefined",
                "responsesForQuestions must contain no more than 200 elements",
                "responsesForQuestions must be an array",
            ]
        );
        assert_eq!(
            parse(&json!({"submitted": false, "responsesForQuestions": [], "language": "xx"}))
                .unwrap_err(),
            vec!["submitted must be true", "Unsupported language"]
        );
        let long_url = "u".repeat(2049);
        let body = json!({"submitted": true, "responsesForQuestions": [
            {"id": "7", "learnerUrlResponse": long_url, "learnerChoices": [1, "x"], "learnerAnswerChoice": "yes",
             "learnerFileResponse": [{"filename": "a", "key": "k", "bucket": "b", "githubUrl": "x"}],
             "learnerPresentationResponse": {}},
            5
        ]});
        assert_eq!(
            parse(&body).unwrap_err(),
            vec![
                "responsesForQuestions.0.id must not be greater than 2147483647",
                "responsesForQuestions.0.id must not be less than 1",
                "responsesForQuestions.0.id must be an integer number",
                "responsesForQuestions.0.learnerUrlResponse must be shorter than or equal to 2048 characters",
                "responsesForQuestions.0.each value in learnerChoices must be shorter than or equal to 5000 characters",
                "responsesForQuestions.0.each value in learnerChoices must be a string",
                "responsesForQuestions.0.learnerAnswerChoice must be a boolean value",
                "responsesForQuestions.0.learnerFileResponse must be a list of uploaded file references",
                "responsesForQuestions.0.learnerPresentationResponse is not supported",
                "responsesForQuestions.nested property 1 must be either object or array",
            ]
        );
        let many: Vec<Value> = (1..=201).map(|i| json!({"id": i})).collect();
        assert_eq!(
            parse(&json!({"submitted": true, "responsesForQuestions": many})).unwrap_err(),
            vec!["responsesForQuestions must contain no more than 200 elements"]
        );
        assert_eq!(
            parse(&json!({"submitted": true, "responsesForQuestions": [], "language": "abcdefghijklmnopq"})).unwrap_err(),
            vec!["Unsupported language", "language must be shorter than or equal to 16 characters"]
        );
    }

    #[test]
    fn file_references_take_only_storage_coordinates() {
        assert!(is_file_reference_list(&json!([
            {"filename": "a.py", "key": "1/u/2/x-a.py", "bucket": "b", "fileType": null, "content": "InCos"}
        ])));
        assert!(!is_file_reference_list(
            &json!([{"filename": " ", "key": "k", "bucket": "b"}])
        ));
        assert!(!is_file_reference_list(
            &json!([{"filename": "a", "key": "k"}])
        ));
        assert!(!is_file_reference_list(&json!({"filename": "a"})));
        let many: Vec<Value> = (0..21)
            .map(|_| json!({"filename": "a", "key": "k", "bucket": "b"}))
            .collect();
        assert!(!is_file_reference_list(&Value::Array(many)));
    }

    #[test]
    fn answered_and_empty_rules() {
        let mut r = SubmittedResponse::empty(1);
        assert!(!has_learner_response(Some(&r)));
        assert!(is_empty_response(&r));
        r.text = Some("<p>&nbsp;</p><p><br/></p>".into());
        assert!(!has_learner_response(Some(&r)));
        // Rich-text markup counts as "not empty" for grading, as before.
        assert!(!is_empty_response(&r));
        r.text = Some("<p>hi</p>".into());
        assert!(has_learner_response(Some(&r)));
        let mut r = SubmittedResponse::empty(1);
        r.answer_choice = Some(false);
        assert!(has_learner_response(Some(&r)));
        assert!(!is_empty_response(&r));
        assert!(!has_learner_response(None));
    }

    #[test]
    fn languages_match_case_insensitively() {
        assert_eq!(supported_language(" uk-ua "), Some("uk-UA"));
        assert_eq!(supported_language("EN"), Some("en"));
        assert_eq!(supported_language("zh"), None);
    }
}
