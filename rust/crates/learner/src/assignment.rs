//! `GET /assignments/{id}` (learner view) and `GET /assignments/{id}/languages`.

use axum::extract::rejection::PathRejection;
use axum::extract::{Path, RawQuery, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use serde_json::Value;
use tracing::info;

use crate::access::{self, Heal};
use crate::error::ApiError;
use crate::params::{iso, like_prefix, parse_int_pipe, Lang};
use crate::principal::{Role, UserSession};
use crate::store::{self, AssignmentRow, AssignmentTranslationRow, SettingsRow};
use crate::translation;
use crate::LearnerState;

/// The learner view of an assignment, in contract field order.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)] // wire shape fixed by the contract
pub struct LearnerAssignment {
    pub id: i32,
    pub name: String,
    pub introduction: Option<String>,
    pub instructions: Option<String>,
    pub grading_criteria_overview: Option<String>,
    pub time_estimate_minutes: Option<i32>,
    pub attempts_before_cool_down: i32,
    pub retake_attempt_cool_down_minutes: i32,
    #[serde(rename = "type")]
    pub assignment_type: String,
    pub graded: bool,
    pub num_attempts: i32,
    pub alloted_time_minutes: Option<i32>,
    pub require_all_questions: bool,
    pub optional_question_ids: Vec<i32>,
    pub attempts_per_time_range: Option<i32>,
    pub attempts_time_range_hours: Option<i32>,
    pub passing_grade: i32,
    pub display_order: Option<String>,
    pub question_display: String,
    pub number_of_questions_per_attempt: Option<i32>,
    pub question_order: Vec<i32>,
    pub published: bool,
    pub show_assignment_score: bool,
    pub show_question_score: bool,
    pub show_submission_feedback: bool,
    pub show_questions: bool,
    pub show_pass_fail_indicator: bool,
    pub correct_answer_visibility: String,
    pub question_controls: Option<Value>,
    pub updated_at: String,
    pub language_code: Option<String>,
    pub current_version_id: Option<i32>,
    pub success: bool,
}

/// Defaults applied after version and base row (legacy `DEFAULTS`).
pub mod defaults {
    pub const ATTEMPTS_BEFORE_COOL_DOWN: i32 = 1;
    /// No cooldown, matching what create enforces for a null value.
    pub const RETAKE_COOL_DOWN_MINUTES: i32 = 0;
    pub const PASSING_GRADE: i32 = 50;
    pub const QUESTION_DISPLAY: &str = "ONE_PER_PAGE";
    pub const NUM_ATTEMPTS: i32 = -1;
}

/// `questionControls` is a JSON object; tolerate one stored as JSON text.
fn question_controls(value: Option<Value>) -> Option<Value> {
    match value? {
        Value::String(s) => serde_json::from_str::<Value>(&s)
            .ok()
            .filter(Value::is_object),
        v @ Value::Object(_) => Some(v),
        _ => None,
    }
}

/// Version -> base -> defaults for everything except the limit fields,
/// `published` and `showAssignmentScore`, which come from the base row (then
/// defaults). `questionOrder` is the
/// version's when non-empty.
pub fn merge_learner_view(
    base: &AssignmentRow,
    version: Option<&SettingsRow>,
) -> LearnerAssignment {
    let empty = SettingsRow::default();
    let v = version.unwrap_or(&empty);
    let b = &base.settings;
    macro_rules! prefer {
        ($field:ident) => {
            v.$field.clone().or_else(|| b.$field.clone())
        };
    }
    LearnerAssignment {
        id: base.id,
        name: prefer!(name).unwrap_or_default(),
        introduction: prefer!(introduction),
        instructions: prefer!(instructions),
        grading_criteria_overview: prefer!(grading_criteria_overview),
        time_estimate_minutes: prefer!(time_estimate_minutes),
        attempts_before_cool_down: b
            .attempts_before_cool_down
            .unwrap_or(defaults::ATTEMPTS_BEFORE_COOL_DOWN),
        retake_attempt_cool_down_minutes: b
            .retake_attempt_cool_down_minutes
            .unwrap_or(defaults::RETAKE_COOL_DOWN_MINUTES),
        assignment_type: prefer!(assignment_type).unwrap_or_else(|| "AI_GRADED".to_owned()),
        graded: prefer!(graded).unwrap_or(false),
        num_attempts: b.num_attempts.unwrap_or(defaults::NUM_ATTEMPTS),
        alloted_time_minutes: b.alloted_time_minutes,
        require_all_questions: prefer!(require_all_questions).unwrap_or(false),
        optional_question_ids: prefer!(optional_question_ids).unwrap_or_default(),
        attempts_per_time_range: b.attempts_per_time_range,
        attempts_time_range_hours: b.attempts_time_range_hours,
        passing_grade: prefer!(passing_grade).unwrap_or(defaults::PASSING_GRADE),
        display_order: prefer!(display_order),
        question_display: prefer!(question_display)
            .unwrap_or_else(|| defaults::QUESTION_DISPLAY.to_owned()),
        number_of_questions_per_attempt: b.number_of_questions_per_attempt,
        question_order: if v.question_order.is_empty() {
            b.question_order.clone()
        } else {
            v.question_order.clone()
        },
        published: b.published.unwrap_or(false),
        show_assignment_score: b.show_assignment_score.unwrap_or(true),
        show_question_score: prefer!(show_question_score).unwrap_or(true),
        show_submission_feedback: prefer!(show_submission_feedback).unwrap_or(true),
        show_questions: prefer!(show_questions).unwrap_or(true),
        show_pass_fail_indicator: prefer!(show_pass_fail_indicator).unwrap_or(false),
        correct_answer_visibility: prefer!(correct_answer_visibility)
            .unwrap_or_else(|| "ALWAYS".to_owned()),
        question_controls: question_controls(prefer!(question_controls)),
        updated_at: iso(base.updated_at),
        language_code: prefer!(language_code),
        current_version_id: base.current_version_id,
        success: true,
    }
}

/// Overlay the best family match's non-empty translated text.
pub fn apply_assignment_translation(
    view: &mut LearnerAssignment,
    rows: &[AssignmentTranslationRow],
    lang: &Lang,
) {
    if lang.is_authored() {
        return;
    }
    let family: Vec<&AssignmentTranslationRow> = rows
        .iter()
        .filter(|r| translation::family_of(&r.language_code) == lang.family)
        .collect();
    let codes: Vec<&str> = family.iter().map(|r| r.language_code.as_str()).collect();
    let Some(row) = translation::pick(&codes, &lang.code).map(|i| family[i]) else {
        return;
    };
    let non_empty = |s: &Option<String>| s.clone().filter(|s| !s.is_empty());
    if let Some(name) = non_empty(&row.translated_name) {
        view.name = name;
    }
    if let Some(text) = non_empty(&row.translated_introduction) {
        view.introduction = Some(text);
    }
    if let Some(text) = non_empty(&row.translated_instructions) {
        view.instructions = Some(text);
    }
    if let Some(text) = non_empty(&row.translated_grading_criteria_overview) {
        view.grading_criteria_overview = Some(text);
    }
}

fn int_pipe_path(path: Result<Path<String>, PathRejection>) -> Result<Option<i32>, ApiError> {
    match path {
        Ok(Path(raw)) => parse_int_pipe(&raw),
        Err(_) => parse_int_pipe(""),
    }
}

pub async fn get_assignment(
    State(state): State<LearnerState>,
    session: UserSession,
    path: Result<Path<String>, PathRejection>,
    RawQuery(query): RawQuery,
) -> Result<Json<LearnerAssignment>, ApiError> {
    let role = session.require_role(&[Role::Learner, Role::Author])?;
    let assignment_id = int_pipe_path(path)?;
    let lang = Lang::from_query(query.as_deref());
    info!(assignment_id, user_id = session.log_user(), role = role.as_str(), lang = %lang.code, "get assignment requested");

    let id = access::assignment_route_id(&session, role, assignment_id)?;
    let heal = if state.accept_operations {
        Heal::Allowed
    } else {
        Heal::Never
    };
    // The access check may self-heal (a write), so it gets its own
    // transaction, read-write only when healing is allowed, and commits
    // before the reads so the heal survives whatever the reads answer.
    let mut access_tx = match heal {
        Heal::Allowed => store::begin_write(&state.pool).await?,
        Heal::Never => store::begin_read(&state.pool).await?,
    };
    let id = access::assignment_read(&mut access_tx, &session, id, heal).await?;
    access_tx.commit().await?;
    if role == Role::Author {
        info!(
            assignment_id = id,
            outcome = "author_not_served",
            "get assignment answered 501"
        );
        return Err(ApiError::plain(
            StatusCode::NOT_IMPLEMENTED,
            "Author reads are served by the legacy API",
        ));
    }

    let mut tx = store::begin_read(&state.pool).await?;
    let Some(base) = store::load_assignment(&mut tx, id).await? else {
        return Err(ApiError::nest(
            StatusCode::NOT_FOUND,
            "Assignment not found",
        ));
    };
    let version = store::load_active_version(&mut tx, id, base.current_version_id).await?;
    let mut view = merge_learner_view(&base, version.as_ref());
    if !lang.is_authored() {
        let rows = store::assignment_translations(&mut tx, id, &like_prefix(&lang.family)).await?;
        apply_assignment_translation(&mut view, &rows, &lang);
    }
    tx.commit().await?;
    info!(
        assignment_id = id,
        versioned = version.is_some(),
        outcome = "ok",
        "get assignment served"
    );
    Ok(Json(view))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Languages {
    pub languages: Vec<String>,
}

pub fn with_english(mut codes: Vec<String>) -> Languages {
    if !codes.iter().any(|c| c == "en") {
        codes.push("en".to_owned());
    }
    Languages { languages: codes }
}

pub async fn get_languages(
    State(state): State<LearnerState>,
    session: UserSession,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<Languages>, ApiError> {
    let role = session.require_role(&[Role::Learner, Role::Author])?;
    let assignment_id = int_pipe_path(path)?;
    info!(
        assignment_id,
        user_id = session.log_user(),
        role = role.as_str(),
        "get languages requested"
    );
    let id = access::assignment_route_id(&session, role, assignment_id)?;
    let mut tx = store::begin_read(&state.pool).await?;
    let id = access::assignment_read(&mut tx, &session, id, Heal::Never).await?;
    let languages = with_english(store::language_codes(&mut tx, id).await?);
    tx.commit().await?;
    info!(
        assignment_id = id,
        count = languages.languages.len(),
        outcome = "ok",
        "get languages served"
    );
    Ok(Json(languages))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base() -> AssignmentRow {
        AssignmentRow {
            id: 9,
            updated_at: chrono::NaiveDate::from_ymd_opt(2026, 10, 1)
                .unwrap()
                .and_hms_milli_opt(1, 2, 3, 4)
                .unwrap(),
            current_version_id: Some(3),
            settings: SettingsRow {
                name: Some("Base".into()),
                introduction: Some("base intro".into()),
                instructions: None,
                assignment_type: Some("MANUAL".into()),
                num_attempts: Some(3),
                attempts_before_cool_down: None,
                retake_attempt_cool_down_minutes: Some(10),
                alloted_time_minutes: Some(30),
                attempts_per_time_range: Some(2),
                attempts_time_range_hours: Some(24),
                number_of_questions_per_attempt: Some(4),
                passing_grade: Some(70),
                published: Some(true),
                show_assignment_score: Some(true),
                correct_answer_visibility: Some("ALWAYS".into()),
                question_order: vec![1, 2, 3],
                question_controls: Some(json!("{\"disableCopy\":true}")),
                optional_question_ids: Some(vec![2]),
                ..SettingsRow::default()
            },
        }
    }

    #[test]
    fn version_wins_except_limits() {
        let version = SettingsRow {
            name: Some("Version".into()),
            introduction: None,
            instructions: Some("v instr".into()),
            num_attempts: Some(99),
            alloted_time_minutes: Some(5),
            attempts_per_time_range: Some(50),
            number_of_questions_per_attempt: Some(1),
            retake_attempt_cool_down_minutes: Some(0),
            passing_grade: Some(0),
            published: Some(false),
            show_assignment_score: Some(false),
            question_order: vec![],
            ..SettingsRow::default()
        };
        let view = merge_learner_view(&base(), Some(&version));
        assert_eq!(view.name, "Version");
        assert_eq!(view.introduction.as_deref(), Some("base intro"));
        assert_eq!(view.instructions.as_deref(), Some("v instr"));
        // false/0 from the version win over the base row.
        assert_eq!(view.passing_grade, 0);
        // published, showAssignmentScore and limits come from the base row.
        assert!(view.published);
        assert!(view.show_assignment_score);
        assert_eq!(view.num_attempts, 3);
        assert_eq!(view.alloted_time_minutes, Some(30));
        assert_eq!(view.attempts_per_time_range, Some(2));
        assert_eq!(view.attempts_time_range_hours, Some(24));
        assert_eq!(view.number_of_questions_per_attempt, Some(4));
        assert_eq!(view.retake_attempt_cool_down_minutes, 10);
        assert_eq!(
            view.attempts_before_cool_down,
            defaults::ATTEMPTS_BEFORE_COOL_DOWN
        );
        // Empty version order falls back to the base order.
        assert_eq!(view.question_order, vec![1, 2, 3]);
        assert_eq!(view.question_controls, Some(json!({"disableCopy": true})));
        assert_eq!(view.updated_at, "2026-10-01T01:02:03.004Z");
        assert_eq!(view.assignment_type, "MANUAL");
    }

    #[test]
    fn defaults_fill_gaps_without_a_version() {
        let mut row = base();
        row.settings.passing_grade = None;
        row.settings.num_attempts = None;
        row.settings.question_display = None;
        row.settings.show_questions = None;
        row.settings.retake_attempt_cool_down_minutes = None;
        row.settings.published = None;
        row.settings.show_assignment_score = None;
        let version = SettingsRow {
            retake_attempt_cool_down_minutes: Some(7),
            published: Some(true),
            show_assignment_score: Some(false),
            ..SettingsRow::default()
        };
        let view = merge_learner_view(&row, Some(&version));
        assert_eq!(view.retake_attempt_cool_down_minutes, 0);
        assert!(!view.published);
        assert!(view.show_assignment_score);
        let view = merge_learner_view(&row, None);
        assert_eq!(view.retake_attempt_cool_down_minutes, 0);
        assert_eq!(view.passing_grade, 50);
        assert_eq!(view.num_attempts, -1);
        assert_eq!(view.question_display, "ONE_PER_PAGE");
        assert!(view.show_questions);
        assert!(!view.show_pass_fail_indicator);
        assert!(view.success);
        let wire = serde_json::to_value(&view).unwrap();
        let keys: Vec<&String> = wire.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 33);
        assert!(wire.get("currentVersion").is_none());
        assert!(wire.get("versions").is_none());
        assert!(wire.get("questions").is_none());
    }

    fn tr(code: &str, name: &str) -> AssignmentTranslationRow {
        AssignmentTranslationRow {
            language_code: code.into(),
            translated_name: Some(name.into()),
            translated_introduction: Some(String::new()),
            translated_instructions: None,
            translated_grading_criteria_overview: Some(format!("{name} criteria")),
        }
    }

    #[test]
    fn translation_overlay_uses_family_precedence() {
        let rows = vec![tr("zh-TW", "tw"), tr("zh", "zh"), tr("zha", "other")];
        let mut view = merge_learner_view(&base(), None);
        apply_assignment_translation(&mut view, &rows, &Lang::from_query(Some("lang=zh-CN")));
        assert_eq!(view.name, "zh");
        // Empty translated text keeps the authored text.
        assert_eq!(view.introduction.as_deref(), Some("base intro"));
        assert_eq!(
            view.grading_criteria_overview.as_deref(),
            Some("zh criteria")
        );

        let mut view = merge_learner_view(&base(), None);
        apply_assignment_translation(
            &mut view,
            &[tr("zh-TW", "tw")],
            &Lang::from_query(Some("lang=zh-CN")),
        );
        assert_eq!(view.name, "tw");

        let mut view = merge_learner_view(&base(), None);
        apply_assignment_translation(
            &mut view,
            &[tr("en", "paraphrase")],
            &Lang::from_query(Some("lang=en")),
        );
        assert_eq!(view.name, "Base");
    }

    #[test]
    fn languages_append_english_once() {
        assert_eq!(with_english(vec!["fr".into()]).languages, vec!["fr", "en"]);
        assert_eq!(
            with_english(vec!["en".into(), "fr".into()]).languages,
            vec!["en", "fr"]
        );
        assert_eq!(with_english(vec![]).languages, vec!["en"]);
    }
}
