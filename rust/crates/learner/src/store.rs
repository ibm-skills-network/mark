//! Every SQL statement the learner routes run, one small function each.
//!
//! Rules (pgbouncer transaction pooling, shared with the legacy app):
//! unnamed statements only (`persistent(false)`), no session-level `SET`,
//! `PREPARE`, `LISTEN` or session advisory locks. The only lock is the
//! transaction-scoped `pg_advisory_xact_lock` taken by attempt creation.
//!
//! Every statement must run inside an explicit transaction ([`begin_read`]
//! or [`begin_write`]): a non-persistent query is two Sync-terminated
//! round trips, and only an open transaction keeps pgbouncer on the server
//! connection that holds the unnamed statement. See `platform::db`.
//!
//! Tables and columns are Prisma's: quoted `PascalCase` tables, quoted
//! camelCase columns. Enum columns are read as `::text`.

use chrono::NaiveDateTime;
use serde_json::Value;
use sqlx::postgres::PgRow;
use sqlx::{Acquire, PgConnection, PgPool, Postgres, Row, Transaction};

type Result<T> = std::result::Result<T, sqlx::Error>;

/// A read-only transaction for a request's reads. `SET TRANSACTION` is
/// transaction-scoped, so it cannot leak through pgbouncer.
pub async fn begin_read(pool: &PgPool) -> Result<Transaction<'static, Postgres>> {
    let mut tx = pool.begin().await?;
    sqlx::raw_sql("SET TRANSACTION READ ONLY")
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}

/// A read-write transaction for a request that may write.
pub async fn begin_write(pool: &PgPool) -> Result<Transaction<'static, Postgres>> {
    pool.begin().await
}

fn q(
    sql: &'static str,
) -> sqlx::query::Query<'static, sqlx::Postgres, sqlx::postgres::PgArguments> {
    sqlx::query(sql).persistent(false)
}

// ---------------------------------------------------------------- access

/// Whether the assignment exists and the group has a link row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AssignmentAccessRow {
    pub linked: bool,
}

pub async fn assignment_access(
    conn: &mut PgConnection,
    assignment_id: i32,
    group_id: Option<&str>,
) -> Result<Option<AssignmentAccessRow>> {
    q(r#"SELECT EXISTS (
            SELECT 1 FROM "AssignmentGroup" g
            WHERE g."assignmentId" = a.id AND g."groupId" = $2
         ) AS linked
       FROM "Assignment" a WHERE a.id = $1"#)
    .bind(assignment_id)
    .bind(group_id)
    .fetch_optional(conn)
    .await?
    .map(|r| {
        Ok(AssignmentAccessRow {
            linked: r.try_get("linked")?,
        })
    })
    .transpose()
}

/// Create the missing `AssignmentGroup` link (and its `Group`), tolerating a
/// concurrent request that created either first.
pub async fn heal_group_link(
    conn: &mut PgConnection,
    assignment_id: i32,
    group_id: &str,
) -> Result<()> {
    let mut tx = conn.begin().await?;
    q(r#"INSERT INTO "Group" (id) VALUES ($1) ON CONFLICT DO NOTHING"#)
        .bind(group_id)
        .execute(&mut *tx)
        .await?;
    q(r#"INSERT INTO "AssignmentGroup" ("assignmentId", "groupId") VALUES ($1, $2) ON CONFLICT DO NOTHING"#)
        .bind(assignment_id)
        .bind(group_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

// ---------------------------------------------------------------- attempts

#[derive(Debug, Clone, PartialEq)]
pub struct AttemptRow {
    pub id: i32,
    pub assignment_id: i32,
    pub assignment_version_id: Option<i32>,
    pub user_id: String,
    pub submitted: bool,
    pub grade: Option<f64>,
    pub expires_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub question_order: Vec<i32>,
    pub comments: Option<String>,
    pub preferred_language: Option<String>,
}

fn attempt_row(r: &PgRow) -> Result<AttemptRow> {
    Ok(AttemptRow {
        id: r.try_get("id")?,
        assignment_id: r.try_get("assignmentId")?,
        assignment_version_id: r.try_get("assignmentVersionId")?,
        user_id: r.try_get("userId")?,
        submitted: r.try_get("submitted")?,
        grade: r.try_get("grade")?,
        expires_at: r.try_get("expiresAt")?,
        created_at: r.try_get("createdAt")?,
        question_order: r
            .try_get::<Option<Vec<i32>>, _>("questionOrder")?
            .unwrap_or_default(),
        comments: r.try_get("comments")?,
        preferred_language: r.try_get("preferredLanguage")?,
    })
}

macro_rules! attempt_sql {
    ($rest:literal) => {
        concat!(
            r#"SELECT id, "assignmentId", "assignmentVersionId", "userId", submitted, grade,
    "expiresAt", "createdAt", "questionOrder", comments, "preferredLanguage"
    FROM "AssignmentAttempt" "#,
            $rest
        )
    };
}

/// Who an attempt lookup is scoped to.
#[derive(Debug, Clone, Copy)]
pub enum Owner<'a> {
    /// A learner: the row's `userId` must equal this (never empty).
    User(&'a str),
    /// An author: any learner's row on the assignment.
    Anyone,
}

pub async fn find_attempt(
    conn: &mut PgConnection,
    attempt_id: i32,
    assignment_id: i32,
    owner: Owner<'_>,
) -> Result<Option<AttemptRow>> {
    let row = match owner {
        Owner::User(user) => {
            q(attempt_sql!(
                r#"WHERE id = $1 AND "assignmentId" = $2 AND "userId" = $3"#
            ))
            .bind(attempt_id)
            .bind(assignment_id)
            .bind(user)
            .fetch_optional(conn)
            .await?
        }
        Owner::Anyone => {
            q(attempt_sql!(r#"WHERE id = $1 AND "assignmentId" = $2"#))
                .bind(attempt_id)
                .bind(assignment_id)
                .fetch_optional(conn)
                .await?
        }
    };
    row.as_ref().map(attempt_row).transpose()
}

pub async fn list_attempts(
    conn: &mut PgConnection,
    assignment_id: i32,
    owner: Owner<'_>,
) -> Result<Vec<AttemptRow>> {
    let rows =
        match owner {
            Owner::User(user) => q(attempt_sql!(
                r#"WHERE "assignmentId" = $1 AND "userId" = $2 ORDER BY "createdAt" ASC, id ASC"#
            ))
            .bind(assignment_id)
            .bind(user)
            .fetch_all(conn)
            .await?,
            Owner::Anyone => {
                q(attempt_sql!(
                    r#"WHERE "assignmentId" = $1 ORDER BY "createdAt" ASC, id ASC"#
                ))
                .bind(assignment_id)
                .fetch_all(conn)
                .await?
            }
        };
    rows.iter().map(attempt_row).collect()
}

// ---------------------------------------------------------------- assignment read

/// Columns shared by `Assignment` and `AssignmentVersion` that the learner
/// view merges. Everything nullable so one struct serves both tables.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SettingsRow {
    pub name: Option<String>,
    pub introduction: Option<String>,
    pub instructions: Option<String>,
    pub grading_criteria_overview: Option<String>,
    pub time_estimate_minutes: Option<i32>,
    pub attempts_before_cool_down: Option<i32>,
    pub retake_attempt_cool_down_minutes: Option<i32>,
    pub assignment_type: Option<String>,
    pub graded: Option<bool>,
    pub num_attempts: Option<i32>,
    pub alloted_time_minutes: Option<i32>,
    pub attempts_per_time_range: Option<i32>,
    pub attempts_time_range_hours: Option<i32>,
    pub passing_grade: Option<i32>,
    pub display_order: Option<String>,
    pub question_display: Option<String>,
    pub number_of_questions_per_attempt: Option<i32>,
    pub question_order: Vec<i32>,
    pub published: Option<bool>,
    pub show_assignment_score: Option<bool>,
    pub show_question_score: Option<bool>,
    pub show_submission_feedback: Option<bool>,
    pub show_questions: Option<bool>,
    pub show_pass_fail_indicator: Option<bool>,
    pub correct_answer_visibility: Option<String>,
    pub question_controls: Option<Value>,
    pub require_all_questions: Option<bool>,
    pub optional_question_ids: Option<Vec<i32>>,
    pub language_code: Option<String>,
}

macro_rules! settings_columns {
    () => {
        r#"name, introduction, instructions, "gradingCriteriaOverview", "timeEstimateMinutes",
    "attemptsBeforeCoolDown", "retakeAttemptCoolDownMinutes", type::text AS type, graded,
    "numAttempts", "allotedTimeMinutes", "attemptsPerTimeRange", "attemptsTimeRangeHours",
    "passingGrade", "displayOrder"::text AS "displayOrder", "questionDisplay"::text AS "questionDisplay",
    "numberOfQuestionsPerAttempt", "questionOrder", published, "showAssignmentScore",
    "showQuestionScore", "showSubmissionFeedback", "showQuestions", "showPassFailIndicator",
    "correctAnswerVisibility"::text AS "correctAnswerVisibility", "questionControls",
    "requireAllQuestions", "optionalQuestionIds", "languageCode""#
    };
}

fn settings_row(r: &PgRow) -> Result<SettingsRow> {
    Ok(SettingsRow {
        name: r.try_get("name")?,
        introduction: r.try_get("introduction")?,
        instructions: r.try_get("instructions")?,
        grading_criteria_overview: r.try_get("gradingCriteriaOverview")?,
        time_estimate_minutes: r.try_get("timeEstimateMinutes")?,
        attempts_before_cool_down: r.try_get("attemptsBeforeCoolDown")?,
        retake_attempt_cool_down_minutes: r.try_get("retakeAttemptCoolDownMinutes")?,
        assignment_type: r.try_get("type")?,
        graded: r.try_get("graded")?,
        num_attempts: r.try_get("numAttempts")?,
        alloted_time_minutes: r.try_get("allotedTimeMinutes")?,
        attempts_per_time_range: r.try_get("attemptsPerTimeRange")?,
        attempts_time_range_hours: r.try_get("attemptsTimeRangeHours")?,
        passing_grade: r.try_get("passingGrade")?,
        display_order: r.try_get("displayOrder")?,
        question_display: r.try_get("questionDisplay")?,
        number_of_questions_per_attempt: r.try_get("numberOfQuestionsPerAttempt")?,
        question_order: r
            .try_get::<Option<Vec<i32>>, _>("questionOrder")?
            .unwrap_or_default(),
        published: r.try_get("published")?,
        show_assignment_score: r.try_get("showAssignmentScore")?,
        show_question_score: r.try_get("showQuestionScore")?,
        show_submission_feedback: r.try_get("showSubmissionFeedback")?,
        show_questions: r.try_get("showQuestions")?,
        show_pass_fail_indicator: r.try_get("showPassFailIndicator")?,
        correct_answer_visibility: r.try_get("correctAnswerVisibility")?,
        question_controls: r.try_get("questionControls")?,
        require_all_questions: r.try_get("requireAllQuestions")?,
        optional_question_ids: r.try_get("optionalQuestionIds")?,
        language_code: r.try_get("languageCode")?,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct AssignmentRow {
    pub id: i32,
    pub updated_at: NaiveDateTime,
    pub current_version_id: Option<i32>,
    pub settings: SettingsRow,
}

pub async fn load_assignment(
    conn: &mut PgConnection,
    assignment_id: i32,
) -> Result<Option<AssignmentRow>> {
    let row = q(concat!(
        r#"SELECT id, "updatedAt", "currentVersionId", "#,
        settings_columns!(),
        r#" FROM "Assignment" WHERE id = $1"#
    ))
    .bind(assignment_id)
    .fetch_optional(conn)
    .await?;
    row.map(|r| {
        Ok(AssignmentRow {
            id: r.try_get("id")?,
            updated_at: r.try_get("updatedAt")?,
            current_version_id: r.try_get("currentVersionId")?,
            settings: settings_row(&r)?,
        })
    })
    .transpose()
}

/// The live version: `currentVersion` while it is active, else the newest
/// active version of the assignment.
pub async fn load_active_version(
    conn: &mut PgConnection,
    assignment_id: i32,
    current_version_id: Option<i32>,
) -> Result<Option<SettingsRow>> {
    let row = q(concat!(
        "SELECT ",
        settings_columns!(),
        r#" FROM "AssignmentVersion" v
        WHERE v."isActive" AND (v.id = $2 OR v."assignmentId" = $1)
        ORDER BY COALESCE(v.id = $2, false) DESC, v.id DESC
        LIMIT 1"#
    ))
    .bind(assignment_id)
    .bind(current_version_id)
    .fetch_optional(conn)
    .await?;
    row.as_ref().map(settings_row).transpose()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssignmentTranslationRow {
    pub language_code: String,
    pub translated_name: Option<String>,
    pub translated_introduction: Option<String>,
    pub translated_instructions: Option<String>,
    pub translated_grading_criteria_overview: Option<String>,
}

/// Assignment-level translations whose code starts with `like_pattern`.
pub async fn assignment_translations(
    conn: &mut PgConnection,
    assignment_id: i32,
    like_pattern: &str,
) -> Result<Vec<AssignmentTranslationRow>> {
    q(
        r#"SELECT "languageCode", "translatedName", "translatedIntroduction",
            "translatedInstructions", "translatedGradingCriteriaOverview"
       FROM "AssignmentTranslation"
       WHERE "assignmentId" = $1 AND "languageCode" ILIKE $2
       ORDER BY id"#,
    )
    .bind(assignment_id)
    .bind(like_pattern)
    .fetch_all(conn)
    .await?
    .iter()
    .map(|r| {
        Ok(AssignmentTranslationRow {
            language_code: r.try_get("languageCode")?,
            translated_name: r.try_get("translatedName")?,
            translated_introduction: r.try_get("translatedIntroduction")?,
            translated_instructions: r.try_get("translatedInstructions")?,
            translated_grading_criteria_overview: r.try_get("translatedGradingCriteriaOverview")?,
        })
    })
    .collect()
}

pub async fn language_codes(conn: &mut PgConnection, assignment_id: i32) -> Result<Vec<String>> {
    q(r#"SELECT "languageCode" FROM "AssignmentTranslation" WHERE "assignmentId" = $1 ORDER BY id"#)
        .bind(assignment_id)
        .fetch_all(conn)
        .await?
        .iter()
        .map(|r| r.try_get("languageCode"))
        .collect()
}

// ---------------------------------------------------------------- attempt read

/// Base-row settings the attempt read uses, plus the current version's
/// answer visibility.
#[derive(Debug, Clone, PartialEq)]
#[allow(clippy::struct_excessive_bools)] // mirrors the selected columns
pub struct AttemptSettingsRow {
    pub question_order: Vec<i32>,
    pub passing_grade: Option<i32>,
    pub show_assignment_score: bool,
    pub show_submission_feedback: bool,
    pub show_questions: bool,
    pub show_question_score: bool,
    pub current_version_id: Option<i32>,
    pub current_version_visibility: Option<String>,
}

pub async fn attempt_settings(
    conn: &mut PgConnection,
    assignment_id: i32,
) -> Result<Option<AttemptSettingsRow>> {
    let row = q(
        r#"SELECT a."questionOrder", a."passingGrade", a."showAssignmentScore",
            a."showSubmissionFeedback", a."showQuestions", a."showQuestionScore",
            a."currentVersionId", cv."correctAnswerVisibility"::text AS "currentVisibility"
       FROM "Assignment" a
       LEFT JOIN "AssignmentVersion" cv ON cv.id = a."currentVersionId"
       WHERE a.id = $1"#,
    )
    .bind(assignment_id)
    .fetch_optional(conn)
    .await?;
    row.map(|r| {
        Ok(AttemptSettingsRow {
            question_order: r
                .try_get::<Option<Vec<i32>>, _>("questionOrder")?
                .unwrap_or_default(),
            passing_grade: r.try_get("passingGrade")?,
            show_assignment_score: r.try_get("showAssignmentScore")?,
            show_submission_feedback: r.try_get("showSubmissionFeedback")?,
            show_questions: r.try_get("showQuestions")?,
            show_question_score: r.try_get("showQuestionScore")?,
            current_version_id: r.try_get("currentVersionId")?,
            current_version_visibility: r.try_get("currentVisibility")?,
        })
    })
    .transpose()
}

pub async fn version_alloted_time(
    conn: &mut PgConnection,
    version_id: i32,
) -> Result<Option<(i32, Option<i32>)>> {
    q(r#"SELECT id, "allotedTimeMinutes" FROM "AssignmentVersion" WHERE id = $1"#)
        .bind(version_id)
        .fetch_optional(conn)
        .await?
        .map(|r| Ok((r.try_get("id")?, r.try_get("allotedTimeMinutes")?)))
        .transpose()
}

/// A question as authored, from `QuestionVersion` or `Question`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SourceQuestion {
    /// `questionId`, or the version row id when that is null.
    pub id: i32,
    pub question: String,
    pub question_type: String,
    pub response_type: Option<String>,
    pub total_points: i32,
    pub max_words: Option<i32>,
    pub max_characters: Option<i32>,
    pub scoring: Option<Value>,
    pub choices: Option<Value>,
    pub randomized_choices: Option<bool>,
    pub grading_context_question_ids: Vec<i32>,
    pub is_deleted: bool,
    pub video_presentation_config: Option<Value>,
    pub live_recording_config: Option<Value>,
}

fn source_question(r: &PgRow) -> Result<SourceQuestion> {
    Ok(SourceQuestion {
        id: r.try_get("sourceId")?,
        question: r.try_get("question")?,
        question_type: r.try_get("type")?,
        response_type: r.try_get("responseType")?,
        total_points: r.try_get("totalPoints")?,
        max_words: r.try_get("maxWords")?,
        max_characters: r.try_get("maxCharacters")?,
        scoring: r.try_get("scoring")?,
        choices: r.try_get("choices")?,
        randomized_choices: r.try_get("randomizedChoices")?,
        grading_context_question_ids: r
            .try_get::<Option<Vec<i32>>, _>("gradingContextQuestionIds")?
            .unwrap_or_default(),
        is_deleted: r.try_get("isDeleted")?,
        video_presentation_config: r.try_get("videoPresentationConfig")?,
        live_recording_config: r.try_get("liveRecordingConfig")?,
    })
}

macro_rules! question_columns {
    () => {
        r#"question, type::text AS type, "responseType"::text AS "responseType", "totalPoints",
    "maxWords", "maxCharacters", scoring, choices, "randomizedChoices", "gradingContextQuestionIds",
    "videoPresentationConfig", "liveRecordingConfig""#
    };
}

pub async fn version_questions(
    conn: &mut PgConnection,
    version_id: i32,
) -> Result<Vec<SourceQuestion>> {
    q(concat!(
        r#"SELECT COALESCE("questionId", id) AS "sourceId", false AS "isDeleted", "#,
        question_columns!(),
        r#" FROM "QuestionVersion" WHERE "assignmentVersionId" = $1 ORDER BY id"#
    ))
    .bind(version_id)
    .fetch_all(conn)
    .await?
    .iter()
    .map(source_question)
    .collect()
}

pub async fn live_questions(
    conn: &mut PgConnection,
    assignment_id: i32,
) -> Result<Vec<SourceQuestion>> {
    q(concat!(
        r#"SELECT id AS "sourceId", "isDeleted", "#,
        question_columns!(),
        r#" FROM "Question" WHERE "assignmentId" = $1 AND "isDeleted" = false ORDER BY id"#
    ))
    .bind(assignment_id)
    .fetch_all(conn)
    .await?
    .iter()
    .map(source_question)
    .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct VariantRow {
    pub id: i32,
    pub variant_content: String,
    pub choices: Option<Value>,
    pub max_words: Option<i32>,
    pub max_characters: Option<i32>,
    pub scoring: Option<Value>,
}

/// One `AssignmentAttemptQuestionVariant` row with its chosen variant.
#[derive(Debug, Clone, PartialEq)]
pub struct FrozenSelectionRow {
    pub question_id: i32,
    pub randomized_choices: Option<Value>,
    pub variant: Option<VariantRow>,
}

pub async fn frozen_selections(
    conn: &mut PgConnection,
    attempt_id: i32,
) -> Result<Vec<FrozenSelectionRow>> {
    q(
        r#"SELECT s."questionId", s."randomizedChoices", v.id AS "variantId", v."variantContent",
            v.choices, v."maxWords", v."maxCharacters", v.scoring
       FROM "AssignmentAttemptQuestionVariant" s
       LEFT JOIN "QuestionVariant" v ON v.id = s."questionVariantId"
       WHERE s."assignmentAttemptId" = $1"#,
    )
    .bind(attempt_id)
    .fetch_all(conn)
    .await?
    .iter()
    .map(|r| {
        let variant_id: Option<i32> = r.try_get("variantId")?;
        let variant = match variant_id {
            Some(id) => Some(VariantRow {
                id,
                variant_content: r.try_get("variantContent")?,
                choices: r.try_get("choices")?,
                max_words: r.try_get("maxWords")?,
                max_characters: r.try_get("maxCharacters")?,
                scoring: r.try_get("scoring")?,
            }),
            None => None,
        };
        Ok(FrozenSelectionRow {
            question_id: r.try_get("questionId")?,
            randomized_choices: r.try_get("randomizedChoices")?,
            variant,
        })
    })
    .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct TranslationRow {
    pub question_id: Option<i32>,
    pub variant_id: Option<i32>,
    pub language_code: String,
    pub translated_text: String,
    pub translated_choices: Option<Value>,
}

pub async fn question_translations(
    conn: &mut PgConnection,
    like_pattern: &str,
    question_ids: &[i32],
    variant_ids: &[i32],
) -> Result<Vec<TranslationRow>> {
    q(
        r#"SELECT "questionId", "variantId", "languageCode", "translatedText", "translatedChoices"
       FROM "Translation"
       WHERE "languageCode" ILIKE $1
         AND ("questionId" = ANY($2) OR "variantId" = ANY($3))
       ORDER BY id"#,
    )
    .bind(like_pattern)
    .bind(question_ids)
    .bind(variant_ids)
    .fetch_all(conn)
    .await?
    .iter()
    .map(|r| {
        Ok(TranslationRow {
            question_id: r.try_get("questionId")?,
            variant_id: r.try_get("variantId")?,
            language_code: r.try_get("languageCode")?,
            translated_text: r.try_get("translatedText")?,
            translated_choices: r.try_get("translatedChoices")?,
        })
    })
    .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResponseRow {
    pub id: i32,
    pub assignment_attempt_id: i32,
    pub question_id: i32,
    pub learner_response: String,
    pub points: f64,
    pub feedback: Value,
    pub metadata: Option<Value>,
    pub graded_at: Option<NaiveDateTime>,
}

pub async fn question_responses(
    conn: &mut PgConnection,
    attempt_id: i32,
) -> Result<Vec<ResponseRow>> {
    q(
        r#"SELECT id, "assignmentAttemptId", "questionId", "learnerResponse", points, feedback,
            metadata, "gradedAt"
       FROM "QuestionResponse" WHERE "assignmentAttemptId" = $1 ORDER BY id"#,
    )
    .bind(attempt_id)
    .fetch_all(conn)
    .await?
    .iter()
    .map(|r| {
        Ok(ResponseRow {
            id: r.try_get("id")?,
            assignment_attempt_id: r.try_get("assignmentAttemptId")?,
            question_id: r.try_get("questionId")?,
            learner_response: r.try_get("learnerResponse")?,
            points: r.try_get("points")?,
            feedback: r.try_get("feedback")?,
            metadata: r.try_get("metadata")?,
            graded_at: r.try_get("gradedAt")?,
        })
    })
    .collect()
}

// ---------------------------------------------------------------- attempt create

pub async fn find_resumable(
    conn: &mut PgConnection,
    assignment_id: i32,
    user_id: &str,
    now: NaiveDateTime,
) -> Result<Option<i32>> {
    q(r#"SELECT id FROM "AssignmentAttempt"
       WHERE "assignmentId" = $1 AND "userId" = $2 AND submitted = false
         AND ("expiresAt" IS NULL OR "expiresAt" >= $3)
       ORDER BY "createdAt" DESC LIMIT 1"#)
    .bind(assignment_id)
    .bind(user_id)
    .bind(now)
    .fetch_optional(conn)
    .await?
    .map(|r| r.try_get("id"))
    .transpose()
}

/// `pg_advisory_xact_lock(hashtextextended('<userId>:<assignmentId>', 0))`,
/// shared with the legacy backend. Must run inside a transaction.
pub async fn lock_attempt_creation(conn: &mut PgConnection, key: &str) -> Result<()> {
    q("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(key)
        .execute(conn)
        .await
        .map(|_| ())
}

/// Bounds the advisory-lock wait for this transaction only.
pub async fn set_local_lock_timeout(conn: &mut PgConnection) -> Result<()> {
    q("SET LOCAL lock_timeout = '10s'")
        .execute(conn)
        .await
        .map(|_| ())
}

/// Any question (deleted or not) that needs AI grading.
pub async fn has_ai_graded_question(conn: &mut PgConnection, assignment_id: i32) -> Result<bool> {
    q(r#"SELECT EXISTS (
            SELECT 1 FROM "Question"
            WHERE "assignmentId" = $1 AND type::text IN ('TEXT', 'URL', 'UPLOAD')
         ) AS found"#)
    .bind(assignment_id)
    .fetch_one(conn)
    .await?
    .try_get("found")
}

pub async fn count_attempts_between(
    conn: &mut PgConnection,
    assignment_id: i32,
    user_id: &str,
    from: NaiveDateTime,
    to: NaiveDateTime,
) -> Result<i64> {
    q(r#"SELECT count(*) AS n FROM "AssignmentAttempt"
       WHERE "assignmentId" = $1 AND "userId" = $2 AND "createdAt" >= $3 AND "createdAt" <= $4"#)
    .bind(assignment_id)
    .bind(user_id)
    .bind(from)
    .bind(to)
    .fetch_one(conn)
    .await?
    .try_get("n")
}

pub async fn count_attempts(
    conn: &mut PgConnection,
    assignment_id: i32,
    user_id: &str,
) -> Result<i64> {
    q(r#"SELECT count(*) AS n FROM "AssignmentAttempt" WHERE "assignmentId" = $1 AND "userId" = $2"#)
        .bind(assignment_id)
        .bind(user_id)
        .fetch_one(conn)
        .await?
        .try_get("n")
}

/// `expiresAt ?? createdAt` of the last submitted attempt (Prisma's
/// `expiresAt desc, createdAt desc`, which puts NULLs first).
pub async fn last_submitted_reference(
    conn: &mut PgConnection,
    assignment_id: i32,
    user_id: &str,
) -> Result<Option<NaiveDateTime>> {
    q(
        r#"SELECT COALESCE("expiresAt", "createdAt") AS reference FROM "AssignmentAttempt"
       WHERE "assignmentId" = $1 AND "userId" = $2 AND submitted = true
       ORDER BY "expiresAt" DESC, "createdAt" DESC LIMIT 1"#,
    )
    .bind(assignment_id)
    .bind(user_id)
    .fetch_optional(conn)
    .await?
    .map(|r| r.try_get("reference"))
    .transpose()
}

pub async fn insert_attempt(
    conn: &mut PgConnection,
    assignment_id: i32,
    version_id: Option<i32>,
    user_id: &str,
    expires_at: Option<NaiveDateTime>,
) -> Result<i32> {
    q(r#"INSERT INTO "AssignmentAttempt"
            ("assignmentId", "assignmentVersionId", "userId", submitted, "expiresAt", "questionOrder")
       VALUES ($1, $2, $3, false, $4, '{}')
       RETURNING id"#)
    .bind(assignment_id)
    .bind(version_id)
    .bind(user_id)
    .bind(expires_at)
    .fetch_one(conn)
    .await?
    .try_get("id")
}

/// A question in the creation pool with what variant selection needs.
#[derive(Debug, Clone, PartialEq)]
pub struct PoolQuestionRow {
    /// The id served to the learner: `COALESCE("questionId", id)` for a
    /// version row, the question id for a live row.
    pub id: i32,
    /// The live `Question` this row belongs to, or `None` for a version row
    /// whose `questionId` is null. Only this id may pick up live variants.
    pub live_question_id: Option<i32>,
    pub choices: Option<Value>,
    pub randomized_choices: Option<bool>,
}

fn pool_row(r: &PgRow) -> Result<PoolQuestionRow> {
    Ok(PoolQuestionRow {
        id: r.try_get("poolId")?,
        live_question_id: r.try_get("liveQuestionId")?,
        choices: r.try_get("choices")?,
        randomized_choices: r.try_get("randomizedChoices")?,
    })
}

pub async fn version_pool(
    conn: &mut PgConnection,
    version_id: i32,
) -> Result<Vec<PoolQuestionRow>> {
    q(
        r#"SELECT COALESCE("questionId", id) AS "poolId", "questionId" AS "liveQuestionId", choices, "randomizedChoices"
       FROM "QuestionVersion" WHERE "assignmentVersionId" = $1 ORDER BY id"#,
    )
    .bind(version_id)
    .fetch_all(conn)
    .await?
    .iter()
    .map(pool_row)
    .collect()
}

pub async fn live_pool(
    conn: &mut PgConnection,
    assignment_id: i32,
) -> Result<Vec<PoolQuestionRow>> {
    q(
        r#"SELECT id AS "poolId", id AS "liveQuestionId", choices, "randomizedChoices"
       FROM "Question" WHERE "assignmentId" = $1 AND "isDeleted" = false ORDER BY id"#,
    )
    .bind(assignment_id)
    .fetch_all(conn)
    .await?
    .iter()
    .map(pool_row)
    .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct PoolVariantRow {
    pub id: i32,
    pub question_id: i32,
    pub choices: Option<Value>,
    pub randomized_choices: Option<bool>,
}

/// Non-deleted variants of the assignment's non-deleted live questions.
pub async fn live_variants(
    conn: &mut PgConnection,
    assignment_id: i32,
) -> Result<Vec<PoolVariantRow>> {
    q(
        r#"SELECT v.id, v."questionId", v.choices, v."randomizedChoices"
       FROM "QuestionVariant" v
       JOIN "Question" qn ON qn.id = v."questionId"
       WHERE qn."assignmentId" = $1 AND qn."isDeleted" = false AND v."isDeleted" = false
       ORDER BY v.id"#,
    )
    .bind(assignment_id)
    .fetch_all(conn)
    .await?
    .iter()
    .map(|r| {
        Ok(PoolVariantRow {
            id: r.try_get("id")?,
            question_id: r.try_get("questionId")?,
            choices: r.try_get("choices")?,
            randomized_choices: r.try_get("randomizedChoices")?,
        })
    })
    .collect()
}

pub async fn set_question_order(
    conn: &mut PgConnection,
    attempt_id: i32,
    order: &[i32],
) -> Result<()> {
    q(r#"UPDATE "AssignmentAttempt" SET "questionOrder" = $2 WHERE id = $1"#)
        .bind(attempt_id)
        .bind(order)
        .execute(conn)
        .await
        .map(|_| ())
}

/// A row for `AssignmentAttemptQuestionVariant`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrozenSelectionInsert {
    pub question_id: i32,
    pub variant_id: Option<i32>,
    /// The JSON text of the choice array; stored as a JSON *string* value,
    /// exactly as the legacy backend stores `JSON.stringify(choices)`.
    pub randomized_choices: Option<String>,
}

pub async fn insert_frozen_selections(
    conn: &mut PgConnection,
    attempt_id: i32,
    rows: &[FrozenSelectionInsert],
) -> Result<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let question_ids: Vec<i32> = rows.iter().map(|r| r.question_id).collect();
    let variant_ids: Vec<Option<i32>> = rows.iter().map(|r| r.variant_id).collect();
    // Each element is the JSON encoding of a JSON string, cast to jsonb.
    let stored: Vec<Option<String>> = rows
        .iter()
        .map(|r| {
            r.randomized_choices
                .as_ref()
                .map(|text| Value::String(text.clone()).to_string())
        })
        .collect();
    q(r#"INSERT INTO "AssignmentAttemptQuestionVariant"
            ("assignmentAttemptId", "questionId", "questionVariantId", "randomizedChoices")
       SELECT $1, t.question_id, t.variant_id, t.stored::jsonb
       FROM UNNEST($2::int4[], $3::int4[], $4::text[]) AS t(question_id, variant_id, stored)"#)
    .bind(attempt_id)
    .bind(&question_ids)
    .bind(&variant_ids)
    .bind(&stored)
    .execute(conn)
    .await
    .map(|_| ())
}

// ---------------------------------------------------------------- abandon

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AbandonCheckRow {
    pub submitted: bool,
    pub assignment_version_id: Option<i32>,
    pub responses: i64,
    pub current_version_id: Option<i32>,
}

/// Lock the attempt row for this transaction and read what the abandon
/// rules need. Concurrent response inserts wait on the row lock.
pub async fn lock_attempt_for_abandon(
    conn: &mut PgConnection,
    attempt_id: i32,
) -> Result<Option<AbandonCheckRow>> {
    let row = q(r#"SELECT t.submitted, t."assignmentVersionId",
            (SELECT count(*) FROM "QuestionResponse" r WHERE r."assignmentAttemptId" = t.id) AS responses,
            (SELECT a."currentVersionId" FROM "Assignment" a WHERE a.id = t."assignmentId") AS "currentVersionId"
       FROM "AssignmentAttempt" t WHERE t.id = $1
       FOR UPDATE OF t"#)
    .bind(attempt_id)
    .fetch_optional(conn)
    .await?;
    row.map(|r| {
        Ok(AbandonCheckRow {
            submitted: r.try_get("submitted")?,
            assignment_version_id: r.try_get("assignmentVersionId")?,
            responses: r.try_get("responses")?,
            current_version_id: r.try_get("currentVersionId")?,
        })
    })
    .transpose()
}

pub async fn delete_attempt(conn: &mut PgConnection, attempt_id: i32) -> Result<()> {
    q(r#"DELETE FROM "AssignmentAttemptQuestionVariant" WHERE "assignmentAttemptId" = $1"#)
        .bind(attempt_id)
        .execute(&mut *conn)
        .await?;
    q(r#"DELETE FROM "AssignmentAttempt" WHERE id = $1"#)
        .bind(attempt_id)
        .execute(conn)
        .await
        .map(|_| ())
}

// ---------------------------------------------------------------- submit and results

/// The base `Assignment` row's settings a submit and its results read, with
/// the current version's answer visibility.
#[derive(Debug, Clone, PartialEq)]
#[allow(clippy::struct_excessive_bools)] // mirrors the selected columns
pub struct SubmitSettingsRow {
    pub question_order: Vec<i32>,
    pub passing_grade: Option<i32>,
    pub show_assignment_score: bool,
    pub show_submission_feedback: bool,
    pub show_questions: bool,
    pub show_question_score: bool,
    pub show_pass_fail_indicator: bool,
    pub require_all_questions: bool,
    pub optional_question_ids: Vec<i32>,
    pub current_version_visibility: Option<String>,
}

pub async fn submit_settings(
    conn: &mut PgConnection,
    assignment_id: i32,
) -> Result<Option<SubmitSettingsRow>> {
    let row = q(
        r#"SELECT a."questionOrder", a."passingGrade", a."showAssignmentScore",
            a."showSubmissionFeedback", a."showQuestions", a."showQuestionScore",
            a."showPassFailIndicator", a."requireAllQuestions", a."optionalQuestionIds",
            cv."correctAnswerVisibility"::text AS "currentVisibility"
       FROM "Assignment" a
       LEFT JOIN "AssignmentVersion" cv ON cv.id = a."currentVersionId"
       WHERE a.id = $1"#,
    )
    .bind(assignment_id)
    .fetch_optional(conn)
    .await?;
    row.map(|r| {
        Ok(SubmitSettingsRow {
            question_order: r
                .try_get::<Option<Vec<i32>>, _>("questionOrder")?
                .unwrap_or_default(),
            passing_grade: r.try_get("passingGrade")?,
            show_assignment_score: r.try_get("showAssignmentScore")?,
            show_submission_feedback: r.try_get("showSubmissionFeedback")?,
            show_questions: r.try_get("showQuestions")?,
            show_question_score: r.try_get("showQuestionScore")?,
            show_pass_fail_indicator: r.try_get("showPassFailIndicator")?,
            require_all_questions: r.try_get("requireAllQuestions")?,
            optional_question_ids: r
                .try_get::<Option<Vec<i32>>, _>("optionalQuestionIds")?
                .unwrap_or_default(),
            current_version_visibility: r.try_get("currentVisibility")?,
        })
    })
    .transpose()
}

/// A question row as grading and the results page read it, from
/// `QuestionVersion` (pinned attempts) or `Question`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct GradingQuestionRow {
    /// The row's own id (`QuestionVersion.id` or `Question.id`).
    pub row_id: i32,
    /// The question the row belongs to; `None` for a version row created
    /// without one.
    pub question_id: Option<i32>,
    /// `Question.assignmentId`; `None` for version rows.
    pub assignment_id: Option<i32>,
    pub question: String,
    pub question_type: String,
    pub response_type: Option<String>,
    pub total_points: i32,
    pub choices: Option<Value>,
    pub scoring: Option<Value>,
    pub grading_context_question_ids: Vec<i32>,
}

impl GradingQuestionRow {
    /// The id the attempt serves it under.
    pub fn served_id(&self) -> i32 {
        self.question_id.unwrap_or(self.row_id)
    }
}

fn grading_question_row(r: &PgRow) -> Result<GradingQuestionRow> {
    Ok(GradingQuestionRow {
        row_id: r.try_get("id")?,
        question_id: r.try_get("questionId")?,
        assignment_id: r.try_get("assignmentId")?,
        question: r.try_get("question")?,
        question_type: r.try_get("type")?,
        response_type: r.try_get("responseType")?,
        total_points: r.try_get("totalPoints")?,
        choices: r.try_get("choices")?,
        scoring: r.try_get("scoring")?,
        grading_context_question_ids: r
            .try_get::<Option<Vec<i32>>, _>("gradingContextQuestionIds")?
            .unwrap_or_default(),
    })
}

/// The attempt's pinned version questions, in display order.
pub async fn pinned_questions(
    conn: &mut PgConnection,
    version_id: i32,
) -> Result<Vec<GradingQuestionRow>> {
    q(
        r#"SELECT id, "questionId", NULL::int4 AS "assignmentId", question, type::text AS type,
            "responseType"::text AS "responseType", "totalPoints", choices, scoring,
            "gradingContextQuestionIds"
       FROM "QuestionVersion" WHERE "assignmentVersionId" = $1
       ORDER BY "displayOrder" ASC NULLS LAST, id ASC"#,
    )
    .bind(version_id)
    .fetch_all(conn)
    .await?
    .iter()
    .map(grading_question_row)
    .collect()
}

/// The assignment's live, non-deleted questions.
pub async fn live_grading_questions(
    conn: &mut PgConnection,
    assignment_id: i32,
) -> Result<Vec<GradingQuestionRow>> {
    q(
        r#"SELECT id, id AS "questionId", "assignmentId", question, type::text AS type,
            "responseType"::text AS "responseType", "totalPoints", choices, scoring,
            "gradingContextQuestionIds"
       FROM "Question" WHERE "assignmentId" = $1 AND "isDeleted" = false ORDER BY id"#,
    )
    .bind(assignment_id)
    .fetch_all(conn)
    .await?
    .iter()
    .map(grading_question_row)
    .collect()
}

/// Live questions by id, deleted or not, on any assignment.
pub async fn questions_by_ids(
    conn: &mut PgConnection,
    ids: &[i32],
) -> Result<Vec<GradingQuestionRow>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    q(
        r#"SELECT id, id AS "questionId", "assignmentId", question, type::text AS type,
            "responseType"::text AS "responseType", "totalPoints", choices, scoring,
            "gradingContextQuestionIds"
       FROM "Question" WHERE id = ANY($1) ORDER BY id"#,
    )
    .bind(ids)
    .fetch_all(conn)
    .await?
    .iter()
    .map(grading_question_row)
    .collect()
}

/// A stored question translation with the choices it was made from.
#[derive(Debug, Clone, PartialEq)]
pub struct QuestionTranslationRow {
    pub question_id: Option<i32>,
    pub variant_id: Option<i32>,
    pub language_code: String,
    pub translated_text: String,
    pub translated_choices: Option<Value>,
    pub untranslated_choices: Option<Value>,
}

/// Translations of the given questions (their variant rows included), in
/// insertion order; `like_pattern` limits the language codes when given.
pub async fn translations_of_questions(
    conn: &mut PgConnection,
    question_ids: &[i32],
    like_pattern: Option<&str>,
) -> Result<Vec<QuestionTranslationRow>> {
    if question_ids.is_empty() {
        return Ok(Vec::new());
    }
    q(
        r#"SELECT "questionId", "variantId", "languageCode", "translatedText",
            "translatedChoices", "untranslatedChoices"
       FROM "Translation"
       WHERE "questionId" = ANY($1) AND ($2::text IS NULL OR "languageCode" ILIKE $2)
       ORDER BY id"#,
    )
    .bind(question_ids)
    .bind(like_pattern)
    .fetch_all(conn)
    .await?
    .iter()
    .map(|r| {
        Ok(QuestionTranslationRow {
            question_id: r.try_get("questionId")?,
            variant_id: r.try_get("variantId")?,
            language_code: r.try_get("languageCode")?,
            translated_text: r.try_get("translatedText")?,
            translated_choices: r.try_get("translatedChoices")?,
            untranslated_choices: r.try_get("untranslatedChoices")?,
        })
    })
    .collect()
}

/// Close an open attempt at zero because its submit came in past the
/// deadline. Returns how many rows changed (0: it was already submitted).
pub async fn close_expired_attempt(
    conn: &mut PgConnection,
    attempt_id: i32,
    comment: &str,
) -> Result<u64> {
    q(
        r#"UPDATE "AssignmentAttempt" SET submitted = true, grade = 0, comments = $2
       WHERE id = $1 AND submitted = false"#,
    )
    .bind(attempt_id)
    .bind(comment)
    .execute(conn)
    .await
    .map(|r| r.rows_affected())
}

pub async fn attempt_submitted(conn: &mut PgConnection, attempt_id: i32) -> Result<Option<bool>> {
    q(r#"SELECT submitted FROM "AssignmentAttempt" WHERE id = $1"#)
        .bind(attempt_id)
        .fetch_optional(conn)
        .await?
        .map(|r| r.try_get("submitted"))
        .transpose()
}

/// One `QuestionResponse` row to write at commit.
#[derive(Debug, Clone, PartialEq)]
pub struct ResponseInsert {
    pub question_id: i32,
    /// JSON text of the graded value (a text column).
    pub learner_response: String,
    pub points: f64,
    /// JSON text of the feedback array.
    pub feedback: String,
    /// JSON text of the jsonb value, which is itself a JSON string holding
    /// the metadata object, as the legacy backend stores it.
    pub metadata: Option<String>,
}

/// Insert the rows in order; returns their ids in the same order.
pub async fn insert_question_responses(
    conn: &mut PgConnection,
    attempt_id: i32,
    rows: &[ResponseInsert],
    graded_at: NaiveDateTime,
) -> Result<Vec<i32>> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let question_ids: Vec<i32> = rows.iter().map(|r| r.question_id).collect();
    let learner: Vec<&str> = rows.iter().map(|r| r.learner_response.as_str()).collect();
    let points: Vec<f64> = rows.iter().map(|r| r.points).collect();
    let feedback: Vec<&str> = rows.iter().map(|r| r.feedback.as_str()).collect();
    let metadata: Vec<Option<&str>> = rows.iter().map(|r| r.metadata.as_deref()).collect();
    let mut ids: Vec<i32> = q(r#"INSERT INTO "QuestionResponse"
            ("assignmentAttemptId", "questionId", "learnerResponse", points, feedback, metadata, "gradedAt")
       SELECT $1, t.question_id, t.learner_response, t.points, t.feedback::jsonb, t.metadata::jsonb, $7
       FROM UNNEST($2::int4[], $3::text[], $4::float8[], $5::text[], $6::text[])
            WITH ORDINALITY AS t(question_id, learner_response, points, feedback, metadata, ord)
       ORDER BY t.ord
       RETURNING id"#)
    .bind(attempt_id)
    .bind(&question_ids)
    .bind(&learner)
    .bind(&points)
    .bind(&feedback)
    .bind(&metadata)
    .bind(graded_at)
    .fetch_all(conn)
    .await?
    .iter()
    .map(|r| r.try_get("id"))
    .collect::<Result<_>>()?;
    // Ids come from the sequence in insertion order.
    ids.sort_unstable();
    Ok(ids)
}

/// Delete the attempt's responses other than `keep`.
pub async fn prune_question_responses(
    conn: &mut PgConnection,
    attempt_id: i32,
    keep: &[i32],
) -> Result<u64> {
    q(r#"DELETE FROM "QuestionResponse" WHERE "assignmentAttemptId" = $1 AND NOT (id = ANY($2))"#)
        .bind(attempt_id)
        .bind(keep)
        .execute(conn)
        .await
        .map(|r| r.rows_affected())
}

/// Mark the attempt submitted with its grade, if it is still open.
pub async fn commit_attempt(
    conn: &mut PgConnection,
    attempt_id: i32,
    grade: f64,
    preferred_language: &str,
    now: NaiveDateTime,
) -> Result<u64> {
    q(r#"UPDATE "AssignmentAttempt"
       SET submitted = true, "preferredLanguage" = $2, "expiresAt" = $3, grade = $4
       WHERE id = $1 AND submitted = false"#)
    .bind(attempt_id)
    .bind(preferred_language)
    .bind(now)
    .bind(grade)
    .execute(conn)
    .await
    .map(|r| r.rows_affected())
}

/// `GradingProgress` as `markComplete` leaves it once a grade is readable.
/// Only an existing row is updated; none is created. Returns the rows
/// changed.
pub async fn complete_grading_progress(
    conn: &mut PgConnection,
    attempt_id: i32,
    now: NaiveDateTime,
) -> Result<u64> {
    q(r#"UPDATE "GradingProgress"
       SET status = 'COMPLETED', progress = 100, "currentStage" = 'Grading complete!',
           "completedAt" = $2, "updatedAt" = $2
       WHERE "attemptId" = $1"#)
    .bind(attempt_id)
    .bind(now)
    .execute(conn)
    .await
    .map(|r| r.rows_affected())
}

/// Ask for an email when grading completes.
pub async fn enable_grading_notification(
    conn: &mut PgConnection,
    attempt_id: i32,
    email: &str,
    now: NaiveDateTime,
) -> Result<()> {
    q(r#"INSERT INTO "GradingProgress"
            ("attemptId", "totalQuestions", "notifyOnComplete", "notificationEmail", "createdAt", "updatedAt")
       VALUES ($1, 0, true, $2, $3, $3)
       ON CONFLICT ("attemptId") DO UPDATE SET
            "notifyOnComplete" = true, "notificationEmail" = $2, "updatedAt" = $3"#)
    .bind(attempt_id)
    .bind(email)
    .bind(now)
    .execute(conn)
    .await
    .map(|_| ())
}

/// Every grade of the learner on the assignment.
pub async fn attempt_grades(
    conn: &mut PgConnection,
    assignment_id: i32,
    user_id: &str,
) -> Result<Vec<Option<f64>>> {
    q(r#"SELECT grade FROM "AssignmentAttempt" WHERE "assignmentId" = $1 AND "userId" = $2"#)
        .bind(assignment_id)
        .bind(user_id)
        .fetch_all(conn)
        .await?
        .iter()
        .map(|r| r.try_get("grade"))
        .collect()
}

/// A new `LtiGradeSync`, inserted already claimed.
#[derive(Debug, Clone)]
pub struct LtiSyncInsert<'a> {
    pub attempt_id: i32,
    pub user_id: &'a str,
    pub assignment_id: i32,
    pub grade: f64,
    pub auth_cookie: &'a str,
    pub gateway_url: Option<&'a str>,
    pub now: NaiveDateTime,
}

pub async fn insert_lti_sync(conn: &mut PgConnection, row: &LtiSyncInsert<'_>) -> Result<i32> {
    q(r#"INSERT INTO "LtiGradeSync"
            ("attemptId", "userId", "assignmentId", grade, status, "authCookie", "ltiGatewayUrl",
             "lastAttemptAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'IN_PROGRESS', $5, $6, $7, $7, $7)
       RETURNING id"#)
    .bind(row.attempt_id)
    .bind(row.user_id)
    .bind(row.assignment_id)
    .bind(row.grade)
    .bind(row.auth_cookie)
    .bind(row.gateway_url.unwrap_or(""))
    .bind(row.now)
    .fetch_one(conn)
    .await?
    .try_get("id")
}

pub async fn mark_lti_sync_success(
    conn: &mut PgConnection,
    sync_id: i32,
    now: NaiveDateTime,
) -> Result<()> {
    q(r#"UPDATE "LtiGradeSync" SET status = 'SUCCESS', "completedAt" = $2, "updatedAt" = $2 WHERE id = $1"#)
        .bind(sync_id)
        .bind(now)
        .execute(conn)
        .await
        .map(|_| ())
}

pub async fn schedule_lti_sync_retry(
    conn: &mut PgConnection,
    sync_id: i32,
    retry_count: i32,
    last_error: &str,
    error_history: &Value,
    next_retry_at: NaiveDateTime,
    now: NaiveDateTime,
) -> Result<()> {
    q(r#"UPDATE "LtiGradeSync"
       SET status = 'SCHEDULED', "retryCount" = $2, "lastError" = $3, "errorHistory" = $4,
           "nextRetryAt" = $5, "updatedAt" = $6
       WHERE id = $1"#)
    .bind(sync_id)
    .bind(retry_count)
    .bind(last_error)
    .bind(error_history)
    .bind(next_retry_at)
    .bind(now)
    .execute(conn)
    .await
    .map(|_| ())
}

/// One `LtiSyncErrorLog` row.
#[derive(Debug, Clone)]
pub struct LtiErrorLogInsert<'a> {
    pub sync_id: i32,
    pub attempt_number: i32,
    pub error_message: &'a str,
    pub http_status: Option<i32>,
    pub response_body: Option<&'a str>,
    pub metadata: Value,
    pub now: NaiveDateTime,
}

pub async fn insert_lti_error_log(
    conn: &mut PgConnection,
    row: &LtiErrorLogInsert<'_>,
) -> Result<i32> {
    q(r#"INSERT INTO "LtiSyncErrorLog"
            ("syncId", "attemptNumber", "errorMessage", "httpStatus", "responseBody", metadata, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id"#)
    .bind(row.sync_id)
    .bind(row.attempt_number)
    .bind(row.error_message)
    .bind(row.http_status)
    .bind(row.response_body)
    .bind(&row.metadata)
    .bind(row.now)
    .fetch_one(conn)
    .await?
    .try_get("id")
}

pub async fn insert_grade_sync_notification(
    conn: &mut PgConnection,
    user_id: &str,
    title: &str,
    message: &str,
    metadata: &str,
    now: NaiveDateTime,
) -> Result<()> {
    q(r#"INSERT INTO "UserNotification" ("userId", type, title, message, metadata, "createdAt", "updatedAt")
       VALUES ($1, 'GRADE_SYNC', $2, $3, $4, $5, $5)"#)
    .bind(user_id)
    .bind(title)
    .bind(message)
    .bind(metadata)
    .bind(now)
    .execute(conn)
    .await
    .map(|_| ())
}

pub async fn mark_lti_learner_notified(
    conn: &mut PgConnection,
    sync_id: i32,
    now: NaiveDateTime,
) -> Result<()> {
    q(r#"UPDATE "LtiGradeSync" SET "learnerNotified" = true, "notificationSentAt" = $2, "updatedAt" = $2
       WHERE id = $1"#)
    .bind(sync_id)
    .bind(now)
    .execute(conn)
    .await
    .map(|_| ())
}

/// The newest grade sync of an attempt (the session cookie is not read).
#[derive(Debug, Clone, PartialEq)]
pub struct LtiSyncRow {
    pub id: i32,
    pub status: String,
    pub grade: f64,
    pub retry_count: i32,
    pub max_retries: i32,
    pub last_error: Option<String>,
    pub next_retry_at: Option<NaiveDateTime>,
    pub completed_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
}

pub async fn latest_lti_sync(
    conn: &mut PgConnection,
    attempt_id: i32,
) -> Result<Option<LtiSyncRow>> {
    q(
        r#"SELECT id, status::text AS status, grade, "retryCount", "maxRetries", "lastError",
            "nextRetryAt", "completedAt", "createdAt"
       FROM "LtiGradeSync" WHERE "attemptId" = $1
       ORDER BY "createdAt" DESC, id DESC LIMIT 1"#,
    )
    .bind(attempt_id)
    .fetch_optional(conn)
    .await?
    .map(|r| {
        Ok(LtiSyncRow {
            id: r.try_get("id")?,
            status: r.try_get("status")?,
            grade: r.try_get("grade")?,
            retry_count: r.try_get("retryCount")?,
            max_retries: r.try_get("maxRetries")?,
            last_error: r.try_get("lastError")?,
            next_retry_at: r.try_get("nextRetryAt")?,
            completed_at: r.try_get("completedAt")?,
            created_at: r.try_get("createdAt")?,
        })
    })
    .transpose()
}

#[derive(Debug, Clone, PartialEq)]
pub struct LtiErrorLogRow {
    pub id: i32,
    pub sync_id: i32,
    pub attempt_number: i32,
    pub error_message: String,
    pub error_stack: Option<String>,
    pub http_status: Option<i32>,
    pub response_body: Option<String>,
    pub timestamp: NaiveDateTime,
    pub metadata: Option<Value>,
}

/// The five newest error logs of a sync.
pub async fn lti_error_logs(conn: &mut PgConnection, sync_id: i32) -> Result<Vec<LtiErrorLogRow>> {
    q(
        r#"SELECT id, "syncId", "attemptNumber", "errorMessage", "errorStack", "httpStatus",
            "responseBody", timestamp, metadata
       FROM "LtiSyncErrorLog" WHERE "syncId" = $1
       ORDER BY timestamp DESC, id DESC LIMIT 5"#,
    )
    .bind(sync_id)
    .fetch_all(conn)
    .await?
    .iter()
    .map(|r| {
        Ok(LtiErrorLogRow {
            id: r.try_get("id")?,
            sync_id: r.try_get("syncId")?,
            attempt_number: r.try_get("attemptNumber")?,
            error_message: r.try_get("errorMessage")?,
            error_stack: r.try_get("errorStack")?,
            http_status: r.try_get("httpStatus")?,
            response_body: r.try_get("responseBody")?,
            timestamp: r.try_get("timestamp")?,
            metadata: r.try_get("metadata")?,
        })
    })
    .collect()
}
