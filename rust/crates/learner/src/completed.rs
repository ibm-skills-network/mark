//! `GET /assignments/{assignmentId}/attempts/{attemptId}/completed`: a
//! submitted attempt for the results page (`getLearnerAssignmentAttempt` and
//! `AttemptQuestionsMapper.buildCompletedQuestions`). Every visibility rule is
//! applied here, key by key.

use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use serde_json::Value;
use tracing::{info, warn};

use crate::access::{self, Intent};
use crate::answer_key;
use crate::error::ApiError;
use crate::js;
use crate::params::{iso, iso_opt, like_prefix, now_millis, whole_f64};
use crate::principal::{Role, UserSession};
use crate::question_source::{self, is_media_response_type};
use crate::store::{
    self, FrozenSelectionRow, GradingQuestionRow, QuestionTranslationRow, ResponseRow,
};
use crate::submit::result_settings;
use crate::submit_result::{answers_revealed, passed_indicator, DEFAULT_PASSING_GRADE};
use crate::LearnerState;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CompletedChoice {
    pub id: Option<Value>,
    pub choice: String,
    #[serde(rename = "isCorrect", skip_serializing_if = "Option::is_none")]
    pub is_correct: Option<bool>,
    /// Outer `None`: omitted. `Some(None)`: `null`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[allow(clippy::option_option)]
    pub feedback: Option<Option<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedResponse {
    pub learner_response: Value,
    #[serde(serialize_with = "whole_f64")]
    pub points: Option<f64>,
    pub feedback: Option<Vec<Value>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedQuestion {
    pub id: i32,
    pub question: Option<String>,
    #[serde(rename = "type")]
    pub question_type: String,
    pub response_type: Option<String>,
    pub total_points: i32,
    pub choices: Option<Vec<CompletedChoice>>,
    pub scoring: Option<Value>,
    pub response: Option<CompletedResponse>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)] // wire shape fixed by the contract
pub struct CompletedAttempt {
    pub id: i32,
    pub assignment_id: i32,
    pub submitted: bool,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub preferred_language: Option<String>,
    pub comments: Option<String>,
    pub server_now: String,
    #[serde(serialize_with = "whole_f64")]
    pub grade: Option<f64>,
    #[serde(serialize_with = "whole_f64")]
    pub total_points_earned: Option<f64>,
    #[serde(serialize_with = "whole_f64")]
    pub total_possible_points: Option<f64>,
    pub passed: Option<bool>,
    pub passing_grade: i32,
    pub show_assignment_score: bool,
    pub show_submission_feedback: bool,
    pub show_questions: bool,
    pub show_question_score: bool,
    pub show_pass_fail_indicator: bool,
    pub correct_answer_visibility: String,
    pub questions: Vec<CompletedQuestion>,
}

/// The attempt's question source as the legacy access cache builds it:
/// pinned version rows (by row id), else the live non-deleted rows.
#[derive(Debug, Clone, PartialEq)]
pub struct SourceQuestion {
    pub id: i32,
    pub question: String,
    pub question_type: String,
    pub response_type: Option<String>,
    pub total_points: i32,
    /// `parseJsonValue(choices, [])`.
    pub choices: Value,
    /// `parseJsonValue(scoring, null)`.
    pub scoring: Value,
}

/// `parseJsonValue(value, fallback)`.
fn parse_json_value(value: Option<&Value>, fallback: Value) -> Value {
    match value {
        None | Some(Value::Null) => fallback,
        Some(Value::String(s)) => serde_json::from_str(s).unwrap_or(fallback),
        Some(other) => other.clone(),
    }
}

impl From<&GradingQuestionRow> for SourceQuestion {
    fn from(row: &GradingQuestionRow) -> Self {
        Self {
            id: row.served_id(),
            question: row.question.clone(),
            question_type: row.question_type.clone(),
            response_type: row.response_type.clone().filter(|t| !t.is_empty()),
            total_points: row.total_points,
            choices: parse_json_value(row.choices.as_ref(), Value::Array(Vec::new())),
            scoring: parse_json_value(row.scoring.as_ref(), Value::Null),
        }
    }
}

/// The mapper's `parseChoices`: falsy -> [], text -> parsed, array -> items,
/// object -> its values.
fn parse_choices(value: Option<&Value>) -> Vec<Value> {
    let Some(value) = value.filter(|v| js::truthy(v)) else {
        return Vec::new();
    };
    let parsed = match value {
        Value::String(s) => match serde_json::from_str::<Value>(s) {
            Ok(v) => v,
            Err(_) => return Vec::new(),
        },
        other => other.clone(),
    };
    match parsed {
        Value::Array(items) => items,
        Value::Object(map) => map.into_iter().map(|(_, v)| v).collect(),
        _ => Vec::new(),
    }
}

/// `sanitizeLearnerChoices`.
pub fn sanitize_choices(choices: &[Value], reveal: bool) -> Vec<CompletedChoice> {
    choices
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|entry| {
            let choice = match entry.get("choice")? {
                Value::String(s) => s.clone(),
                v @ Value::Number(_) => js::to_string(Some(v)),
                _ => return None,
            };
            let id = Some(match entry.get("id") {
                Some(Value::Number(n)) => js::normalize(Value::Number(n.clone())),
                _ => Value::Null,
            });
            let (is_correct, feedback) = if reveal {
                (
                    entry.get("isCorrect").and_then(Value::as_bool),
                    Some(
                        entry
                            .get("feedback")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                    ),
                )
            } else {
                (None, None)
            };
            Some(CompletedChoice {
                id,
                choice,
                is_correct,
                feedback,
            })
        })
        .collect()
}

/// A stored JSON value, parsed when held as text; unparsable text is null.
fn parse_stored_json(value: Option<&Value>) -> Option<Value> {
    match value? {
        Value::String(s) => serde_json::from_str(s).ok(),
        other => Some(other.clone()),
    }
}

fn feedback_list(feedback: &Value) -> Option<Vec<Value>> {
    match parse_stored_json(Some(feedback))? {
        Value::Array(items) => Some(items),
        v @ Value::Object(_) => Some(vec![v]),
        _ => None,
    }
}

fn visible_scoring(scoring: Option<&Value>) -> Option<Value> {
    let parsed = parse_stored_json(scoring)?;
    let record = parsed.as_object()?;
    (record.get("showRubricsToLearner") == Some(&Value::Bool(true)))
        .then(|| js::normalize(parsed.clone()))
}

fn parse_learner_response(stored: &str) -> Value {
    serde_json::from_str::<Value>(stored)
        .map_or_else(|_| Value::String(stored.to_owned()), js::normalize)
}

/// `metadata.maxPossiblePoints` of a stored response, when usable.
fn response_max_points(metadata: Option<&Value>) -> Option<f64> {
    parse_stored_json(metadata)?
        .get("maxPossiblePoints")?
        .as_f64()
        .filter(|f| f.is_finite() && *f >= 0.0)
}

/// What the totals came to.
#[derive(Debug, Clone, PartialEq)]
pub struct Totals {
    pub earned: f64,
    pub possible: f64,
    /// The stored grade, or the served-set ratio when clamping lowered it.
    pub effective_grade: Option<f64>,
}

/// The served set, newest response per served question, and the clamped
/// totals over it with media response types left out. `deleted` holds rows
/// for served questions missing from the source (any assignment).
pub fn totals(
    served: &[i32],
    source: &[SourceQuestion],
    newest: &[(i32, &ResponseRow)],
    deleted: &[GradingQuestionRow],
    stored_grade: Option<f64>,
) -> Result<Totals, i32> {
    let max_of = |id: i32| {
        source
            .iter()
            .rev()
            .find(|q| q.id == id)
            .map(|q| q.total_points)
    };
    let response_of = |id: i32| newest.iter().find(|(q, _)| *q == id).map(|(_, r)| *r);
    let mut media: Vec<i32> = source
        .iter()
        .filter(|q| served.contains(&q.id) && is_media_response_type(q.response_type.as_deref()))
        .map(|q| q.id)
        .collect();
    for row in deleted {
        if is_media_response_type(row.response_type.as_deref()) {
            media.push(row.row_id);
        }
    }
    let counted: Vec<&ResponseRow> = newest
        .iter()
        .filter(|(q, _)| !media.contains(q))
        .map(|(_, r)| *r)
        .collect();
    let raw: f64 = counted.iter().map(|r| r.points).sum();
    let earned: f64 = counted
        .iter()
        .map(|r| match max_of(r.question_id) {
            Some(max) => r.points.min(f64::from(max)),
            None => r.points,
        })
        .sum();
    let mut possible = 0.0;
    let mut seen: Vec<i32> = Vec::new();
    for id in served {
        if seen.contains(id) {
            continue;
        }
        seen.push(*id);
        if media.contains(id) {
            continue;
        }
        if let Some(max) = max_of(*id) {
            possible += f64::from(max);
            continue;
        }
        if let Some(max) = response_of(*id).and_then(|r| response_max_points(r.metadata.as_ref())) {
            possible += max;
            continue;
        }
        match deleted.iter().find(|r| r.row_id == *id) {
            Some(row) => possible += f64::from(row.total_points),
            None => return Err(*id),
        }
    }
    let effective_grade = if earned < raw && possible > 0.0 && stored_grade.is_some() {
        Some(earned / possible)
    } else {
        stored_grade
    };
    Ok(Totals {
        earned,
        possible,
        effective_grade,
    })
}

/// A served question with the text and choices the learner saw.
struct Served<'a> {
    source: &'a SourceQuestion,
    variant_id: Option<i32>,
    question: String,
    choices: Vec<Value>,
    scoring: Option<Value>,
}

fn served_question<'a>(
    source: &'a SourceQuestion,
    selection: Option<&FrozenSelectionRow>,
) -> Served<'a> {
    let variant = selection.and_then(|s| s.variant.as_ref());
    // A non-text frozen value goes through JSON text and back.
    let frozen = parse_choices(selection.and_then(|s| s.randomized_choices.as_ref()));
    let choices = if frozen.is_empty() {
        let own = variant
            .and_then(|v| v.choices.as_ref())
            .filter(|c| !c.is_null())
            .unwrap_or(&source.choices);
        parse_choices(Some(own))
    } else {
        frozen
    };
    let scoring = variant
        .and_then(|v| v.scoring.as_ref())
        .filter(|s| !s.is_null())
        .cloned()
        .or_else(|| Some(source.scoring.clone()).filter(|s| !s.is_null()));
    Served {
        source,
        variant_id: variant.map(|v| v.id),
        question: variant.map_or_else(|| source.question.clone(), |v| v.variant_content.clone()),
        choices,
        scoring,
    }
}

fn is_authored_language(language: &str) -> bool {
    language.trim().to_lowercase().split('-').next() == Some("en")
}

/// Options for shaping each question.
#[derive(Debug, Clone, Copy)]
pub struct Shape<'a> {
    pub reveal: bool,
    pub show_question_score: bool,
    pub show_submission_feedback: bool,
    pub language: Option<&'a str>,
}

fn completed_question(
    served: &Served<'_>,
    response: Option<&ResponseRow>,
    shape: Shape<'_>,
) -> CompletedQuestion {
    let choices = sanitize_choices(&served.choices, shape.reveal);
    let max_points = served.source.total_points;
    let response = response.map(|r| {
        let feedback = if shape.show_submission_feedback {
            feedback_list(&r.feedback)
                .map(|list| {
                    let metadata = parse_stored_json(r.metadata.as_ref()).filter(Value::is_object);
                    let field = |k: &str| metadata.as_ref().and_then(|m| m.get(k));
                    match served.source.question_type.as_str() {
                        "TRUE_FALSE" => answer_key::apply_true_false(
                            &list,
                            shape.reveal,
                            field("isCorrect").and_then(Value::as_bool),
                            field("correctAnswer").and_then(Value::as_bool),
                            shape.language,
                        ),
                        "MULTIPLE_CORRECT" => {
                            let correct: Vec<String> = served
                                .choices
                                .iter()
                                .filter(|c| c.get("isCorrect") == Some(&Value::Bool(true)))
                                .map(|c| js::to_string(c.get("choice")))
                                .collect();
                            answer_key::apply_correct_options(
                                &list,
                                shape.reveal,
                                field("perfectScore").and_then(Value::as_bool),
                                &correct,
                                shape.language,
                            )
                        }
                        _ => list,
                    }
                })
                .map(|list| list.into_iter().map(js::normalize).collect())
        } else {
            None
        };
        CompletedResponse {
            learner_response: parse_learner_response(&r.learner_response),
            points: shape
                .show_question_score
                .then(|| r.points.min(f64::from(max_points))),
            feedback,
        }
    });
    CompletedQuestion {
        id: served.source.id,
        question: Some(served.question.clone()),
        question_type: served.source.question_type.clone(),
        response_type: served.source.response_type.clone(),
        total_points: max_points,
        choices: (!choices.is_empty()).then_some(choices),
        scoring: visible_scoring(served.scoring.as_ref()),
        response,
    }
}

/// `buildCompletedQuestions`.
pub fn build_questions(
    question_order: &[i32],
    source: &[SourceQuestion],
    selections: &[FrozenSelectionRow],
    translations: &[QuestionTranslationRow],
    newest: &[(i32, &ResponseRow)],
    shape: Shape<'_>,
) -> Vec<CompletedQuestion> {
    let mut served: Vec<Served<'_>> = question_order
        .iter()
        .filter_map(|id| {
            let source = source.iter().rev().find(|q| q.id == *id)?;
            let selection = selections.iter().find(|s| s.question_id == *id);
            Some(served_question(source, selection))
        })
        .collect();
    if let Some(language) = shape
        .language
        .filter(|l| !l.is_empty() && !is_authored_language(l))
    {
        for question in &mut served {
            if let Some(row) = question_source::find_translation(
                translations,
                question.source.id,
                question.variant_id,
                language,
            ) {
                question.question.clone_from(&row.translated_text);
                if let Some(choices) = row.translated_choices.as_ref().filter(|c| !c.is_null()) {
                    question.choices = parse_choices(Some(choices));
                }
            }
        }
    }
    served
        .iter()
        .map(|q| {
            let response = newest
                .iter()
                .find(|(id, _)| *id == q.source.id)
                .map(|(_, r)| *r);
            completed_question(q, response, shape)
        })
        .collect()
}

fn raw_pair(path: Result<Path<(String, String)>, PathRejection>) -> (String, String) {
    path.map(|Path(p)| p).unwrap_or_default()
}

fn not_found() -> ApiError {
    ApiError::nest(
        StatusCode::NOT_FOUND,
        "Attempt not found or not owned by the user",
    )
}

#[allow(clippy::too_many_lines)] // the legacy read's steps, in order
pub async fn get_completed(
    State(state): State<LearnerState>,
    session: UserSession,
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<Json<CompletedAttempt>, ApiError> {
    let role = session.require_role(&[Role::Learner, Role::Author])?;
    let (raw_assignment, raw_attempt) = raw_pair(path);
    let assignment_id = access::attempt_route_assignment_id(&raw_assignment, &session)?;
    let attempt_id = access::attempt_route_attempt_id(&raw_attempt, &session)?;
    info!(
        assignment_id,
        attempt_id,
        user_id = session.log_user(),
        role = role.as_str(),
        "completed attempt requested"
    );

    let mut tx = store::begin_read(&state.pool).await?;
    let attempt = access::attempt_item(
        &mut tx,
        &session,
        role,
        assignment_id,
        attempt_id,
        Intent::Read,
    )
    .await?;
    if !attempt.submitted {
        warn!(
            assignment_id,
            attempt_id,
            user_id = session.log_user(),
            denial_reason = "not_submitted",
            "completed attempt refused"
        );
        return Err(not_found());
    }
    let Some(settings) = store::submit_settings(&mut tx, assignment_id).await? else {
        return Err(ApiError::nest(
            StatusCode::NOT_FOUND,
            format!("Assignment with Id {assignment_id} not found."),
        ));
    };
    let rows = match attempt.assignment_version_id {
        Some(version_id) => {
            let mut rows = store::pinned_questions(&mut tx, version_id).await?;
            rows.sort_by_key(|r| r.row_id);
            rows
        }
        None => store::live_grading_questions(&mut tx, assignment_id).await?,
    };
    let source: Vec<SourceQuestion> = rows.iter().map(SourceQuestion::from).collect();
    let responses = store::question_responses(&mut tx, attempt.id).await?;
    let selections = store::frozen_selections(&mut tx, attempt.id).await?;

    let served: Vec<i32> = if !attempt.question_order.is_empty() {
        attempt.question_order.clone()
    } else if !settings.question_order.is_empty() {
        settings.question_order.clone()
    } else {
        source.iter().map(|q| q.id).collect()
    };
    let mut newest: Vec<(i32, &ResponseRow)> = Vec::new();
    for response in &responses {
        if !served.contains(&response.question_id) {
            continue;
        }
        match newest.iter_mut().find(|(q, _)| *q == response.question_id) {
            Some(slot) if response.id > slot.1.id => slot.1 = response,
            Some(_) => {}
            None => newest.push((response.question_id, response)),
        }
    }
    let missing: Vec<i32> = served
        .iter()
        .copied()
        .filter(|id| {
            !source.iter().any(|q| q.id == *id)
                && newest
                    .iter()
                    .find(|(q, _)| q == id)
                    .and_then(|(_, r)| response_max_points(r.metadata.as_ref()))
                    .is_none()
        })
        .collect();
    let deleted = store::questions_by_ids(&mut tx, &missing).await?;
    let language = attempt.preferred_language.clone();
    let translations = match language.as_deref() {
        Some(l) if settings.show_questions && !l.is_empty() && !is_authored_language(l) => {
            let family = l.trim().to_lowercase();
            let family = family.split('-').next().unwrap_or("").to_owned();
            let ids: Vec<i32> = source.iter().map(|q| q.id).collect();
            store::translations_of_questions(&mut tx, &ids, Some(&like_prefix(&family))).await?
        }
        _ => Vec::new(),
    };
    tx.commit().await?;

    let totals = totals(&served, &source, &newest, &deleted, attempt.grade).map_err(|id| {
        ApiError::internal(&format!(
            "served question {id} of attempt {attempt_id} is absent from the snapshot and the database"
        ))
    })?;
    let result = result_settings(&settings);
    let passing_grade = settings.passing_grade.unwrap_or(DEFAULT_PASSING_GRADE);
    let reveal = answers_revealed(
        &result.correct_answer_visibility,
        totals.effective_grade,
        Some(passing_grade),
    );
    let questions = if settings.show_questions {
        build_questions(
            &served,
            &source,
            &selections,
            &translations,
            &newest,
            Shape {
                reveal,
                show_question_score: settings.show_question_score,
                show_submission_feedback: settings.show_submission_feedback,
                language: language.as_deref(),
            },
        )
    } else {
        Vec::new()
    };
    let show_score = settings.show_assignment_score;
    let view = CompletedAttempt {
        id: attempt.id,
        assignment_id: attempt.assignment_id,
        submitted: true,
        created_at: iso(attempt.created_at),
        expires_at: iso_opt(attempt.expires_at),
        preferred_language: attempt.preferred_language.clone(),
        comments: attempt.comments.clone(),
        server_now: iso(now_millis()),
        grade: totals.effective_grade.filter(|_| show_score),
        total_points_earned: show_score.then_some(totals.earned),
        total_possible_points: show_score.then_some(totals.possible),
        passed: passed_indicator(
            settings.show_pass_fail_indicator,
            totals.effective_grade,
            Some(passing_grade),
        ),
        passing_grade,
        show_assignment_score: show_score,
        show_submission_feedback: settings.show_submission_feedback,
        show_questions: settings.show_questions,
        show_question_score: settings.show_question_score,
        show_pass_fail_indicator: settings.show_pass_fail_indicator,
        correct_answer_visibility: result.correct_answer_visibility,
        questions,
    };
    info!(
        assignment_id,
        attempt_id,
        questions = view.questions.len(),
        reveal,
        outcome = "ok",
        "completed attempt served"
    );
    Ok(Json(view))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::store::VariantRow;
    use serde_json::json;

    fn source(id: i32, kind: &str, points: i32, choices: Value) -> SourceQuestion {
        SourceQuestion {
            id,
            question: format!("Q{id}"),
            question_type: kind.into(),
            response_type: None,
            total_points: points,
            choices,
            scoring: Value::Null,
        }
    }

    fn response(
        id: i32,
        question_id: i32,
        points: f64,
        learner: &str,
        feedback: Value,
        metadata: Option<Value>,
    ) -> ResponseRow {
        ResponseRow {
            id,
            assignment_attempt_id: 1,
            question_id,
            learner_response: learner.into(),
            points,
            feedback,
            metadata,
            graded_at: None,
        }
    }

    fn shape(reveal: bool) -> Shape<'static> {
        Shape {
            reveal,
            show_question_score: true,
            show_submission_feedback: true,
            language: Some("en"),
        }
    }

    fn colors() -> Value {
        json!([
            {"id": 1, "choice": "Red", "isCorrect": true, "points": 1, "feedback": "yes"},
            {"id": 2, "choice": "Blue", "isCorrect": false, "points": 0},
            {"id": 3, "choice": "Green", "isCorrect": true, "points": 1}
        ])
    }

    #[test]
    fn totals_clamp_and_cover_the_served_set() {
        let src = vec![
            source(1, "MULTIPLE_CORRECT", 1, json!([])),
            source(2, "TEXT", 4, json!([])),
            SourceQuestion {
                response_type: Some("VIDEO".into()),
                ..source(3, "TEXT", 10, json!([]))
            },
        ];
        // Question 1 was stored above its maximum; 2 unanswered; 3 is media.
        let r1 = response(10, 1, 2.0, "[]", json!([]), None);
        let r3 = response(11, 3, 10.0, "\"\"", json!([]), None);
        let newest = vec![(1, &r1), (3, &r3)];
        let t = totals(&[1, 2, 3], &src, &newest, &[], Some(0.9)).unwrap();
        assert!((t.earned - 1.0).abs() < f64::EPSILON);
        assert!((t.possible - 5.0).abs() < f64::EPSILON);
        assert_eq!(t.effective_grade, Some(0.2));
        // No clamping: the stored grade stands.
        let r1 = response(10, 1, 1.0, "[]", json!([]), None);
        let newest = vec![(1, &r1)];
        assert_eq!(
            totals(&[1, 2], &src, &newest, &[], Some(0.9))
                .unwrap()
                .effective_grade,
            Some(0.9)
        );
        // A served question missing everywhere cannot be totalled.
        assert_eq!(totals(&[1, 9], &src, &newest, &[], Some(0.9)), Err(9));
        // ... unless its response recorded a maximum.
        let r9 = response(
            12,
            9,
            1.0,
            "[]",
            json!([]),
            Some(json!("{\"maxPossiblePoints\":3}")),
        );
        let newest = vec![(1, &r1), (9, &r9)];
        assert!(
            (totals(&[1, 9], &src, &newest, &[], Some(0.5))
                .unwrap()
                .possible
                - 4.0)
                .abs()
                < f64::EPSILON
        );
    }

    #[test]
    fn choices_reveal_and_frozen_order() {
        let src = vec![source(1, "SINGLE_CORRECT", 1, colors())];
        let selections = vec![FrozenSelectionRow {
            question_id: 1,
            randomized_choices: Some(Value::String(
                json!([{"id": 3, "choice": "Green", "isCorrect": true}, {"id": 1.5, "choice": 7}])
                    .to_string(),
            )),
            variant: None,
        }];
        let r = response(
            10,
            1,
            1.0,
            "[\"Green\"]",
            json!([{"choice": "Green", "feedback": "ok"}]),
            Some(json!("{}")),
        );
        let newest = vec![(1, &r)];
        let hidden = build_questions(&[1], &src, &selections, &[], &newest, shape(false));
        assert_eq!(
            serde_json::to_value(&hidden[0]).unwrap(),
            json!({
                "id": 1, "question": "Q1", "type": "SINGLE_CORRECT", "responseType": null, "totalPoints": 1,
                "choices": [{"id": 3, "choice": "Green"}, {"id": 1.5, "choice": "7"}],
                "scoring": null,
                "response": {"learnerResponse": ["Green"], "points": 1, "feedback": [{"choice": "Green", "feedback": "ok"}]}
            })
        );
        let shown = build_questions(&[1], &src, &selections, &[], &newest, shape(true));
        assert_eq!(
            serde_json::to_value(&shown[0].choices).unwrap(),
            json!([{"id": 3, "choice": "Green", "isCorrect": true, "feedback": null}, {"id": 1.5, "choice": "7", "feedback": null}])
        );
    }

    #[test]
    fn response_visibility() {
        let src = vec![source(1, "MULTIPLE_CORRECT", 1, colors())];
        let r = response(
            10,
            1,
            0.5,
            "not json",
            json!([{"choice": "Red", "feedback": "x.\nThe correct option(s) were: **Red, Green**."}]),
            Some(json!("{\"perfectScore\":false}")),
        );
        let newest = vec![(1, &r)];
        let hidden = build_questions(&[1], &src, &[], &[], &newest, shape(false));
        let resp = hidden[0].response.as_ref().unwrap();
        assert_eq!(resp.learner_response, json!("not json"));
        assert_eq!(resp.feedback.as_ref().unwrap()[0]["feedback"], "x.");
        let shown = build_questions(&[1], &src, &[], &[], &newest, shape(true));
        assert_eq!(
            shown[0]
                .response
                .as_ref()
                .unwrap()
                .feedback
                .as_ref()
                .unwrap()[0]["feedback"],
            "x.\nThe correct option(s) were: **Red, Green**."
        );
        let mut s = shape(true);
        s.show_question_score = false;
        s.show_submission_feedback = false;
        let q = build_questions(&[1], &src, &[], &[], &newest, s);
        let resp = q[0].response.as_ref().unwrap();
        assert_eq!((resp.points, resp.feedback.as_ref()), (None, None));
        let text = serde_json::to_string(&q[0]).unwrap();
        assert!(text.contains(r#""points":null,"feedback":null"#), "{text}");
    }

    #[test]
    fn variants_translations_and_scoring() {
        let mut src = vec![source(
            1,
            "TRUE_FALSE",
            2,
            json!([{"choice": "True", "isCorrect": true}]),
        )];
        src[0].scoring = json!({"type": "x", "showRubricsToLearner": true, "rubrics": []});
        let selections = vec![FrozenSelectionRow {
            question_id: 1,
            randomized_choices: None,
            variant: Some(VariantRow {
                id: 9,
                variant_content: "V".into(),
                choices: None,
                max_words: None,
                max_characters: None,
                scoring: Some(json!({"showRubricsToLearner": false})),
            }),
        }];
        let translations = vec![QuestionTranslationRow {
            question_id: Some(1),
            variant_id: Some(9),
            language_code: "fr".into(),
            translated_text: "V-fr".into(),
            translated_choices: Some(json!([{"choice": "Vrai", "isCorrect": true}])),
            untranslated_choices: None,
        }];
        let r = response(
            10,
            1,
            0.0,
            "false",
            json!([{"feedback": "Faux.", "choice": false}]),
            Some(json!("{\"isCorrect\":false,\"correctAnswer\":true}")),
        );
        let newest = vec![(1, &r)];
        let mut s = shape(true);
        s.language = Some("fr");
        let q = build_questions(&[1], &src, &selections, &translations, &newest, s);
        assert_eq!(q[0].question.as_deref(), Some("V-fr"));
        assert_eq!(q[0].choices.as_ref().unwrap()[0].choice, "Vrai");
        assert_eq!(q[0].scoring, None);
        assert_eq!(
            q[0].response.as_ref().unwrap().feedback.as_ref().unwrap()[0]["feedback"],
            "Faux. La bonne réponse est Vrai."
        );
        assert_eq!(
            q[0].response.as_ref().unwrap().learner_response,
            json!(false)
        );
        // Without the variant, the question's own scoring with rubrics shows.
        let q = build_questions(&[1], &src, &[], &[], &newest, shape(false));
        assert_eq!(q[0].scoring.as_ref().unwrap()["showRubricsToLearner"], true);
        assert!(q[0].choices.is_some());
    }
}
