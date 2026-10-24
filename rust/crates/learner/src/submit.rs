//! `PATCH /assignments/{assignmentId}/attempts/{attemptId}`: the learner
//! submit (`attempt.controller.ts` and `updateLearnerAttempt` in
//! `attempt-submission.service.ts`).
//!
//! The request is checked here in the legacy order: access, body, closed or
//! late attempt (with the grading job already in flight, if any), the
//! payload against the served questions. The body is read only after the
//! access check, and never above `SUBMIT_BODY_LIMIT`. Attempts whose graded
//! questions are all deterministic are graded and committed in the request;
//! every other attempt is handed to the legacy API's internal enqueue
//! endpoint and graded by the existing worker.

use std::collections::HashMap;

use axum::body::Bytes;
use axum::extract::rejection::PathRejection;
use axum::extract::{FromRequest, Path, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::NaiveDateTime;
use serde::Serialize;
use serde_json::{Map, Value};
use tracing::{error, info, warn};

use crate::access::{self, Intent};
use crate::attempts::ai_grading_disabled;
use crate::choice_match::{self, ChoiceRendering, StoredChoiceTranslation};
use crate::deadline::{self, ClosedReason};
use crate::error::{ApiError, ErrorCode};
use crate::grading::{self, Graded, GradingQuestion};
use crate::internal_client::{EnqueueRequest, Enqueued, InternalApi, QueuedTier};
use crate::lti;
use crate::params::{iso, now_millis};
use crate::principal::{Role, UserSession};
use crate::question_source::{self, is_media_response_type};
use crate::store::{
    self, AttemptRow, FrozenSelectionRow, GradingQuestionRow, QuestionTranslationRow,
};
use crate::submit_body;
use crate::submit_request::{self, has_learner_response, SubmitRequest, SubmittedResponse};
use crate::submit_result::{self, ResultResponse, ResultSettings};
use crate::LearnerState;

pub const REUSED_JOB_MESSAGE: &str =
    "A grading job is already running for this attempt. Reusing existing job.";
pub const CREATED_JOB_MESSAGE: &str =
    "Grading job created. Use the SSE endpoint to track progress.";

/// `{gradingJobId, message}`: follow the grading stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitQueued {
    pub grading_job_id: String,
    pub message: String,
}

impl SubmitQueued {
    fn new(grading_job_id: String, reused: bool) -> Self {
        Self {
            grading_job_id,
            message: if reused {
                REUSED_JOB_MESSAGE
            } else {
                CREATED_JOB_MESSAGE
            }
            .to_owned(),
        }
    }
}

// ---------------------------------------------------------------- tiers

/// Grading cost tier, from the type of every question graded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Inline,
    Standard,
    Heavy,
}

/// `classifyAttemptTier`: none -> standard; any upload -> heavy; only
/// choice and true/false -> inline; anything else -> standard.
pub fn classify_tier<'a>(types: impl IntoIterator<Item = &'a str>) -> Tier {
    let types: Vec<&str> = types.into_iter().collect();
    if types.is_empty() {
        return Tier::Standard;
    }
    if types.iter().any(|t| matches!(*t, "UPLOAD" | "LINK_FILE")) {
        return Tier::Heavy;
    }
    if types
        .iter()
        .all(|t| matches!(*t, "SINGLE_CORRECT" | "MULTIPLE_CORRECT" | "TRUE_FALSE"))
    {
        return Tier::Inline;
    }
    Tier::Standard
}

// ---------------------------------------------------------------- file references

/// Why a submitted file is not the learner's own upload for the question.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileDenial {
    MissingStorageReference,
    BucketNotAllowed,
    MalformedKey,
    KeyOutsideLearnerPrefix,
}

impl FileDenial {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MissingStorageReference => "missing_storage_reference",
            Self::BucketNotAllowed => "bucket_not_allowed",
            Self::MalformedKey => "malformed_key",
            Self::KeyOutsideLearnerPrefix => "key_outside_learner_prefix",
        }
    }
}

/// `isWellFormedStorageKey`: no empty, `.` or `..` segments, no backslash,
/// no control characters.
pub fn well_formed_storage_key(key: &str) -> bool {
    !key.is_empty()
        && !key.contains('\\')
        && !key
            .chars()
            .any(|c| (c as u32) < 0x20 || (0x7f..=0x9f).contains(&(c as u32)))
        && key
            .split('/')
            .all(|s| !s.is_empty() && s != "." && s != "..")
}

/// `findLearnerFileReferenceDenial`: every file must name a learner upload
/// bucket and a key under `<assignmentId>/<userId>/<questionId>/`.
pub fn file_reference_denial(
    files: &[Map<String, Value>],
    assignment_id: i32,
    user_id: &str,
    question_id: i32,
    buckets: &[String],
) -> Option<FileDenial> {
    if user_id.is_empty() {
        return Some(FileDenial::KeyOutsideLearnerPrefix);
    }
    let prefix = format!("{assignment_id}/{user_id}/{question_id}/");
    for file in files {
        let bucket = file.get("bucket").and_then(Value::as_str).unwrap_or("");
        let key = file.get("key").and_then(Value::as_str).unwrap_or("");
        if bucket.is_empty() || key.is_empty() {
            return Some(FileDenial::MissingStorageReference);
        }
        if !buckets.iter().any(|b| b == bucket) {
            return Some(FileDenial::BucketNotAllowed);
        }
        if !well_formed_storage_key(key) {
            return Some(FileDenial::MalformedKey);
        }
        if !key.starts_with(&prefix) || key.len() == prefix.len() {
            return Some(FileDenial::KeyOutsideLearnerPrefix);
        }
    }
    None
}

// ---------------------------------------------------------------- refusals

fn coded(status: StatusCode, code: &str, message: &str, error: &str) -> ApiError {
    let mut body = Map::new();
    body.insert("statusCode".into(), Value::from(status.as_u16()));
    body.insert("code".into(), Value::from(code));
    body.insert("message".into(), Value::from(message));
    body.insert("error".into(), Value::from(error));
    ApiError::raw(status, Value::Object(body))
}

fn unsupported_response_type() -> ApiError {
    coded(
        StatusCode::BAD_REQUEST,
        "UNSUPPORTED_RESPONSE_TYPE",
        "This question type is no longer supported.",
        "Bad Request",
    )
}

fn invalid_file_reference() -> ApiError {
    coded(
        StatusCode::BAD_REQUEST,
        "INVALID_FILE_REFERENCE",
        "Invalid file reference.",
        "Bad Request",
    )
}

fn no_gradable_questions() -> ApiError {
    coded(
        StatusCode::UNPROCESSABLE_ENTITY,
        "NO_GRADABLE_QUESTIONS",
        "This assignment has no questions that can be graded.",
        "Unprocessable Entity",
    )
}

fn ai_disabled() -> ApiError {
    ApiError::coded(
        StatusCode::CONFLICT,
        ErrorCode::AiTemporarilyDisabled,
        "This activity is temporarily out of service. Please try again later.",
    )
}

// ---------------------------------------------------------------- plan

/// Points and response type of a served question.
#[derive(Debug, Clone, PartialEq)]
pub struct QuestionMeta {
    pub total_points: i32,
    pub response_type: Option<String>,
}

/// Everything `resolve_plan` decides from.
#[derive(Debug, Clone)]
pub struct PlanInput<'a> {
    pub attempt_id: i32,
    pub assignment_id: i32,
    pub user_id: &'a str,
    pub attempt_question_order: &'a [i32],
    pub assignment_question_order: &'a [i32],
    /// The grading source in its order (pinned version rows, else live).
    pub source: &'a [(i32, QuestionMeta)],
    /// Rows for served ids missing from the source, on this assignment.
    pub unresolved: &'a [(i32, QuestionMeta)],
    pub require_all_questions: bool,
    pub optional_question_ids: &'a [i32],
    pub learner_buckets: &'a [String],
    pub request: &'a SubmitRequest,
}

/// What a submit grades.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub served: Vec<i32>,
    /// Served minus media response types, in served order.
    pub graded: Vec<i32>,
    /// One answer per graded question; missing ones are empty answers.
    pub responses: Vec<SubmittedResponse>,
    pub total_possible_points: f64,
}

fn refuse(input: &PlanInput<'_>, denial_reason: &str) {
    warn!(
        assignment_id = input.assignment_id,
        attempt_id = input.attempt_id,
        user_id = input.user_id,
        denial_reason,
        "submit rejected"
    );
}

fn join_ids(ids: &[i32]) -> String {
    ids.iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(", ")
}

/// `resolveSubmitPlan`: the served set, the refusals, and the denominator.
#[allow(clippy::too_many_lines)] // one block per legacy refusal, in order
pub fn resolve_plan(input: &PlanInput<'_>) -> Result<Plan, ApiError> {
    let mut meta: Vec<(i32, QuestionMeta)> = input.source.to_vec();
    let served: Vec<i32> = if !input.attempt_question_order.is_empty() {
        input.attempt_question_order.to_vec()
    } else if !input.assignment_question_order.is_empty() {
        input.assignment_question_order.to_vec()
    } else {
        meta.iter().map(|(id, _)| *id).collect()
    };

    let submitted: Vec<i32> = input.request.responses.iter().map(|r| r.id).collect();
    let mut unserved: Vec<i32> = Vec::new();
    let mut duplicates: Vec<i32> = Vec::new();
    for (index, id) in submitted.iter().enumerate() {
        if !served.contains(id) && !unserved.contains(id) {
            unserved.push(*id);
        }
        if submitted[..index].contains(id) && !duplicates.contains(id) {
            duplicates.push(*id);
        }
    }
    if !unserved.is_empty() || !duplicates.is_empty() {
        refuse(input, "unserved_or_duplicate_question_ids");
        let mut parts = Vec::new();
        if !unserved.is_empty() {
            parts.push(format!("unserved question IDs [{}]", join_ids(&unserved)));
        }
        if !duplicates.is_empty() {
            parts.push(format!(
                "duplicate question IDs [{}]",
                join_ids(&duplicates)
            ));
        }
        return Err(ApiError::nest(
            StatusCode::BAD_REQUEST,
            format!(
                "Invalid question responses for attempt {}: {}",
                input.attempt_id,
                parts.join("; ")
            ),
        ));
    }

    let meta_of = |meta: &[(i32, QuestionMeta)], id: i32| meta.iter().any(|(m, _)| *m == id);
    let missing: Vec<i32> = served
        .iter()
        .copied()
        .filter(|id| !meta_of(&meta, *id))
        .collect();
    for id in &missing {
        if let Some((_, m)) = input.unresolved.iter().find(|(u, _)| u == id) {
            meta.push((*id, m.clone()));
        }
    }
    if let Some(still_missing) = missing.iter().find(|id| !meta_of(&meta, **id)) {
        error!(
            assignment_id = input.assignment_id,
            attempt_id = input.attempt_id,
            question_id = still_missing,
            "served question not found; cannot compute the denominator"
        );
        return Err(ApiError::internal(&format!(
            "served question {still_missing} not found for attempt {}",
            input.attempt_id
        )));
    }
    let meta_for = |id: i32| meta.iter().find(|(m, _)| *m == id).map(|(_, m)| m);

    let media: Vec<i32> = served
        .iter()
        .copied()
        .filter(|id| is_media_response_type(meta_for(*id).and_then(|m| m.response_type.as_deref())))
        .collect();
    let response_for = |id: i32| input.request.responses.iter().find(|r| r.id == id);
    if media
        .iter()
        .any(|id| has_learner_response(response_for(*id)))
    {
        refuse(input, "unsupported_response_type");
        return Err(unsupported_response_type());
    }

    for response in &input.request.responses {
        let Some(files) = response.files.as_ref().filter(|f| !f.is_empty()) else {
            continue;
        };
        if let Some(denial) = file_reference_denial(
            files,
            input.assignment_id,
            input.user_id,
            response.id,
            input.learner_buckets,
        ) {
            warn!(
                assignment_id = input.assignment_id,
                attempt_id = input.attempt_id,
                user_id = input.user_id,
                question_id = response.id,
                denial_reason = denial.as_str(),
                "submit rejected"
            );
            return Err(invalid_file_reference());
        }
    }

    let graded: Vec<i32> = served
        .iter()
        .copied()
        .filter(|id| !media.contains(id))
        .collect();
    if graded.is_empty() {
        refuse(input, "no_gradable_questions");
        return Err(no_gradable_questions());
    }

    if input.require_all_questions {
        let unanswered = graded
            .iter()
            .filter(|id| {
                !input.optional_question_ids.contains(id)
                    && !has_learner_response(response_for(**id))
            })
            .count();
        if unanswered > 0 {
            refuse(input, "required_questions_unanswered");
            return Err(ApiError::nest(
                StatusCode::UNPROCESSABLE_ENTITY,
                format!(
                    "All required questions must be answered before submitting ({unanswered} unanswered)."
                ),
            ));
        }
    }

    let responses = graded
        .iter()
        .map(|id| {
            response_for(*id)
                .cloned()
                .unwrap_or_else(|| SubmittedResponse::empty(*id))
        })
        .collect();
    let total_possible_points = graded
        .iter()
        .map(|id| f64::from(meta_for(*id).map_or(0, |m| m.total_points)))
        .sum();
    Ok(Plan {
        served,
        graded,
        responses,
        total_possible_points,
    })
}

// ---------------------------------------------------------------- grading order

/// Kahn's order over `gradingContextQuestionIds`, then dependency levels
/// (the legacy grader's waves). `None` when there is a cycle.
pub fn grading_waves(questions: &[GradingQuestion]) -> Option<Vec<Vec<i32>>> {
    let ids: Vec<i32> = questions.iter().map(|q| q.id).collect();
    let mut dependents: HashMap<i32, Vec<i32>> = ids.iter().map(|id| (*id, Vec::new())).collect();
    let mut in_degree: HashMap<i32, usize> = ids.iter().map(|id| (*id, 0)).collect();
    for q in questions {
        for dep in &q.grading_context_question_ids {
            if let Some(list) = dependents.get_mut(dep) {
                list.push(q.id);
                *in_degree.entry(q.id).or_insert(0) += 1;
            }
        }
    }
    let mut queue: std::collections::VecDeque<i32> = questions
        .iter()
        .filter(|q| in_degree.get(&q.id) == Some(&0))
        .map(|q| q.id)
        .collect();
    let mut sorted = Vec::new();
    while let Some(u) = queue.pop_front() {
        sorted.push(u);
        for v in dependents.get(&u).cloned().unwrap_or_default() {
            if let Some(d) = in_degree.get_mut(&v) {
                *d -= 1;
                if *d == 0 {
                    queue.push_back(v);
                }
            }
        }
    }
    if sorted.len() != questions.len() {
        return None;
    }
    let mut level: Vec<(i32, usize)> = Vec::new();
    for id in &sorted {
        let deps: Vec<usize> = questions
            .iter()
            .find(|q| q.id == *id)
            .map(|q| {
                q.grading_context_question_ids
                    .iter()
                    .filter(|d| ids.contains(d))
                    .map(|d| level.iter().find(|(l, _)| l == d).map_or(0, |(_, lv)| *lv))
                    .collect()
            })
            .unwrap_or_default();
        let lv = if deps.is_empty() {
            0
        } else {
            deps.iter().max().copied().unwrap_or(0) + 1
        };
        match level.iter_mut().find(|(l, _)| l == id) {
            Some(slot) => slot.1 = lv,
            None => level.push((*id, lv)),
        }
    }
    let max_level = level.iter().map(|(_, l)| *l).max().unwrap_or(0);
    Some(
        (0..=max_level)
            .map(|lv| {
                level
                    .iter()
                    .filter(|(_, l)| *l == lv)
                    .map(|(id, _)| *id)
                    .collect()
            })
            .filter(|wave: &Vec<i32>| !wave.is_empty())
            .collect(),
    )
}

// ---------------------------------------------------------------- stored encodings

/// Remove NUL characters from every string (jsonb and text reject them).
/// Returns how many were removed.
pub fn scrub_nul(value: &mut Value) -> usize {
    match value {
        Value::String(s) => {
            let before = s.len();
            if s.contains('\0') {
                s.retain(|c| c != '\0');
            }
            before - s.len()
        }
        Value::Array(items) => items.iter_mut().map(scrub_nul).sum(),
        Value::Object(map) => map.values_mut().map(scrub_nul).sum(),
        _ => 0,
    }
}

/// The `QuestionResponse` row for a graded answer, encoded as the legacy
/// backend stores it.
pub fn response_insert(graded: &Graded) -> (store::ResponseInsert, usize) {
    let mut learner = graded.learner_response.clone();
    let mut feedback = Value::Array(graded.feedback.clone());
    let mut metadata = graded.metadata.clone();
    let replaced =
        scrub_nul(&mut learner) + scrub_nul(&mut feedback) + metadata.as_mut().map_or(0, scrub_nul);
    (
        store::ResponseInsert {
            question_id: graded.question_id,
            learner_response: learner.to_string(),
            points: graded.points.unwrap_or(0.0),
            feedback: feedback.to_string(),
            metadata: metadata.map(|m| Value::String(m.to_string()).to_string()),
        },
        replaced,
    )
}

// ---------------------------------------------------------------- the handler

/// The first `authentication` cookie, decoded as `cookie-parser` does.
pub fn auth_cookie(headers: &HeaderMap) -> String {
    for value in headers.get_all(header::COOKIE) {
        let Ok(text) = value.to_str() else { continue };
        for pair in text.split(';') {
            let Some((name, raw)) = pair.split_once('=') else {
                continue;
            };
            if name.trim() != "authentication" {
                continue;
            }
            let raw = raw.trim();
            let raw = raw
                .strip_prefix('"')
                .and_then(|r| r.strip_suffix('"'))
                .unwrap_or(raw);
            return percent_decode(raw).unwrap_or_else(|| raw.to_owned());
        }
    }
    String::new()
}

fn percent_decode(raw: &str) -> Option<String> {
    if !raw.contains('%') {
        return Some(raw.to_owned());
    }
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = raw.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn raw_pair(path: Result<Path<(String, String)>, PathRejection>) -> (String, String) {
    path.map(|Path(p)| p).unwrap_or_default()
}

/// Everything read before deciding what to do with the submit.
struct Loaded {
    attempt: AttemptRow,
    settings: store::SubmitSettingsRow,
    pinned: Vec<GradingQuestionRow>,
    live: Vec<GradingQuestionRow>,
    unresolved: Vec<GradingQuestionRow>,
    selections: Vec<FrozenSelectionRow>,
    tier: Tier,
}

fn meta_of(row: &GradingQuestionRow) -> QuestionMeta {
    QuestionMeta {
        total_points: row.total_points,
        response_type: row.response_type.clone(),
    }
}

impl Loaded {
    /// The grading source: pinned rows when the version has any, else live.
    fn source_rows(&self) -> Vec<&GradingQuestionRow> {
        if self.pinned.is_empty() {
            self.live.iter().collect()
        } else {
            question_source::keyed_by_served_id(&self.pinned)
        }
    }
}

/// The access guard: the attempt, if the session's learner owns it and may
/// write to it. Runs before the body is read.
async fn authorize(
    state: &LearnerState,
    session: &UserSession,
    assignment_id: i32,
    attempt_id: i32,
) -> Result<AttemptRow, ApiError> {
    let mut tx = store::begin_read(&state.pool).await?;
    let attempt = access::attempt_item(
        &mut tx,
        session,
        Role::Learner,
        assignment_id,
        attempt_id,
        Intent::Write,
    )
    .await?;
    tx.commit().await?;
    Ok(attempt)
}

fn payload_too_large() -> ApiError {
    ApiError::nest(StatusCode::PAYLOAD_TOO_LARGE, "request entity too large")
}

/// Read and validate the body, bounded by the route's body limit.
async fn read_request(
    request: Request,
    session: &UserSession,
    assignment_id: i32,
    attempt_id: i32,
) -> Result<SubmitRequest, ApiError> {
    let bytes = Bytes::from_request(request, &())
        .await
        .map_err(|rejection| {
            let too_large = rejection.status() == StatusCode::PAYLOAD_TOO_LARGE;
            warn!(
                assignment_id,
                attempt_id,
                user_id = session.log_user(),
                denial_reason = if too_large { "body_too_large" } else { "unreadable_body" },
                error = %rejection,
                "submit rejected"
            );
            if too_large {
                payload_too_large()
            } else {
                ApiError::nest(StatusCode::BAD_REQUEST, "Request body could not be read")
            }
        })?;
    let (body, replaced) = submit_body::read(&bytes).map_err(|err| {
        warn!(
            assignment_id,
            attempt_id,
            user_id = session.log_user(),
            denial_reason = "unparsable_body",
            error = %err,
            "submit rejected"
        );
        ApiError::nest(StatusCode::BAD_REQUEST, "Request body is not valid JSON")
    })?;
    drop(bytes);
    if replaced > 0 {
        warn!(
            assignment_id,
            attempt_id,
            replacements = replaced,
            "replaced lone surrogate escapes in the submit body"
        );
    }
    submit_request::parse(&body).map_err(|messages| {
        info!(
            assignment_id,
            attempt_id,
            user_id = session.log_user(),
            denial_reason = "invalid_body",
            count = messages.len(),
            "submit rejected"
        );
        ApiError::validation(messages)
    })
}

async fn load(
    state: &LearnerState,
    attempt: AttemptRow,
    assignment_id: i32,
    attempt_id: i32,
) -> Result<Loaded, ApiError> {
    let mut tx = store::begin_read(&state.pool).await?;
    let Some(settings) = store::submit_settings(&mut tx, assignment_id).await? else {
        return Err(ApiError::nest(
            StatusCode::NOT_FOUND,
            format!("Assignment with Id {assignment_id} not found."),
        ));
    };
    let pinned = match attempt.assignment_version_id {
        Some(version_id) => store::pinned_questions(&mut tx, version_id).await?,
        None => Vec::new(),
    };
    if attempt.assignment_version_id.is_some() && pinned.is_empty() {
        warn!(
            assignment_id,
            attempt_id,
            assignment_version_id = attempt.assignment_version_id,
            "pinned version has no questions; grading against live questions"
        );
    }
    let live = if pinned.is_empty() {
        store::live_grading_questions(&mut tx, assignment_id).await?
    } else {
        Vec::new()
    };
    let mut loaded = Loaded {
        attempt,
        settings,
        pinned,
        live,
        unresolved: Vec::new(),
        selections: Vec::new(),
        tier: Tier::Standard,
    };
    let source_ids: Vec<i32> = loaded.source_rows().iter().map(|r| r.served_id()).collect();
    let served = served_ids(&loaded, &source_ids);
    let missing: Vec<i32> = served
        .into_iter()
        .filter(|id| !source_ids.contains(id))
        .collect();
    loaded.unresolved = store::questions_by_ids(&mut tx, &missing)
        .await?
        .into_iter()
        .filter(|r| r.assignment_id == Some(assignment_id))
        .collect();
    loaded.tier = attempt_tier(&loaded.pinned, &loaded.unresolved);
    if !loaded.unresolved.is_empty() {
        warn!(
            assignment_id,
            attempt_id,
            fallback_questions = loaded.unresolved.len(),
            tier = ?loaded.tier,
            "served questions missing from the pinned version; grading their live rows"
        );
    }
    loaded.selections = store::frozen_selections(&mut tx, attempt_id).await?;
    tx.commit().await?;
    Ok(loaded)
}

/// The tier of what is graded: the pinned version's questions plus the live
/// rows standing in for served questions missing from it. Without a pinned
/// version the attempt is always queued.
fn attempt_tier(pinned: &[GradingQuestionRow], fallbacks: &[GradingQuestionRow]) -> Tier {
    if pinned.is_empty() {
        return Tier::Standard;
    }
    classify_tier(
        pinned
            .iter()
            .chain(fallbacks)
            .map(|r| r.question_type.as_str()),
    )
}

fn served_ids(loaded: &Loaded, source_ids: &[i32]) -> Vec<i32> {
    if !loaded.attempt.question_order.is_empty() {
        loaded.attempt.question_order.clone()
    } else if !loaded.settings.question_order.is_empty() {
        loaded.settings.question_order.clone()
    } else {
        source_ids.to_vec()
    }
}

fn plan_for(
    loaded: &Loaded,
    state: &LearnerState,
    user_id: &str,
    request: &SubmitRequest,
) -> Result<Plan, ApiError> {
    let source: Vec<(i32, QuestionMeta)> = loaded
        .source_rows()
        .iter()
        .map(|r| (r.served_id(), meta_of(r)))
        .collect();
    let unresolved: Vec<(i32, QuestionMeta)> = loaded
        .unresolved
        .iter()
        .map(|r| (r.row_id, meta_of(r)))
        .collect();
    resolve_plan(&PlanInput {
        attempt_id: loaded.attempt.id,
        assignment_id: loaded.attempt.assignment_id,
        user_id,
        attempt_question_order: &loaded.attempt.question_order,
        assignment_question_order: &loaded.settings.question_order,
        source: &source,
        unresolved: &unresolved,
        require_all_questions: loaded.settings.require_all_questions,
        optional_question_ids: &loaded.settings.optional_question_ids,
        learner_buckets: &state.submit.learner_buckets,
        request,
    })
}

pub async fn submit_attempt(
    State(state): State<LearnerState>,
    session: UserSession,
    path: Result<Path<(String, String)>, PathRejection>,
    headers: HeaderMap,
    request: Request,
) -> Result<Response, ApiError> {
    // The deadline is judged on arrival.
    let received_at = now_millis();
    session.require_role(&[Role::Learner])?;
    let (raw_assignment, raw_attempt) = raw_pair(path);
    let assignment_id = access::attempt_route_assignment_id(&raw_assignment, &session)?;
    let attempt_id = access::attempt_route_attempt_id(&raw_attempt, &session)?;
    let Some(internal) = state.submit.internal.clone() else {
        warn!(
            assignment_id,
            attempt_id, "submit refused: the internal grading API is not configured"
        );
        return Err(ApiError::unavailable());
    };
    info!(
        assignment_id,
        attempt_id,
        user_id = session.log_user(),
        "submit requested"
    );

    // Only the attempt's owner gets as far as sending a body.
    let attempt = authorize(&state, &session, assignment_id, attempt_id).await?;
    let request = read_request(request, &session, assignment_id, attempt_id).await?;
    let loaded = load(&state, attempt, assignment_id, attempt_id).await?;
    // attempt_item has refused learner sessions without a user id.
    let user_id = session.non_empty_user_id().unwrap_or_default().to_owned();
    let attempt = &loaded.attempt;

    if attempt.submitted {
        let reason = ClosedReason::from_comments(attempt.comments.as_deref());
        warn!(
            assignment_id,
            attempt_id,
            user_id,
            denial_reason = reason.as_str(),
            "submit rejected: attempt closed"
        );
        return Err(deadline::attempt_closed(attempt_id, reason));
    }

    let late = deadline::past_grace(attempt.expires_at, received_at);
    // Inline attempts never have a grading job, so only late or queued
    // submits need the lookup.
    if late || loaded.tier != Tier::Inline {
        let in_flight = internal
            .active_job(&user_id, assignment_id, attempt_id)
            .await?;
        match (in_flight, late) {
            (Some(job), _) => {
                info!(
                    assignment_id,
                    attempt_id,
                    user_id,
                    grading_job_id = %job,
                    late,
                    outcome = "reused_in_flight_job",
                    "submit answered"
                );
                return Ok(Json(SubmitQueued::new(job, true)).into_response());
            }
            (None, true) => return Err(close_late(&state, &loaded, &user_id, received_at).await),
            (None, false) => {}
        }
    }

    let plan = plan_for(&loaded, &state, &user_id, &request)?;
    match loaded.tier {
        Tier::Inline => grade_inline(&state, &session, &headers, &loaded, &request, &plan).await,
        Tier::Standard | Tier::Heavy => {
            enqueue(
                &internal,
                &session,
                &headers,
                &loaded,
                &request,
                received_at,
            )
            .await
        }
    }
}

/// A submit past the deadline with nothing in flight closes the attempt at
/// zero; it is refused either way.
async fn close_late(
    state: &LearnerState,
    loaded: &Loaded,
    user_id: &str,
    received_at: NaiveDateTime,
) -> ApiError {
    let attempt = &loaded.attempt;
    let late_by_ms = attempt
        .expires_at
        .map_or(0, |e| (received_at - e).num_milliseconds());
    let result = async {
        let mut tx = store::begin_write(&state.pool).await?;
        let changed =
            store::close_expired_attempt(&mut tx, attempt.id, deadline::EXPIRED_ATTEMPT_COMMENT)
                .await?;
        tx.commit().await?;
        Ok::<u64, sqlx::Error>(changed)
    }
    .await;
    match result {
        Ok(0) => {
            warn!(
                assignment_id = attempt.assignment_id,
                attempt_id = attempt.id,
                user_id,
                denial_reason = "already_submitted",
                "late submit found the attempt already closed"
            );
            deadline::attempt_closed(attempt.id, ClosedReason::AlreadySubmitted)
        }
        Ok(_) => {
            warn!(
                assignment_id = attempt.assignment_id,
                attempt_id = attempt.id,
                user_id,
                late_by_ms,
                denial_reason = "past_deadline",
                "submit rejected: attempt closed at its time limit"
            );
            deadline::attempt_closed(attempt.id, ClosedReason::TimeLimit)
        }
        Err(err) => err.into(),
    }
}

async fn enqueue(
    internal: &InternalApi,
    session: &UserSession,
    headers: &HeaderMap,
    loaded: &Loaded,
    request: &SubmitRequest,
    received_at: NaiveDateTime,
) -> Result<Response, ApiError> {
    let attempt = &loaded.attempt;
    let mut update_dto = Map::new();
    update_dto.insert("submitted".into(), Value::Bool(true));
    update_dto.insert(
        "responsesForQuestions".into(),
        Value::Array(
            request
                .responses
                .iter()
                .map(|r| Value::Object(r.forwarded.clone()))
                .collect(),
        ),
    );
    if let Some(language) = &request.language {
        update_dto.insert("language".into(), Value::from(language.clone()));
    }
    let cookie = auth_cookie(headers);
    let tier = if loaded.tier == Tier::Heavy {
        QueuedTier::Heavy
    } else {
        QueuedTier::Standard
    };
    let body = EnqueueRequest {
        assignment_id: attempt.assignment_id,
        attempt_id: attempt.id,
        user_id: session.non_empty_user_id().unwrap_or_default().to_owned(),
        grading_callback_required: session.grading_callback_required,
        auth_cookie: (session.grading_callback_required && !cookie.is_empty()).then_some(cookie),
        submission_received_at: iso(received_at),
        tier,
        update_dto,
    };
    match internal.enqueue(&body).await? {
        Enqueued::Job {
            grading_job_id,
            reused,
        } => {
            info!(
                assignment_id = attempt.assignment_id,
                attempt_id = attempt.id,
                user_id = session.log_user(),
                grading_job_id = %grading_job_id,
                reused,
                tier = ?tier,
                outcome = "queued",
                "submit answered"
            );
            Ok(Json(SubmitQueued::new(grading_job_id, reused)).into_response())
        }
        Enqueued::Refused { status, body } => {
            let code = body
                .get("code")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_owned();
            warn!(
                assignment_id = attempt.assignment_id,
                attempt_id = attempt.id,
                user_id = session.log_user(),
                denial_reason = "enqueue_refused",
                status = status.as_u16(),
                code,
                "submit rejected"
            );
            Err(ApiError::raw(status, body))
        }
    }
}

// ---------------------------------------------------------------- inline grading

/// Rows grading reads beyond the plan: live rows (fallback source and the
/// renderings' authored choices) and every stored translation.
struct GradingRows {
    live: Vec<GradingQuestionRow>,
    translations: Vec<QuestionTranslationRow>,
}

fn renderings_for(
    question_id: i32,
    selection: Option<&FrozenSelectionRow>,
    rows: &GradingRows,
) -> Vec<ChoiceRendering> {
    let live = rows.live.iter().find(|r| r.row_id == question_id);
    let base_choices = choice_match::parse_stored_choices(live.and_then(|r| r.choices.as_ref()));
    let variant = selection.and_then(|s| s.variant.as_ref());
    let variant_id = variant.map(|v| v.id);
    let own_choices = match variant {
        Some(v) => {
            choice_match::parse_stored_choices(v.choices.as_ref()).or_else(|| base_choices.clone())
        }
        None => base_choices.clone(),
    };
    let stored: Vec<StoredChoiceTranslation> = rows
        .translations
        .iter()
        .filter(|t| {
            t.question_id == Some(question_id)
                && (t.variant_id.is_none() || t.variant_id == variant_id)
        })
        .map(|t| StoredChoiceTranslation {
            language_code: t.language_code.clone(),
            variant_id: t.variant_id,
            translated_choices: t.translated_choices.clone(),
            untranslated_choices: t.untranslated_choices.clone(),
        })
        .collect();
    choice_match::build_renderings(
        own_choices.as_deref(),
        base_choices.as_deref(),
        variant_id,
        &stored,
    )
}

/// The question each graded id is graded against.
fn grading_questions(
    loaded: &Loaded,
    plan: &Plan,
    rows: &GradingRows,
    language: Option<&str>,
) -> Result<Vec<(GradingQuestion, Option<i32>)>, ApiError> {
    let pinned = question_source::keyed_by_served_id(&loaded.pinned);
    plan.graded
        .iter()
        .map(|id| {
            let selection = loaded.selections.iter().find(|s| s.question_id == *id);
            let base = pinned
                .iter()
                .find(|r| r.served_id() == *id)
                .copied()
                .or_else(|| rows.live.iter().find(|r| r.row_id == *id));
            let Some(base) = base else {
                return Err(ApiError::internal(&format!(
                    "question {id} of attempt {} not found for grading",
                    loaded.attempt.id
                )));
            };
            let version_only = base.question_id.is_none();
            let translation = match language {
                Some(lang) if lang != "en" && !version_only => question_source::find_translation(
                    &rows.translations,
                    *id,
                    selection.and_then(|s| s.variant.as_ref()).map(|v| v.id),
                    lang,
                ),
                _ => None,
            };
            Ok((
                question_source::grading_question(base, selection, translation),
                selection.and_then(|s| s.variant.as_ref()).map(|v| v.id),
            ))
        })
        .collect()
}

/// Grade every planned answer in the legacy order. The first failure of the
/// first wave that has one is the refusal.
fn grade_all(
    loaded: &Loaded,
    plan: &Plan,
    rows: &GradingRows,
    language: Option<&str>,
) -> Result<Vec<Graded>, ApiError> {
    let questions = grading_questions(loaded, plan, rows, language)?;
    let only_questions: Vec<GradingQuestion> = questions.iter().map(|(q, _)| q.clone()).collect();
    let Some(waves) = grading_waves(&only_questions) else {
        return Err(ApiError::internal(&format!(
            "cycle in question dependencies of assignment {}",
            loaded.attempt.assignment_id
        )));
    };
    let mut graded = Vec::with_capacity(plan.graded.len());
    for wave in waves {
        let mut first_error = None;
        for id in wave {
            let Some((question, _)) = questions.iter().find(|(q, _)| q.id == id) else {
                continue;
            };
            let Some(response) = plan.responses.iter().find(|r| r.id == id) else {
                continue;
            };
            let selection = loaded.selections.iter().find(|s| s.question_id == id);
            let renderings = if matches!(
                question.question_type.as_str(),
                "SINGLE_CORRECT" | "MULTIPLE_CORRECT"
            ) {
                renderings_for(id, selection, rows)
            } else {
                Vec::new()
            };
            let ctx = grading::Context {
                language,
                renderings: &renderings,
            };
            match grading::grade(question, response, &ctx) {
                Ok(g) => graded.push(g),
                Err(err) => {
                    warn!(
                        assignment_id = loaded.attempt.assignment_id,
                        attempt_id = loaded.attempt.id,
                        question_id = id,
                        error = %err.0,
                        "question could not be graded"
                    );
                    first_error.get_or_insert(err);
                }
            }
        }
        if let Some(err) = first_error {
            return Err(ApiError::nest(StatusCode::BAD_REQUEST, err.message()));
        }
    }
    Ok(graded)
}

async fn grading_rows(state: &LearnerState, plan: &Plan) -> Result<GradingRows, ApiError> {
    let mut tx = store::begin_read(&state.pool).await?;
    let live = store::questions_by_ids(&mut tx, &plan.graded).await?;
    let translations = store::translations_of_questions(&mut tx, &plan.graded, None).await?;
    tx.commit().await?;
    Ok(GradingRows { live, translations })
}

fn invalid_grade(loaded: &Loaded, detail: &str) -> ApiError {
    error!(
        assignment_id = loaded.attempt.assignment_id,
        attempt_id = loaded.attempt.id,
        detail,
        "submit could not compute a valid grade"
    );
    ApiError::internal(&detail)
}

/// The commit: every response row, the attempt (only while still open), the
/// prune of older rows and the progress row (if one exists) marked
/// complete, in one transaction.
async fn commit(
    state: &LearnerState,
    loaded: &Loaded,
    graded: &[Graded],
    grade: f64,
    language: &str,
) -> Result<Vec<i32>, ApiError> {
    let attempt_id = loaded.attempt.id;
    let mut rows = Vec::with_capacity(graded.len());
    let mut replaced = 0;
    for g in graded {
        let (row, count) = response_insert(g);
        replaced += count;
        rows.push(row);
    }
    if replaced > 0 {
        warn!(
            attempt_id,
            replacements = replaced,
            "removed NUL characters from graded responses before writing"
        );
    }
    let now = now_millis();
    let mut tx = store::begin_write(&state.pool).await?;
    store::set_local_lock_timeout(&mut tx).await?;
    match store::attempt_submitted(&mut tx, attempt_id).await? {
        None => {
            return Err(ApiError::nest(
                StatusCode::NOT_FOUND,
                format!("AssignmentAttempt with Id {attempt_id} not found."),
            ))
        }
        Some(true) => {
            return Err(ApiError::nest(
                StatusCode::CONFLICT,
                format!("Attempt {attempt_id} has already been submitted."),
            ))
        }
        Some(false) => {}
    }
    let ids = store::insert_question_responses(&mut tx, attempt_id, &rows, now).await?;
    let changed = store::commit_attempt(&mut tx, attempt_id, grade, language, now).await?;
    if changed == 0 {
        warn!(
            assignment_id = loaded.attempt.assignment_id,
            attempt_id,
            denial_reason = "concurrently_submitted",
            "submit lost the commit race; grading results discarded"
        );
        return Err(ApiError::nest(
            StatusCode::CONFLICT,
            format!(
                "Attempt {attempt_id} was concurrently submitted. Grading results were discarded to prevent duplicate submission."
            ),
        ));
    }
    let pruned = store::prune_question_responses(&mut tx, attempt_id, &ids).await?;
    let progress_rows = store::complete_grading_progress(&mut tx, attempt_id, now).await?;
    tx.commit().await?;
    info!(
        assignment_id = loaded.attempt.assignment_id,
        attempt_id,
        responses = ids.len(),
        pruned,
        progress_rows,
        grade,
        "submit committed"
    );
    Ok(ids)
}

async fn grade_inline(
    state: &LearnerState,
    session: &UserSession,
    headers: &HeaderMap,
    loaded: &Loaded,
    request: &SubmitRequest,
    plan: &Plan,
) -> Result<Response, ApiError> {
    let attempt = &loaded.attempt;
    if ai_grading_disabled() {
        let mut tx = store::begin_read(&state.pool).await?;
        let blocked = store::has_ai_graded_question(&mut tx, attempt.assignment_id).await?;
        tx.commit().await?;
        if blocked {
            warn!(
                assignment_id = attempt.assignment_id,
                attempt_id = attempt.id,
                user_id = session.log_user(),
                denial_reason = "ai_grading_disabled",
                "submit rejected"
            );
            return Err(ai_disabled());
        }
    }

    let language = request.language.as_deref();
    let rows = grading_rows(state, plan).await?;
    let graded = grade_all(loaded, plan, &rows, language)?;

    if plan.total_possible_points <= 0.0 {
        return Err(invalid_grade(
            loaded,
            &format!("invalid totalPossiblePoints {}", plan.total_possible_points),
        ));
    }
    let earned: f64 = graded.iter().map(|g| g.points.unwrap_or(f64::NAN)).sum();
    let grade = earned / plan.total_possible_points;
    if !(0.0..=1.0).contains(&grade) {
        return Err(invalid_grade(
            loaded,
            &format!(
                "grade {grade} out of range (earned {earned}, possible {})",
                plan.total_possible_points
            ),
        ));
    }

    let ids = commit(state, loaded, &graded, grade, language.unwrap_or("en")).await?;

    if session.grading_callback_required {
        let cookie = auth_cookie(headers);
        lti::sync(
            &state.pool,
            &state.submit.lti,
            lti::Passback {
                attempt_id: attempt.id,
                assignment_id: attempt.assignment_id,
                user_id: session.non_empty_user_id().unwrap_or_default(),
                auth_cookie: &cookie,
            },
            grade,
        )
        .await;
    }

    let settings = result_settings(&loaded.settings);
    let responses: Vec<ResultResponse> = graded
        .iter()
        .zip(&ids)
        .map(|(g, id)| ResultResponse {
            id: *id,
            question_id: g.question_id,
            points: g.points,
            feedback: g.feedback.clone(),
            metadata: g.metadata.clone(),
        })
        .collect();
    let result = submit_result::build(
        attempt.id,
        Some(grade),
        earned,
        plan.total_possible_points,
        &settings,
        &responses,
        language,
    );
    info!(
        assignment_id = attempt.assignment_id,
        attempt_id = attempt.id,
        user_id = session.log_user(),
        questions = graded.len(),
        outcome = "graded_inline",
        "submit answered"
    );
    Ok(Json(result).into_response())
}

/// The result settings from the base assignment row.
pub fn result_settings(row: &store::SubmitSettingsRow) -> ResultSettings {
    ResultSettings {
        show_assignment_score: row.show_assignment_score,
        show_submission_feedback: row.show_submission_feedback,
        show_questions: row.show_questions,
        show_question_score: row.show_question_score,
        show_pass_fail_indicator: row.show_pass_fail_indicator,
        passing_grade: row.passing_grade,
        correct_answer_visibility: row
            .current_version_visibility
            .clone()
            .unwrap_or_else(|| "NEVER".to_owned()),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn meta(points: i32, rt: Option<&str>) -> QuestionMeta {
        QuestionMeta {
            total_points: points,
            response_type: rt.map(str::to_owned),
        }
    }

    #[allow(clippy::needless_pass_by_value)] // json! literals at call sites
    fn request(items: Value) -> SubmitRequest {
        submit_request::parse(&json!({"submitted": true, "responsesForQuestions": items})).unwrap()
    }

    fn input<'a>(
        request: &'a SubmitRequest,
        source: &'a [(i32, QuestionMeta)],
        buckets: &'a [String],
    ) -> PlanInput<'a> {
        PlanInput {
            attempt_id: 71,
            assignment_id: 5,
            user_id: "l@x.com",
            attempt_question_order: &[],
            assignment_question_order: &[],
            source,
            unresolved: &[],
            require_all_questions: false,
            optional_question_ids: &[],
            learner_buckets: buckets,
            request,
        }
    }

    #[test]
    fn tiers() {
        assert_eq!(classify_tier([]), Tier::Standard);
        assert_eq!(
            classify_tier(["SINGLE_CORRECT", "TRUE_FALSE"]),
            Tier::Inline
        );
        assert_eq!(classify_tier(["SINGLE_CORRECT", "TEXT"]), Tier::Standard);
        assert_eq!(classify_tier(["TEXT", "LINK_FILE"]), Tier::Heavy);
    }

    #[test]
    fn served_set_and_denominator() {
        let source = vec![
            (1, meta(2, None)),
            (2, meta(3, Some("VIDEO"))),
            (3, meta(5, None)),
        ];
        let req = request(json!([{"id": 1, "learnerChoices": ["a"]}]));
        let plan = resolve_plan(&input(&req, &source, &[])).unwrap();
        assert_eq!(plan.served, vec![1, 2, 3]);
        assert_eq!(plan.graded, vec![1, 3]);
        // The unanswered served question counts against the learner.
        assert!((plan.total_possible_points - 7.0).abs() < f64::EPSILON);
        assert_eq!(plan.responses[1], SubmittedResponse::empty(3));
        // The attempt's own order wins, then the assignment's.
        let mut i = input(&req, &source, &[]);
        i.attempt_question_order = &[3, 1];
        let plan = resolve_plan(&i).unwrap();
        assert_eq!(plan.graded, vec![3, 1]);
    }

    #[test]
    fn unserved_and_duplicate_ids_are_refused() {
        let source = vec![(1, meta(1, None))];
        let req = request(json!([{"id": 1}, {"id": 9}, {"id": 1}, {"id": 9}]));
        let err = resolve_plan(&input(&req, &source, &[])).unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            err.message(),
            "Invalid question responses for attempt 71: unserved question IDs [9]; duplicate question IDs [1, 9]"
        );
    }

    #[test]
    fn media_files_gradable_and_required_refusals() {
        let source = vec![(1, meta(1, Some("AUDIO"))), (2, meta(1, None))];
        let req = request(json!([{"id": 1, "learnerTextResponse": "hi"}]));
        let err = resolve_plan(&input(&req, &source, &[])).unwrap_err();
        assert_eq!(err.body()["code"], "UNSUPPORTED_RESPONSE_TYPE");

        let req = request(
            json!([{"id": 2, "learnerFileResponse": [{"filename": "a", "key": "5/other@x.com/2/k-a", "bucket": "learner"}]}]),
        );
        let buckets = vec!["learner".to_owned()];
        let err = resolve_plan(&input(&req, &source, &buckets)).unwrap_err();
        assert_eq!(
            err.body().to_string(),
            r#"{"statusCode":400,"code":"INVALID_FILE_REFERENCE","message":"Invalid file reference.","error":"Bad Request"}"#
        );

        let only_media = vec![(1, meta(1, Some("PRESENTATION")))];
        let req = request(json!([]));
        let err = resolve_plan(&input(&req, &only_media, &[])).unwrap_err();
        assert_eq!(err.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(err.body()["code"], "NO_GRADABLE_QUESTIONS");

        let three = vec![(1, meta(1, None)), (2, meta(1, None)), (3, meta(1, None))];
        let req = request(
            json!([{"id": 1, "learnerAnswerChoice": true}, {"id": 2, "learnerTextResponse": "<p></p>"}]),
        );
        let mut i = input(&req, &three, &[]);
        i.require_all_questions = true;
        let err = resolve_plan(&i).unwrap_err();
        assert_eq!(
            err.message(),
            "All required questions must be answered before submitting (2 unanswered)."
        );
        i.optional_question_ids = &[3];
        assert_eq!(
            resolve_plan(&i).unwrap_err().message(),
            "All required questions must be answered before submitting (1 unanswered)."
        );
    }

    #[test]
    fn unresolved_served_questions_come_from_their_rows() {
        let source = vec![(1, meta(1, None))];
        let req = request(json!([]));
        let mut i = input(&req, &source, &[]);
        i.attempt_question_order = &[1, 4];
        assert_eq!(
            resolve_plan(&i).unwrap_err().status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        let unresolved = vec![(4, meta(2, None))];
        i.unresolved = &unresolved;
        let plan = resolve_plan(&i).unwrap();
        assert!((plan.total_possible_points - 3.0).abs() < f64::EPSILON);
    }

    #[test]
    fn file_reference_rules() {
        let buckets = vec!["learner".to_owned(), "learner-prod".to_owned()];
        let file = |bucket: &str, key: &str| {
            let mut m = Map::new();
            m.insert("filename".into(), json!("f"));
            m.insert("bucket".into(), json!(bucket));
            m.insert("key".into(), json!(key));
            m
        };
        let check = |f: Map<String, Value>| file_reference_denial(&[f], 5, "l@x.com", 2, &buckets);
        assert_eq!(check(file("learner-prod", "5/l@x.com/2/abc-f.py")), None);
        assert_eq!(
            check(file("", "k")),
            Some(FileDenial::MissingStorageReference)
        );
        assert_eq!(
            check(file("author", "5/l@x.com/2/x")),
            Some(FileDenial::BucketNotAllowed)
        );
        assert_eq!(
            check(file("learner", "5/l@x.com/2/../x")),
            Some(FileDenial::MalformedKey)
        );
        assert_eq!(
            check(file("learner", "5/l@x.com/2//x")),
            Some(FileDenial::MalformedKey)
        );
        assert_eq!(
            check(file("learner", "5/l@x.com/2/a\u{7}")),
            Some(FileDenial::MalformedKey)
        );
        assert_eq!(
            check(file("learner", "5/l@x.com/2/")),
            Some(FileDenial::MalformedKey)
        );
        assert_eq!(
            check(file("learner", "5/l@x.com/3/x")),
            Some(FileDenial::KeyOutsideLearnerPrefix)
        );
        assert_eq!(
            file_reference_denial(&[file("learner", "5//2/x")], 5, "", 2, &buckets),
            Some(FileDenial::KeyOutsideLearnerPrefix)
        );
    }

    #[test]
    fn waves_follow_dependencies() {
        let q = |id: i32, deps: Vec<i32>| GradingQuestion {
            id,
            grading_context_question_ids: deps,
            ..GradingQuestion::default()
        };
        let waves =
            grading_waves(&[q(1, vec![]), q(2, vec![3]), q(3, vec![]), q(4, vec![99])]).unwrap();
        assert_eq!(waves, vec![vec![1, 3, 4], vec![2]]);
        assert_eq!(grading_waves(&[q(1, vec![2]), q(2, vec![1])]), None);
    }

    #[test]
    fn stored_encodings() {
        let graded = Graded {
            question_id: 3,
            learner_response: json!(["a\u{0}b"]),
            points: Some(1.0),
            feedback: vec![json!({"choice": "a", "feedback": "ok\u{0}"})],
            metadata: Some(json!({"isCorrect": true, "maxPossiblePoints": 1})),
        };
        let (row, replaced) = response_insert(&graded);
        assert_eq!(replaced, 2);
        assert_eq!(row.learner_response, r#"["ab"]"#);
        assert_eq!(row.feedback, r#"[{"choice":"a","feedback":"ok"}]"#);
        assert_eq!(
            row.metadata.as_deref(),
            Some(r#""{\"isCorrect\":true,\"maxPossiblePoints\":1}""#)
        );
        let empty = Graded {
            question_id: 3,
            learner_response: json!(""),
            points: None,
            feedback: vec![],
            metadata: None,
        };
        let (row, _) = response_insert(&empty);
        assert_eq!(row.learner_response, r#""""#);
        assert!(row.points.abs() < f64::EPSILON);
        assert_eq!(row.metadata, None);
    }

    #[test]
    fn auth_cookie_first_wins_and_is_decoded() {
        let mut headers = HeaderMap::new();
        headers.append(
            header::COOKIE,
            "a=1; authentication=tok%2Eone; authentication=two"
                .parse()
                .unwrap(),
        );
        assert_eq!(auth_cookie(&headers), "tok.one");
        let mut headers = HeaderMap::new();
        headers.append(header::COOKIE, "authentication=\"quoted\"".parse().unwrap());
        assert_eq!(auth_cookie(&headers), "quoted");
        assert_eq!(auth_cookie(&HeaderMap::new()), "");
    }

    #[test]
    fn queued_bodies() {
        assert_eq!(
            serde_json::to_string(&SubmitQueued::new("j-1".into(), false)).unwrap(),
            r#"{"gradingJobId":"j-1","message":"Grading job created. Use the SSE endpoint to track progress."}"#
        );
        assert_eq!(
            SubmitQueued::new("j".into(), true).message,
            REUSED_JOB_MESSAGE
        );
    }
}
