//! Attempt routes: list, create-or-resume, read one, abandon.

use axum::extract::rejection::PathRejection;
use axum::extract::{Path, RawQuery, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{Duration, NaiveDateTime};
use rand::RngExt;
use serde::Serialize;
use serde_json::Value;
use sqlx::Acquire;
use tracing::{info, warn};

use crate::access::{self, Intent};
use crate::attempt_view::{self, AttemptQuestion, ViewContext};
use crate::choices;
use crate::error::{ApiError, ErrorCode};
use crate::params::{iso, iso_opt, like_prefix, now_millis, whole_f64, Lang};
use crate::principal::{Role, UserSession};
use crate::shuffle;
use crate::store::{
    self, AttemptRow, FrozenSelectionInsert, Owner, PoolQuestionRow, PoolVariantRow,
};
use crate::LearnerState;

// ---------------------------------------------------------------- shapes

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptSummary {
    pub id: i32,
    pub assignment_id: i32,
    pub assignment_version_id: Option<i32>,
    pub user_id: String,
    pub submitted: bool,
    #[serde(serialize_with = "whole_f64")]
    pub grade: Option<f64>,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub question_order: Vec<i32>,
    pub comments: Option<String>,
    pub preferred_language: Option<String>,
}

/// `grade` only for submitted attempts whose assignment shows the score.
pub fn summary(row: &AttemptRow, show_assignment_score: bool) -> AttemptSummary {
    AttemptSummary {
        id: row.id,
        assignment_id: row.assignment_id,
        assignment_version_id: row.assignment_version_id,
        user_id: row.user_id.clone(),
        submitted: row.submitted,
        grade: row.grade.filter(|_| show_assignment_score && row.submitted),
        expires_at: iso_opt(row.expires_at),
        created_at: iso(row.created_at),
        question_order: row.question_order.clone(),
        comments: row.comments.clone(),
        preferred_language: row.preferred_language.clone(),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptCreated {
    pub id: i32,
    pub success: bool,
    pub server_now: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AttemptAbandoned {
    pub id: i32,
    pub success: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionResponseView {
    pub id: i32,
    pub assignment_attempt_id: i32,
    pub question_id: i32,
    pub learner_response: Value,
    #[serde(serialize_with = "whole_f64")]
    pub points: Option<f64>,
    pub feedback: Value,
    pub metadata: Value,
    pub graded_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRef {
    pub id: i32,
    pub alloted_time_minutes: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)] // wire shape fixed by the contract
pub struct AttemptView {
    #[serde(flatten)]
    pub summary: AttemptSummary,
    pub server_now: String,
    pub questions: Vec<AttemptQuestion>,
    pub question_responses: Vec<QuestionResponseView>,
    pub passing_grade: i32,
    pub show_assignment_score: bool,
    pub show_submission_feedback: bool,
    pub show_question_score: bool,
    pub show_questions: bool,
    pub correct_answer_visibility: String,
    pub current_version_id: Option<i32>,
    pub version_mismatch: bool,
    pub assignment_version: Option<VersionRef>,
}

// ---------------------------------------------------------------- helpers

fn raw_pair(path: Result<Path<(String, String)>, PathRejection>) -> (String, String) {
    path.map(|Path(p)| p).unwrap_or_default()
}

fn raw_one(path: Result<Path<String>, PathRejection>) -> String {
    path.map(|Path(p)| p).unwrap_or_default()
}

/// The legacy `"1"/"true"/"yes"` env idiom, case-insensitive.
fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .is_ok_and(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
}

/// The AI grading kill switch (`AI_FEATURES_DISABLED` or `AI_GRADING_DISABLED`).
pub fn ai_grading_disabled() -> bool {
    env_flag("AI_FEATURES_DISABLED") || env_flag("AI_GRADING_DISABLED")
}

// ---------------------------------------------------------------- list

pub async fn list_attempts(
    State(state): State<LearnerState>,
    session: UserSession,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<Vec<AttemptSummary>>, ApiError> {
    let role = session.require_role(&[Role::Learner, Role::Author])?;
    let assignment_id = access::attempt_route_assignment_id(&raw_one(path), &session)?;
    info!(
        assignment_id,
        user_id = session.log_user(),
        role = role.as_str(),
        "list attempts requested"
    );

    let mut conn = state.pool.acquire().await?;
    access::attempt_collection(&mut conn, &session, role, assignment_id).await?;
    let owner = match role {
        Role::Learner => match session.non_empty_user_id() {
            Some(user) => Owner::User(user),
            None => {
                warn!(
                    assignment_id,
                    denial_reason = "missing_session_user_id",
                    "list attempts denied"
                );
                return Err(ApiError::forbidden_resource());
            }
        },
        Role::Author | Role::Admin => Owner::Anyone,
    };
    let show_score = store::attempt_settings(&mut conn, assignment_id)
        .await?
        .is_some_and(|s| s.show_assignment_score);
    let rows = store::list_attempts(&mut conn, assignment_id, owner).await?;
    info!(
        assignment_id,
        count = rows.len(),
        outcome = "ok",
        "list attempts served"
    );
    Ok(Json(rows.iter().map(|r| summary(r, show_score)).collect()))
}

// ---------------------------------------------------------------- create

fn not_published() -> ApiError {
    ApiError::coded(
        StatusCode::FORBIDDEN,
        ErrorCode::AssignmentNotPublished,
        "This assignment is not published.",
    )
}

fn ai_disabled() -> ApiError {
    ApiError::coded(
        StatusCode::CONFLICT,
        ErrorCode::AiTemporarilyDisabled,
        "This activity is temporarily out of service. Please try again later.",
    )
}

fn in_progress() -> ApiError {
    ApiError::coded(
        StatusCode::UNPROCESSABLE_ENTITY,
        ErrorCode::AttemptInProgress,
        "A attempt is already in progress and has not expired.",
    )
}

fn time_range_exceeded() -> ApiError {
    ApiError::coded(
        StatusCode::UNPROCESSABLE_ENTITY,
        ErrorCode::AttemptTimeRangeExceeded,
        "You have exceeded the allowed number of attempts within the specified time range.",
    )
}

fn max_reached() -> ApiError {
    ApiError::coded(
        StatusCode::UNPROCESSABLE_ENTITY,
        ErrorCode::AttemptMaxReached,
        "Maximum number of attempts reached for this assignment.",
    )
}

fn in_cooldown() -> ApiError {
    ApiError::plain(
        StatusCode::TOO_MANY_REQUESTS,
        "You must wait some time before creating a new attempt for this assignment",
    )
}

/// Cooldown: the last submitted attempt's reference time, clamped to now,
/// plus the cooldown must have passed.
pub fn cooldown_blocks(
    now: NaiveDateTime,
    last_reference: NaiveDateTime,
    cooldown_minutes: i32,
) -> bool {
    let last = last_reference.min(now);
    now < last + Duration::minutes(i64::from(cooldown_minutes))
}

/// `expiresAt` for a new attempt: now + allotted minutes when positive.
pub fn expires_at(now: NaiveDateTime, alloted_time_minutes: Option<i32>) -> Option<NaiveDateTime> {
    alloted_time_minutes
        .filter(|m| *m > 0)
        .map(|m| now + Duration::minutes(i64::from(m)))
}

/// Ordering inputs from the base `Assignment` row.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OrderSettings {
    pub number_of_questions_per_attempt: Option<i32>,
    pub random_order: bool,
    pub question_order: Vec<i32>,
}

/// Subset (seeded by `attemptId ^ assignmentId`) then order (seeded
/// shuffle when RANDOM, else the base `questionOrder`).
pub fn plan_questions<T>(
    mut pool: Vec<T>,
    settings: &OrderSettings,
    attempt_id: i32,
    assignment_id: i32,
    id: impl Fn(&T) -> i32,
) -> Vec<T> {
    let selection = shuffle::selection_seed(attempt_id, assignment_id);
    let requested = settings.number_of_questions_per_attempt.unwrap_or(0);
    if requested > 0 {
        let wanted = usize::try_from(requested).unwrap_or(usize::MAX);
        if wanted > pool.len() {
            warn!(
                assignment_id,
                requested,
                pool = pool.len(),
                "numberOfQuestionsPerAttempt exceeds the question pool; serving the whole pool"
            );
        }
        shuffle::deterministic_shuffle(&mut pool, i64::from(selection));
        pool.truncate(wanted);
    }
    if settings.random_order {
        shuffle::deterministic_shuffle(&mut pool, i64::from(shuffle::ordering_seed(selection)));
        pool
    } else if settings.question_order.is_empty() {
        pool
    } else {
        shuffle::apply_question_order(pool, &settings.question_order, id)
    }
}

/// Pick a variant uniformly from `[none, ...variants]` and freeze the
/// chosen source's choice order.
pub fn freeze_selection(
    question: &PoolQuestionRow,
    variants: &[&PoolVariantRow],
    rng: &mut impl rand::Rng,
) -> FrozenSelectionInsert {
    let pick = rng.random_range(0..=variants.len());
    match pick.checked_sub(1).and_then(|i| variants.get(i)) {
        Some(v) => FrozenSelectionInsert {
            question_id: question.id,
            variant_id: Some(v.id),
            randomized_choices: choices::freeze_choices(
                v.choices.as_ref(),
                v.randomized_choices == Some(true),
                rng,
            ),
        },
        None => {
            // Authored choices are parsed with a [] fallback first.
            let authored = choices::parse_json_value(question.choices.as_ref())
                .unwrap_or(Value::Array(Vec::new()));
            FrozenSelectionInsert {
                question_id: question.id,
                variant_id: None,
                randomized_choices: choices::freeze_choices(
                    Some(&authored),
                    question.randomized_choices == Some(true),
                    rng,
                ),
            }
        }
    }
}

/// Live variants belonging to a pool row. A version row with a null
/// `questionId` has none: its served id is the version row's own id, which
/// may coincide with an unrelated live question's id.
pub fn variants_of<'a>(
    question: &PoolQuestionRow,
    variants: &'a [PoolVariantRow],
) -> Vec<&'a PoolVariantRow> {
    let Some(live_id) = question.live_question_id else {
        return Vec::new();
    };
    variants
        .iter()
        .filter(|v| v.question_id == live_id)
        .collect()
}

fn freeze_all(pool: &[PoolQuestionRow], variants: &[PoolVariantRow]) -> Vec<FrozenSelectionInsert> {
    let mut rng = rand::rng();
    pool.iter()
        .map(|q| freeze_selection(q, &variants_of(q, variants), &mut rng))
        .collect()
}

/// The contract's validation order, run under the creation lock with the
/// base `Assignment` row's settings.
async fn validate_new_attempt(
    conn: &mut sqlx::PgConnection,
    base: &store::SettingsRow,
    assignment_id: i32,
    user_id: &str,
    now: NaiveDateTime,
) -> Result<(), ApiError> {
    // 1. published
    if base.published != Some(true) {
        return Err(not_published());
    }
    // 2. kill switch
    if ai_grading_disabled() && store::has_ai_graded_question(&mut *conn, assignment_id).await? {
        return Err(ai_disabled());
    }
    // 3. active attempt (unreachable after the re-check except by clock race)
    if store::find_resumable(&mut *conn, assignment_id, user_id, now)
        .await?
        .is_some()
    {
        return Err(in_progress());
    }
    // 4. attempts per time range
    if let Some(limit) = base.attempts_per_time_range.filter(|n| *n != 0) {
        let from = base
            .attempts_time_range_hours
            .filter(|h| *h != 0)
            .map_or(now, |h| now - Duration::hours(i64::from(h)));
        let used =
            store::count_attempts_between(&mut *conn, assignment_id, user_id, from, now).await?;
        if used >= i64::from(limit) {
            return Err(time_range_exceeded());
        }
    }
    // 5. max attempts, 6. cooldown (only when attempts are limited)
    if let Some(max) = base.num_attempts.filter(|n| *n != -1) {
        let total = store::count_attempts(&mut *conn, assignment_id, user_id).await?;
        if total >= i64::from(max) {
            return Err(max_reached());
        }
        let before = base.attempts_before_cool_down.unwrap_or(1);
        let minutes = base.retake_attempt_cool_down_minutes.unwrap_or(0);
        if before > 0 && minutes > 0 && total >= i64::from(before) {
            if let Some(reference) =
                store::last_submitted_reference(&mut *conn, assignment_id, user_id).await?
            {
                if cooldown_blocks(now, reference, minutes) {
                    return Err(in_cooldown());
                }
            }
        }
    }
    Ok(())
}

/// Insert the attempt, pick and order its questions, and freeze variant and
/// choice order. Runs inside the creation transaction.
async fn insert_new_attempt(
    conn: &mut sqlx::PgConnection,
    assignment: &store::AssignmentRow,
    user_id: &str,
    now: NaiveDateTime,
) -> Result<(i32, usize), ApiError> {
    let base = &assignment.settings;
    let attempt_id = store::insert_attempt(
        &mut *conn,
        assignment.id,
        assignment.current_version_id,
        user_id,
        expires_at(now, base.alloted_time_minutes),
    )
    .await?;

    let mut pool = match assignment.current_version_id {
        Some(version_id) => store::version_pool(&mut *conn, version_id).await?,
        None => Vec::new(),
    };
    if pool.is_empty() {
        pool = store::live_pool(&mut *conn, assignment.id).await?;
    }
    let variants = store::live_variants(&mut *conn, assignment.id).await?;
    let settings = OrderSettings {
        number_of_questions_per_attempt: base.number_of_questions_per_attempt,
        random_order: base.display_order.as_deref() == Some("RANDOM"),
        question_order: base.question_order.clone(),
    };
    let ordered = plan_questions(pool, &settings, attempt_id, assignment.id, |q| q.id);
    let order: Vec<i32> = ordered.iter().map(|q| q.id).collect();
    store::set_question_order(&mut *conn, attempt_id, &order).await?;
    let selections = freeze_all(&ordered, &variants);
    store::insert_frozen_selections(&mut *conn, attempt_id, &selections).await?;
    Ok((attempt_id, order.len()))
}

pub async fn create_attempt(
    State(state): State<LearnerState>,
    session: UserSession,
    path: Result<Path<String>, PathRejection>,
) -> Result<(StatusCode, Json<AttemptCreated>), ApiError> {
    session.require_role(&[Role::Learner])?;
    let assignment_id = access::attempt_route_assignment_id(&raw_one(path), &session)?;
    let Some(user_id) = session.non_empty_user_id() else {
        warn!(
            assignment_id,
            denial_reason = "missing_session_user_id",
            "create attempt denied"
        );
        return Err(ApiError::forbidden_resource());
    };
    info!(assignment_id, user_id, "create attempt requested");

    let mut conn = state.pool.acquire().await?;
    access::attempt_collection(&mut conn, &session, Role::Learner, assignment_id).await?;

    let created = |id: i32, how: &str| {
        info!(
            assignment_id,
            attempt_id = id,
            user_id,
            outcome = how,
            "create attempt answered"
        );
        Ok((
            StatusCode::CREATED,
            Json(AttemptCreated {
                id,
                success: true,
                server_now: iso(now_millis()),
            }),
        ))
    };

    if let Some(id) = store::find_resumable(&mut conn, assignment_id, user_id, now_millis()).await?
    {
        return created(id, "resumed");
    }
    let Some(assignment) = store::load_assignment(&mut conn, assignment_id).await? else {
        return Err(ApiError::nest(
            StatusCode::NOT_FOUND,
            "Assignment not found",
        ));
    };
    let base = &assignment.settings;

    let mut tx = conn.begin().await?;
    store::set_local_lock_timeout(&mut tx).await?;
    store::lock_attempt_creation(&mut tx, &format!("{user_id}:{assignment_id}")).await?;
    let now = now_millis();
    if let Some(id) = store::find_resumable(&mut tx, assignment_id, user_id, now).await? {
        warn!(
            assignment_id,
            attempt_id = id,
            user_id,
            "resumable attempt appeared while waiting for the creation lock"
        );
        tx.commit().await?;
        return created(id, "resumed_under_lock");
    }

    if let Err(err) = validate_new_attempt(&mut tx, base, assignment_id, user_id, now).await {
        info!(
            assignment_id,
            user_id,
            status = err.status().as_u16(),
            reason = err.message(),
            "create attempt refused"
        );
        return Err(err);
    }

    let (attempt_id, question_count) =
        insert_new_attempt(&mut tx, &assignment, user_id, now).await?;
    tx.commit().await?;

    info!(
        assignment_id,
        attempt_id,
        questions = question_count,
        "attempt created"
    );
    created(attempt_id, "created")
}

// ---------------------------------------------------------------- read one

async fn load_translations(
    conn: &mut sqlx::PgConnection,
    lang: &Lang,
    sources: &[store::SourceQuestion],
    selections: &[store::FrozenSelectionRow],
) -> Result<Vec<store::TranslationRow>, ApiError> {
    if lang.is_authored() {
        return Ok(Vec::new());
    }
    let question_ids: Vec<i32> = sources.iter().map(|q| q.id).collect();
    let variant_ids: Vec<i32> = selections
        .iter()
        .filter_map(|s| s.variant.as_ref().map(|v| v.id))
        .collect();
    Ok(store::question_translations(
        conn,
        &like_prefix(&lang.family),
        &question_ids,
        &variant_ids,
    )
    .await?)
}

impl From<store::ResponseRow> for QuestionResponseView {
    fn from(r: store::ResponseRow) -> Self {
        Self {
            id: r.id,
            assignment_attempt_id: r.assignment_attempt_id,
            question_id: r.question_id,
            learner_response: Value::String(r.learner_response),
            points: Some(r.points),
            feedback: r.feedback,
            metadata: r.metadata.unwrap_or(Value::Null),
            graded_at: iso_opt(r.graded_at),
        }
    }
}

pub async fn get_attempt(
    State(state): State<LearnerState>,
    session: UserSession,
    path: Result<Path<(String, String)>, PathRejection>,
    RawQuery(query): RawQuery,
) -> Result<Json<AttemptView>, ApiError> {
    let role = session.require_role(&[Role::Learner, Role::Author])?;
    let (raw_assignment, raw_attempt) = raw_pair(path);
    let assignment_id = access::attempt_route_assignment_id(&raw_assignment, &session)?;
    let attempt_id = access::attempt_route_attempt_id(&raw_attempt, &session)?;
    let lang = Lang::from_query(query.as_deref());
    info!(assignment_id, attempt_id, user_id = session.log_user(), role = role.as_str(), lang = %lang.code, "get attempt requested");

    let mut conn = state.pool.acquire().await?;
    let attempt = access::attempt_item(
        &mut conn,
        &session,
        role,
        assignment_id,
        attempt_id,
        Intent::Read,
    )
    .await?;
    let Some(settings) = store::attempt_settings(&mut conn, assignment_id).await? else {
        return Err(ApiError::nest(
            StatusCode::NOT_FOUND,
            "Assignment not found",
        ));
    };

    let (sources, version) = match attempt.assignment_version_id {
        Some(version_id) => (
            store::version_questions(&mut conn, version_id).await?,
            store::version_alloted_time(&mut conn, version_id).await?,
        ),
        None => (store::live_questions(&mut conn, assignment_id).await?, None),
    };
    let selections = store::frozen_selections(&mut conn, attempt.id).await?;
    let translations = load_translations(&mut conn, &lang, &sources, &selections).await?;
    let responses = store::question_responses(&mut conn, attempt.id).await?;

    let passing_grade = settings
        .passing_grade
        .unwrap_or(crate::assignment::defaults::PASSING_GRADE);
    let visibility = settings
        .current_version_visibility
        .clone()
        .unwrap_or_else(|| "NEVER".to_owned());
    let reveal =
        attempt_view::reveal_answers(attempt.submitted, &visibility, attempt.grade, passing_grade);
    let questions = attempt_view::build_questions(
        &sources,
        &selections,
        &translations,
        &ViewContext {
            assignment_id,
            lang: &lang,
            reveal,
            question_order: &attempt.question_order,
        },
    );
    let version_mismatch = matches!(
        (attempt.assignment_version_id, settings.current_version_id),
        (Some(a), Some(c)) if a != c
    );
    let view = AttemptView {
        summary: summary(&attempt, settings.show_assignment_score),
        server_now: iso(now_millis()),
        questions,
        question_responses: responses.into_iter().map(Into::into).collect(),
        passing_grade,
        show_assignment_score: settings.show_assignment_score,
        show_submission_feedback: settings.show_submission_feedback,
        show_question_score: settings.show_question_score,
        show_questions: settings.show_questions,
        correct_answer_visibility: visibility,
        current_version_id: settings.current_version_id,
        version_mismatch,
        assignment_version: version.map(|(id, alloted_time_minutes)| VersionRef {
            id,
            alloted_time_minutes,
        }),
    };
    info!(
        assignment_id,
        attempt_id,
        questions = view.questions.len(),
        reveal,
        outcome = "ok",
        "get attempt served"
    );
    Ok(Json(view))
}

// ---------------------------------------------------------------- abandon

fn unprocessable(message: &str) -> ApiError {
    ApiError::nest(StatusCode::UNPROCESSABLE_ENTITY, message)
}

pub async fn abandon_attempt(
    State(state): State<LearnerState>,
    session: UserSession,
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<(StatusCode, Json<AttemptAbandoned>), ApiError> {
    let role = session.require_role(&[Role::Learner, Role::Author])?;
    let (raw_assignment, raw_attempt) = raw_pair(path);
    let assignment_id = access::attempt_route_assignment_id(&raw_assignment, &session)?;
    let attempt_id = access::attempt_route_attempt_id(&raw_attempt, &session)?;
    info!(
        assignment_id,
        attempt_id,
        user_id = session.log_user(),
        role = role.as_str(),
        "abandon attempt requested"
    );

    let mut conn = state.pool.acquire().await?;
    access::attempt_item(
        &mut conn,
        &session,
        role,
        assignment_id,
        attempt_id,
        Intent::Write,
    )
    .await?;

    let mut tx = conn.begin().await?;
    let Some(check) = store::lock_attempt_for_abandon(&mut tx, attempt_id).await? else {
        return Err(ApiError::nest(
            StatusCode::NOT_FOUND,
            "Attempt not found or not owned by the user",
        ));
    };
    let refusal = if check.submitted {
        Some("This attempt has already been submitted.")
    } else if check.responses > 0 {
        Some("Cannot abandon an attempt that already has saved responses.")
    } else if check.current_version_id.is_none() {
        Some("This assignment has no active version.")
    } else if check.assignment_version_id == check.current_version_id {
        Some("Attempt is already pinned to the current version; no need to abandon.")
    } else {
        None
    };
    if let Some(message) = refusal {
        info!(
            assignment_id,
            attempt_id,
            outcome = message,
            "abandon attempt refused"
        );
        return Err(unprocessable(message));
    }
    store::delete_attempt(&mut tx, attempt_id).await?;
    tx.commit().await?;
    info!(
        assignment_id,
        attempt_id,
        outcome = "deleted",
        "attempt abandoned"
    );
    Ok((
        StatusCode::CREATED,
        Json(AttemptAbandoned {
            id: attempt_id,
            success: true,
        }),
    ))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn at(h: u32, m: u32) -> NaiveDateTime {
        chrono::NaiveDate::from_ymd_opt(2026, 10, 23)
            .unwrap()
            .and_hms_opt(h, m, 0)
            .unwrap()
    }

    #[test]
    fn cooldown_and_expiry() {
        assert!(cooldown_blocks(at(10, 3), at(10, 0), 5));
        assert!(!cooldown_blocks(at(10, 5), at(10, 0), 5));
        // A reference in the future is clamped to now.
        assert!(cooldown_blocks(at(10, 0), at(12, 0), 1));
        assert_eq!(expires_at(at(10, 0), Some(30)), Some(at(10, 30)));
        assert_eq!(expires_at(at(10, 0), Some(0)), None);
        assert_eq!(expires_at(at(10, 0), None), None);
    }

    #[test]
    fn plan_subsets_then_orders() {
        let pool: Vec<i32> = (1..=8).collect();
        // Defined order: listed ids first.
        let s = OrderSettings {
            question_order: vec![5, 1],
            ..OrderSettings::default()
        };
        assert_eq!(
            plan_questions(pool.clone(), &s, 1, 1, |x| *x),
            vec![5, 1, 2, 3, 4, 6, 7, 8]
        );
        // RANDOM uses the ordering seed: attempt 123 ^ assignment 45 = 86.
        let s = OrderSettings {
            random_order: true,
            ..OrderSettings::default()
        };
        assert_eq!(
            plan_questions(pool.clone(), &s, 123, 45, |x| *x),
            vec![6, 4, 8, 2, 1, 3, 7, 5]
        );
        // Subset uses the selection seed and clamps oversized counts.
        let s = OrderSettings {
            number_of_questions_per_attempt: Some(3),
            ..OrderSettings::default()
        };
        let mut expected = pool.clone();
        shuffle::deterministic_shuffle(&mut expected, 86);
        expected.truncate(3);
        assert_eq!(plan_questions(pool.clone(), &s, 123, 45, |x| *x), expected);
        let s = OrderSettings {
            number_of_questions_per_attempt: Some(100),
            ..OrderSettings::default()
        };
        assert_eq!(plan_questions(pool, &s, 123, 45, |x| *x).len(), 8);
    }

    #[test]
    fn freeze_selection_stores_json_text() {
        let q = PoolQuestionRow {
            id: 4,
            live_question_id: Some(4),
            choices: Some(json!([{"id": 1, "choice": "a", "isCorrect": true}])),
            randomized_choices: Some(false),
        };
        let mut rng = rand::rng();
        let row = freeze_selection(&q, &[], &mut rng);
        assert_eq!(row.variant_id, None);
        assert_eq!(
            row.randomized_choices.as_deref(),
            Some(r#"[{"id":1,"choice":"a","isCorrect":true}]"#)
        );
        let v = PoolVariantRow {
            id: 9,
            question_id: 4,
            choices: None,
            randomized_choices: Some(true),
        };
        let mut seen_variant = false;
        for _ in 0..200 {
            let row = freeze_selection(&q, &[&v], &mut rng);
            if row.variant_id == Some(9) {
                seen_variant = true;
                assert_eq!(row.randomized_choices.as_deref(), Some("[]"));
            }
        }
        assert!(seen_variant);
    }

    #[test]
    fn null_question_id_version_rows_get_no_variants() {
        let variant = |id, question_id| PoolVariantRow {
            id,
            question_id,
            choices: None,
            randomized_choices: None,
        };
        let variants = vec![variant(1, 40), variant(2, 41), variant(3, 40)];
        // A version row whose questionId is null serves its own id (40),
        // which collides with live question 40; it must not take 40's variants.
        let orphan = PoolQuestionRow {
            id: 40,
            live_question_id: None,
            choices: None,
            randomized_choices: None,
        };
        assert!(variants_of(&orphan, &variants).is_empty());
        let linked = PoolQuestionRow {
            id: 40,
            live_question_id: Some(40),
            ..orphan
        };
        let ids: Vec<i32> = variants_of(&linked, &variants)
            .iter()
            .map(|v| v.id)
            .collect();
        assert_eq!(ids, vec![1, 3]);
    }

    #[test]
    fn summary_hides_grade() {
        let row = AttemptRow {
            id: 1,
            assignment_id: 2,
            assignment_version_id: None,
            user_id: "u".into(),
            submitted: true,
            grade: Some(0.5),
            expires_at: None,
            created_at: at(1, 2),
            question_order: vec![3],
            comments: None,
            preferred_language: None,
        };
        assert_eq!(summary(&row, true).grade, Some(0.5));
        assert_eq!(summary(&row, false).grade, None);
        let open = AttemptRow {
            submitted: false,
            ..row
        };
        assert_eq!(summary(&open, true).grade, None);
        let wire = serde_json::to_value(summary(&open, true)).unwrap();
        assert_eq!(wire["createdAt"], "2026-10-23T01:02:00.000Z");
        assert_eq!(wire["expiresAt"], Value::Null);
        assert_eq!(wire.as_object().unwrap().len(), 11);
    }

    #[test]
    fn whole_number_floats_render_as_integers() {
        let row = AttemptRow {
            id: 1,
            assignment_id: 2,
            assignment_version_id: None,
            user_id: "u".into(),
            submitted: true,
            grade: Some(1.0),
            expires_at: None,
            created_at: at(1, 2),
            question_order: vec![],
            comments: None,
            preferred_language: None,
        };
        let text = serde_json::to_string(&summary(&row, true)).unwrap();
        assert!(text.contains(r#""grade":1,"#), "{text}");
        let half = AttemptRow {
            grade: Some(0.5),
            ..row.clone()
        };
        let text = serde_json::to_string(&summary(&half, true)).unwrap();
        assert!(text.contains(r#""grade":0.5,"#), "{text}");
        let zero = AttemptRow {
            grade: Some(0.0),
            ..row.clone()
        };
        let text = serde_json::to_string(&summary(&zero, true)).unwrap();
        assert!(text.contains(r#""grade":0,"#), "{text}");
        let text = serde_json::to_string(&summary(&row, false)).unwrap();
        assert!(text.contains(r#""grade":null,"#), "{text}");

        let response = |points| QuestionResponseView {
            id: 1,
            assignment_attempt_id: 1,
            question_id: 1,
            learner_response: Value::String("x".into()),
            points,
            feedback: Value::Null,
            metadata: Value::Null,
            graded_at: None,
        };
        let text = serde_json::to_string(&response(Some(2.0))).unwrap();
        assert!(text.contains(r#""points":2,"#), "{text}");
        let text = serde_json::to_string(&response(Some(1.5))).unwrap();
        assert!(text.contains(r#""points":1.5,"#), "{text}");
        let text = serde_json::to_string(&response(None)).unwrap();
        assert!(text.contains(r#""points":null,"#), "{text}");
    }
}
