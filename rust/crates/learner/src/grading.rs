//! Deterministic grading: `SINGLE_CORRECT` and `MULTIPLE_CORRECT`
//! (`choice-grading.strategy.ts`), `TRUE_FALSE` (`true-false-grading.strategy.ts`)
//! and the empty answer (`question-response.service.ts`). Every stored value
//! (`learnerResponse`, `feedback`, `metadata`) has the key order and number
//! formatting the legacy grader produced.

use std::sync::LazyLock;

use regex::{Captures, Regex};
use serde_json::{json, Map, Value};

use crate::choice_match::{self, ChoiceRendering, Resolution};
use crate::js;
use crate::localization::localized;
use crate::submit_request::{is_empty_response, SubmittedResponse};

/// The question as graded: the attempt's pinned version row, with the drawn
/// variant's content, choices and scoring, and the submit language's
/// translation applied.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct GradingQuestion {
    pub id: i32,
    pub question_type: String,
    pub total_points: i32,
    /// Absent (`undefined`) when the source row had none.
    pub choices: Option<Value>,
    pub scoring: Option<Value>,
    pub grading_context_question_ids: Vec<i32>,
}

/// One graded answer, as it is stored and reported.
#[derive(Debug, Clone, PartialEq)]
pub struct Graded {
    pub question_id: i32,
    /// The value stored (JSON-encoded) as `learnerResponse`.
    pub learner_response: Value,
    /// `None` when the grader produced no number (an authored choice without
    /// points); the stored value is then 0 and the grade cannot be computed.
    pub points: Option<f64>,
    pub feedback: Vec<Value>,
    pub metadata: Option<Value>,
}

/// A refusal the legacy grader raised as a 400
/// (`Failed to process question response: ...`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GradingError(pub String);

impl GradingError {
    pub fn message(&self) -> String {
        format!("Failed to process question response: {}", self.0)
    }
}

/// What grading needs besides the question and the answer.
#[derive(Debug, Clone, Copy, Default)]
pub struct Context<'a> {
    /// The submit's `language`, as sent.
    pub language: Option<&'a str>,
    /// Every stored rendering of this question's choices.
    pub renderings: &'a [ChoiceRendering],
}

/// The refusal for stored choices a grader cannot read. Never carries the
/// stored text, which holds the answer key.
pub const UNREADABLE_CHOICES: &str = "The question's choices could not be read.";

fn unreadable_choices() -> GradingError {
    GradingError(UNREADABLE_CHOICES.to_owned())
}

/// The choice list a grader reads: an array, or JSON text of one; nothing
/// for a missing, empty or unparsable value.
pub fn choice_list(choices: Option<&Value>) -> Vec<Value> {
    graded_choices(choices).unwrap_or_default()
}

/// `parseChoices` and the list methods called on its result: a stored value
/// that is (or parses to) anything other than a list fails the legacy
/// grader, so it is refused here too.
fn graded_choices(choices: Option<&Value>) -> Result<Vec<Value>, GradingError> {
    match choices {
        None | Some(Value::Null | Value::Bool(false)) => Ok(Vec::new()),
        Some(Value::Array(items)) => Ok(items.clone()),
        Some(Value::String(text)) if text.is_empty() => Ok(Vec::new()),
        Some(Value::String(text)) => match serde_json::from_str(text) {
            Ok(Value::Array(items)) => Ok(items),
            Ok(_) => Err(unreadable_choices()),
            Err(_) => Ok(Vec::new()),
        },
        Some(Value::Number(n)) if n.as_f64() == Some(0.0) => Ok(Vec::new()),
        Some(_) => Err(unreadable_choices()),
    }
}

fn opt_num(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64)
}

fn insert_opt(map: &mut Map<String, Value>, key: &str, value: Option<&Value>) {
    if let Some(v) = value {
        map.insert(key.to_owned(), js::normalize(v.clone()));
    }
}

/// `${name}` placeholders in an author's choice feedback.
static FEEDBACK_PLACEHOLDER: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"\$\{([^\n\r\x{2028}\x{2029}]*?)\}").ok());

/// `formatFeedback`: `${name}` -> `String(data[name] || "")`.
fn format_feedback(template: &str, data: &[(&str, Option<&Value>)]) -> String {
    let Some(re) = FEEDBACK_PLACEHOLDER.as_ref() else {
        return template.to_owned();
    };
    re.replace_all(template, |caps: &Captures<'_>| {
        let name = caps.get(1).map_or("", |m| m.as_str());
        data.iter()
            .find(|(k, _)| *k == name)
            .and_then(|(_, v)| *v)
            .filter(|v| js::truthy(v))
            .map(|v| js::to_string(Some(v)))
            .unwrap_or_default()
    })
    .into_owned()
}

/// The text of an author's choice feedback, when it is set (truthy).
fn author_feedback(choice: &Value) -> Option<String> {
    let feedback = choice.get("feedback").filter(|v| js::truthy(v))?;
    Some(js::to_string(Some(feedback)))
}

fn empty_answer(question_id: i32, language: Option<&str>) -> Graded {
    Graded {
        question_id,
        learner_response: Value::String(String::new()),
        points: Some(0.0),
        feedback: vec![json!({"feedback": localized("noResponse", language, &[])})],
        metadata: None,
    }
}

/// Grade one served question's answer.
pub fn grade(
    question: &GradingQuestion,
    response: &SubmittedResponse,
    ctx: &Context<'_>,
) -> Result<Graded, GradingError> {
    if is_empty_response(response) {
        return Ok(empty_answer(question.id, ctx.language));
    }
    match question.question_type.as_str() {
        "SINGLE_CORRECT" => grade_single(question, response, ctx),
        "MULTIPLE_CORRECT" => grade_multiple(question, response, ctx),
        "TRUE_FALSE" => grade_true_false(question, response, ctx),
        other => Err(GradingError(format!(
            "No grading strategy found for question type: {other}"
        ))),
    }
}

fn learner_choices(response: &SubmittedResponse) -> Vec<String> {
    response.choices.clone().unwrap_or_default()
}

/// The authored choice a single-choice answer names: exact text, then
/// without wrapping quotes, then in another stored rendering, then a
/// numerically rewritten label.
fn find_single(choices: &[Value], learner_choice: &str, ctx: &Context<'_>) -> Option<Value> {
    let wanted = choice_match::normalize_str(learner_choice);
    if let Some(found) = choices
        .iter()
        .find(|c| choice_match::normalize_text(c.get("choice")) == wanted)
    {
        return Some(found.clone());
    }
    if let Resolution::Matched(i) = choice_match::match_ignoring_quotes(learner_choice, choices) {
        return choices.get(i).cloned();
    }
    if let Resolution::Matched(m) =
        choice_match::resolve_across_renderings(learner_choice, choices, ctx.renderings, false)
    {
        return Some(m.choice);
    }
    match choice_match::resolve_number_rewritten(learner_choice, choices) {
        Resolution::Matched(i) => choices.get(i).cloned(),
        _ => None,
    }
}

#[allow(clippy::too_many_lines)] // the legacy strategy's branches, in order
fn grade_single(
    question: &GradingQuestion,
    response: &SubmittedResponse,
    ctx: &Context<'_>,
) -> Result<Graded, GradingError> {
    let learner = learner_choices(response);
    if learner.len() > 1 {
        return Err(GradingError(localized(
            "tooManyChoicesSelected",
            ctx.language,
            &[("max", "1")],
        )));
    }
    let learner_response = Value::Array(learner.iter().cloned().map(Value::String).collect());
    let Some(learner_choice) = learner.first() else {
        return Ok(Graded {
            question_id: question.id,
            learner_response,
            points: Some(0.0),
            feedback: vec![json!({
                "choice": "",
                "feedback": localized("noOptionSelected", ctx.language, &[]),
            })],
            metadata: Some(Value::Object(Map::new())),
        });
    };
    let choices = graded_choices(question.choices.as_ref())?;
    let correct = choices.iter().find(|c| js::truthy_opt(c.get("isCorrect")));
    let correct_text = correct.and_then(|c| c.get("choice"));
    let selected = find_single(&choices, learner_choice, ctx);
    let learner_value = Value::String(learner_choice.clone());

    let Some(selected) = selected else {
        let mut metadata = Map::new();
        metadata.insert("isCorrect".into(), Value::Bool(false));
        metadata.insert("error".into(), Value::from("invalidSelection"));
        insert_opt(&mut metadata, "correctChoice", correct_text);
        metadata.insert(
            "maxPossiblePoints".into(),
            Value::from(question.total_points),
        );
        return Ok(Graded {
            question_id: question.id,
            learner_response,
            points: Some(0.0),
            feedback: vec![json!({
                "choice": learner_choice,
                "feedback": localized(
                    "invalidSelection",
                    ctx.language,
                    &[("learnerChoice", learner_choice)],
                ),
            })],
            metadata: Some(Value::Object(metadata)),
        });
    };

    let is_correct = js::truthy_opt(selected.get("isCorrect"));
    let points_value = selected.get("points");
    let feedback_text = match author_feedback(&selected) {
        Some(template) => format_feedback(
            &template,
            &[
                ("learnerChoice", Some(&learner_value)),
                ("correctChoice", correct_text),
                ("points", points_value),
            ],
        ),
        None => localized(
            if is_correct {
                "correctSelection"
            } else {
                "incorrectSelection"
            },
            ctx.language,
            &[
                ("learnerChoice", learner_choice),
                ("correctChoice", &js::to_string(correct_text)),
                ("points", &js::to_string(points_value)),
            ],
        ),
    };
    let zero = Value::from(0);
    let scored = if is_correct {
        points_value
    } else {
        Some(&zero)
    };
    let mut metadata = Map::new();
    insert_opt(&mut metadata, "isCorrect", selected.get("isCorrect"));
    insert_opt(&mut metadata, "correctChoice", correct_text);
    insert_opt(&mut metadata, "possiblePoints", points_value);
    insert_opt(&mut metadata, "scoredPoints", scored);
    metadata.insert(
        "maxPossiblePoints".into(),
        Value::from(question.total_points),
    );
    Ok(Graded {
        question_id: question.id,
        learner_response,
        points: if is_correct {
            opt_num(points_value)
        } else {
            Some(0.0)
        },
        feedback: vec![json!({"choice": learner_choice, "feedback": feedback_text})],
        metadata: Some(Value::Object(metadata)),
    })
}

/// Rewrite each submitted choice to the grading set's text; a choice picked
/// twice (for example once per language) counts once.
fn map_to_grading_language(
    choices: &[Value],
    learner: &[String],
    ctx: &Context<'_>,
) -> Vec<String> {
    let known: Vec<String> = choices
        .iter()
        .map(|c| choice_match::normalize_text(c.get("choice")))
        .collect();
    let mut mapped: Vec<String> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for learner_choice in learner {
        let mut text = learner_choice.clone();
        let is_known = known.contains(&choice_match::normalize_str(learner_choice));
        if !is_known {
            let rewritten = match choice_match::match_ignoring_quotes(learner_choice, choices) {
                Resolution::Matched(i) => choices.get(i).cloned(),
                _ => match choice_match::resolve_across_renderings(
                    learner_choice,
                    choices,
                    ctx.renderings,
                    true,
                ) {
                    Resolution::Matched(m) => Some(m.choice),
                    _ => match choice_match::resolve_number_rewritten(learner_choice, choices) {
                        Resolution::Matched(i) => choices.get(i).cloned(),
                        _ => None,
                    },
                },
            };
            if let Some(choice) = rewritten {
                text = choice_match::coerce_to_string(choice.get("choice"));
            }
        }
        let key = choice_match::normalize_str(&text);
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        mapped.push(text);
    }
    mapped
}

#[allow(clippy::too_many_lines)] // the legacy strategy's steps, in order
fn grade_multiple(
    question: &GradingQuestion,
    response: &SubmittedResponse,
    ctx: &Context<'_>,
) -> Result<Graded, GradingError> {
    let learner = learner_choices(response);
    let learner_response = Value::Array(learner.iter().cloned().map(Value::String).collect());
    if learner.is_empty() {
        return Ok(Graded {
            question_id: question.id,
            learner_response,
            points: Some(0.0),
            feedback: vec![json!({
                "choice": [],
                "feedback": localized("noOptionSelected", ctx.language, &[]),
            })],
            metadata: None,
        });
    }
    let choices = graded_choices(question.choices.as_ref())?;
    let graded = map_to_grading_language(&choices, &learner, ctx);
    let normalized_learner: Vec<String> = {
        let mut set: Vec<String> = Vec::new();
        for text in &graded {
            let n = choice_match::normalize_str(text);
            if !set.contains(&n) {
                set.push(n);
            }
        }
        set
    };
    let normalized_choices: Vec<String> = choices
        .iter()
        .map(|c| choice_match::normalize_text(c.get("choice")))
        .collect();
    let correct: Vec<&Value> = choices
        .iter()
        .filter(|c| js::truthy_opt(c.get("isCorrect")))
        .collect();
    let correct_texts: Vec<String> = correct
        .iter()
        .map(|c| choice_match::normalize_text(c.get("choice")))
        .collect();
    let loss_per_mistake = question
        .scoring
        .as_ref()
        .and_then(|s| s.get("type"))
        .and_then(Value::as_str)
        == Some("LOSS_PER_MISTAKE");

    let mut total = 0.0_f64;
    let mut details: Vec<String> = Vec::new();
    let mut selected: Vec<Value> = Vec::new();
    for learner_choice in &graded {
        let wanted = choice_match::normalize_str(learner_choice);
        let matched = normalized_choices
            .iter()
            .position(|n| *n == wanted)
            .and_then(|i| choices.get(i));
        if let Some(original) = matched {
            let points = js::number_or_zero(original.get("points"));
            let is_correct = js::truthy_opt(original.get("isCorrect"));
            let mut entry = Map::new();
            insert_opt(&mut entry, "choice", original.get("choice"));
            insert_opt(&mut entry, "isCorrect", original.get("isCorrect"));
            entry.insert("points".into(), js::num(points));
            insert_opt(&mut entry, "feedback", original.get("feedback"));
            selected.push(Value::Object(entry));
            if is_correct {
                total += points;
            } else if loss_per_mistake {
                total -= points;
            }
            let points_value = js::num(points);
            let learner_value = Value::String(learner_choice.clone());
            details.push(match author_feedback(original) {
                Some(template) => format_feedback(
                    &template,
                    &[
                        ("learnerChoice", Some(&learner_value)),
                        ("points", Some(&points_value)),
                    ],
                ),
                None => localized(
                    if is_correct {
                        "correctSelection"
                    } else {
                        "incorrectSelection"
                    },
                    ctx.language,
                    &[
                        ("learnerChoice", learner_choice),
                        ("points", &js::number_to_string(points)),
                    ],
                ),
            });
        } else {
            let invalid = localized(
                "invalidSelection",
                ctx.language,
                &[("learnerChoice", learner_choice)],
            );
            selected.push(json!({
                "choice": learner_choice,
                "isCorrect": false,
                "points": 0,
                "feedback": invalid,
            }));
            details.push(invalid);
        }
    }

    let max_points: f64 = correct
        .iter()
        .map(|c| js::number_or_zero(c.get("points")))
        .sum();
    let question_max = f64::from(question.total_points);
    let final_points = total.min(question_max).max(0.0);
    let all_correct = correct_texts.iter().all(|t| normalized_learner.contains(t));
    let none_incorrect = normalized_learner.iter().all(|l| correct_texts.contains(l));
    let perfect = all_correct && none_incorrect;
    let closing = if perfect {
        localized("allCorrectSelected", ctx.language, &[])
    } else {
        String::new()
    };
    let message = format!("\n      {}.\n      {closing}\n    ", details.join(".\n"));

    let mut metadata = Map::new();
    metadata.insert("selectedChoices".into(), Value::Array(selected));
    metadata.insert(
        "correctChoices".into(),
        Value::Array(
            correct
                .iter()
                .map(|c| {
                    c.get("choice")
                        .map_or(Value::Null, |v| js::normalize(v.clone()))
                })
                .collect(),
        ),
    );
    metadata.insert("maxPoints".into(), js::num(max_points));
    metadata.insert("actualPoints".into(), js::num(total));
    metadata.insert("finalPoints".into(), js::num(final_points));
    metadata.insert("perfectScore".into(), Value::Bool(perfect));
    metadata.insert("allCorrectSelected".into(), Value::Bool(all_correct));
    metadata.insert("noIncorrectSelected".into(), Value::Bool(none_incorrect));
    metadata.insert(
        "maxPossiblePoints".into(),
        Value::from(question.total_points),
    );

    Ok(Graded {
        question_id: question.id,
        learner_response,
        points: Some(final_points),
        feedback: vec![json!({
            "choice": learner.join(", "),
            "feedback": js::trim(&message),
        })],
        metadata: Some(Value::Object(metadata)),
    })
}

/// `resolveTrueFalseAnswer`: the boolean the question accepts and the points
/// of the choice that carries it.
fn resolve_true_false(choices: &[Value]) -> Option<(bool, f64)> {
    let label = |c: &Value| {
        c.get("choice")
            .and_then(Value::as_str)
            .map(|s| js::trim(s).to_lowercase())
    };
    let first = choices.first()?;
    let points = |c: &Value| match c.get("points") {
        None | Some(Value::Null) => 0.0,
        Some(v) => v.as_f64().unwrap_or(0.0),
    };
    let Some(index) = choices
        .iter()
        .position(|c| c.get("isCorrect") == Some(&Value::Bool(true)))
    else {
        return Some((label(first).as_deref() == Some("true"), points(first)));
    };
    let correct = &choices[index];
    let answer = match label(correct).as_deref() {
        Some("true") => true,
        Some("false") => false,
        _ => index == 0,
    };
    Some((answer, points(correct)))
}

fn grade_true_false(
    question: &GradingQuestion,
    response: &SubmittedResponse,
    ctx: &Context<'_>,
) -> Result<Graded, GradingError> {
    let Some(learner) = response.answer_choice else {
        return Err(GradingError(localized(
            "expectedTrueFalse",
            ctx.language,
            &[],
        )));
    };
    let choices = match question.choices.as_ref() {
        Some(Value::Array(items)) => items.clone(),
        None => {
            return Err(GradingError("\"undefined\" is not valid JSON".to_owned()));
        }
        Some(Value::String(text)) => match serde_json::from_str::<Value>(text) {
            Ok(Value::Array(items)) => items,
            Ok(_) => Vec::new(),
            Err(_) => return Err(unreadable_choices()),
        },
        Some(_) => return Err(unreadable_choices()),
    };
    let Some((correct_answer, correct_points)) = resolve_true_false(&choices) else {
        return Err(GradingError(localized(
            "missingCorrectAnswer",
            ctx.language,
            &[],
        )));
    };
    let is_correct = learner == correct_answer;
    let feedback = localized(
        if is_correct {
            "correctTF"
        } else {
            "incorrectTFNoAnswer"
        },
        ctx.language,
        &[],
    );
    let possible = if question.total_points == 0 {
        correct_points
    } else {
        f64::from(question.total_points)
    };
    let awarded = if is_correct { possible } else { 0.0 };
    Ok(Graded {
        question_id: question.id,
        learner_response: Value::Bool(learner),
        points: Some(awarded),
        feedback: vec![json!({"feedback": feedback, "choice": learner})],
        metadata: Some(json!({
            "isCorrect": is_correct,
            "learnerResponse": learner,
            "correctAnswer": correct_answer,
            "possiblePoints": js::num(possible),
            "awardedPoints": js::num(awarded),
            "maxPossiblePoints": question.total_points,
        })),
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::float_cmp)]
mod tests {
    use super::*;
    use crate::choice_match::{build_renderings, StoredChoiceTranslation};

    fn question(kind: &str, total: i32, choices: Value) -> GradingQuestion {
        GradingQuestion {
            id: 10,
            question_type: kind.to_owned(),
            total_points: total,
            choices: Some(choices),
            scoring: None,
            grading_context_question_ids: Vec::new(),
        }
    }

    fn picks(list: &[&str]) -> SubmittedResponse {
        let mut r = SubmittedResponse::empty(10);
        r.choices = Some(list.iter().map(|s| (*s).to_owned()).collect());
        r
    }

    fn tf(answer: bool) -> SubmittedResponse {
        let mut r = SubmittedResponse::empty(10);
        r.answer_choice = Some(answer);
        r
    }

    fn ctx() -> Context<'static> {
        Context::default()
    }

    fn colors() -> Value {
        json!([
            {"id": 1, "choice": "Red", "isCorrect": true, "points": 2},
            {"id": 2, "choice": "Blue", "isCorrect": false, "points": 1},
            {"id": 3, "choice": "Green", "isCorrect": true, "points": 2}
        ])
    }

    #[test]
    fn empty_answers_score_zero_with_no_response_feedback() {
        let q = question("SINGLE_CORRECT", 2, colors());
        let g = grade(
            &q,
            &SubmittedResponse::empty(10),
            &Context {
                language: Some("fr"),
                ..ctx()
            },
        )
        .unwrap();
        assert_eq!(g.learner_response, json!(""));
        assert_eq!(g.points, Some(0.0));
        assert_eq!(
            serde_json::to_string(&g.feedback).unwrap(),
            r#"[{"feedback":"Vous n'avez pas répondu à cette question."}]"#
        );
        assert_eq!(g.metadata, None);
    }

    #[test]
    fn single_choice_scores_the_selected_correct_choice() {
        let q = question(
            "SINGLE_CORRECT",
            2,
            json!([
                {"choice": "Paris", "isCorrect": true, "points": 2},
                {"choice": "Lyon", "isCorrect": false, "points": 0, "feedback": "No, ${learnerChoice} is not it (${correctChoice})."}
            ]),
        );
        let g = grade(&q, &picks(&["  paris! "]), &ctx()).unwrap();
        assert_eq!(g.points, Some(2.0));
        assert_eq!(g.learner_response, json!(["  paris! "]));
        assert_eq!(
            serde_json::to_string(&g.feedback).unwrap(),
            r#"[{"choice":"  paris! ","feedback":"**Correct selection:**   paris!  (+2 points)"}]"#
        );
        assert_eq!(
            serde_json::to_string(&g.metadata).unwrap(),
            r#"{"isCorrect":true,"correctChoice":"Paris","possiblePoints":2,"scoredPoints":2,"maxPossiblePoints":2}"#
        );
        let g = grade(&q, &picks(&["Lyon"]), &ctx()).unwrap();
        assert_eq!(g.points, Some(0.0));
        assert_eq!(g.feedback[0]["feedback"], "No, Lyon is not it (Paris).");
        let g = grade(
            &q,
            &picks(&["Rome"]),
            &Context {
                language: Some("de"),
                ..ctx()
            },
        )
        .unwrap();
        assert_eq!(g.points, Some(0.0));
        assert_eq!(g.feedback[0]["feedback"], "**Ungültige Auswahl:** Rome");
        assert_eq!(
            serde_json::to_string(&g.metadata).unwrap(),
            r#"{"isCorrect":false,"error":"invalidSelection","correctChoice":"Paris","maxPossiblePoints":2}"#
        );
        let err = grade(&q, &picks(&["Paris", "Lyon"]), &ctx()).unwrap_err();
        assert_eq!(
            err.message(),
            "Failed to process question response: tooManyChoicesSelected"
        );
    }

    #[test]
    fn single_choice_without_points_cannot_be_summed() {
        let q = question(
            "SINGLE_CORRECT",
            1,
            json!([{"choice": "a", "isCorrect": true}]),
        );
        let g = grade(&q, &picks(&["a"]), &ctx()).unwrap();
        assert_eq!(g.points, None);
        assert_eq!(
            g.feedback[0]["feedback"],
            "**Correct selection:** a (+undefined points)"
        );
        assert_eq!(
            serde_json::to_string(&g.metadata).unwrap(),
            r#"{"isCorrect":true,"correctChoice":"a","maxPossiblePoints":1}"#
        );
    }

    #[test]
    fn multiple_choice_sums_correct_selections_and_caps_at_the_question_max() {
        let q = question("MULTIPLE_CORRECT", 3, colors());
        let g = grade(&q, &picks(&["Red", "Green"]), &ctx()).unwrap();
        assert_eq!(g.points, Some(3.0));
        assert_eq!(
            g.feedback[0]["feedback"],
            "**Correct selection:** Red (+2 points).\n**Correct selection:** Green (+2 points).\n      **You selected all correct options!**"
        );
        assert_eq!(g.feedback[0]["choice"], "Red, Green");
        assert_eq!(
            serde_json::to_string(&g.metadata).unwrap(),
            r#"{"selectedChoices":[{"choice":"Red","isCorrect":true,"points":2},{"choice":"Green","isCorrect":true,"points":2}],"correctChoices":["Red","Green"],"maxPoints":4,"actualPoints":4,"finalPoints":3,"perfectScore":true,"allCorrectSelected":true,"noIncorrectSelected":true,"maxPossiblePoints":3}"#
        );
        // Without the loss rule a wrong pick costs nothing.
        let g = grade(&q, &picks(&["Red", "Blue", "Purple"]), &ctx()).unwrap();
        assert_eq!(g.points, Some(2.0));
        assert_eq!(
            g.feedback[0]["feedback"],
            "**Correct selection:** Red (+2 points).\n**Incorrect selection:** Blue (-1 points).\n**Invalid selection:** Purple."
        );
        assert_eq!(g.metadata.as_ref().unwrap()["perfectScore"], false);
        assert_eq!(
            g.metadata.as_ref().unwrap()["selectedChoices"][2],
            json!({"choice": "Purple", "isCorrect": false, "points": 0, "feedback": "**Invalid selection:** Purple"})
        );
    }

    #[test]
    fn loss_per_mistake_subtracts_and_floors_at_zero() {
        let mut q = question("MULTIPLE_CORRECT", 4, colors());
        q.scoring = Some(json!({"type": "LOSS_PER_MISTAKE"}));
        let g = grade(&q, &picks(&["Red", "Blue"]), &ctx()).unwrap();
        assert_eq!(g.points, Some(1.0));
        assert_eq!(g.metadata.as_ref().unwrap()["actualPoints"], 1);
        let mut q = question(
            "MULTIPLE_CORRECT",
            4,
            json!([
                {"choice": "a", "isCorrect": true, "points": 1},
                {"choice": "b", "isCorrect": false, "points": 3}
            ]),
        );
        q.scoring = Some(json!({"type": "LOSS_PER_MISTAKE"}));
        let g = grade(&q, &picks(&["a", "b"]), &ctx()).unwrap();
        assert_eq!(g.points, Some(0.0));
        assert_eq!(g.metadata.as_ref().unwrap()["actualPoints"], -2);
        assert_eq!(g.metadata.as_ref().unwrap()["finalPoints"], 0);
    }

    #[test]
    fn multiple_choice_with_nothing_selected() {
        let q = question("MULTIPLE_CORRECT", 2, colors());
        let mut r = picks(&[]);
        r.text = Some("typed instead".into());
        let g = grade(&q, &r, &ctx()).unwrap();
        assert_eq!(
            serde_json::to_string(&g.feedback).unwrap(),
            r#"[{"choice":[],"feedback":"**You didn't select any option.**"}]"#
        );
        assert_eq!(g.metadata, None);
        assert_eq!(g.learner_response, json!([]));
    }

    #[test]
    fn translated_and_randomized_renderings_grade_like_the_authored_text() {
        let q = question("MULTIPLE_CORRECT", 4, colors());
        let rows = vec![StoredChoiceTranslation {
            language_code: "fr".into(),
            variant_id: None,
            translated_choices: Some(json!([
                {"id": 1, "choice": "Rouge", "isCorrect": true, "points": 2},
                {"id": 2, "choice": "Bleu", "isCorrect": false, "points": 1},
                {"id": 3, "choice": "Vert", "isCorrect": true, "points": 2}
            ])),
            untranslated_choices: Some(colors()),
        }];
        let own = choice_list(q.choices.as_ref());
        let renderings = build_renderings(Some(&own), Some(&own), None, &rows);
        let ctx = Context {
            language: Some("en"),
            renderings: &renderings,
        };
        // Submitted in French (the last rendering shown), in a randomized order,
        // one pick sent twice across languages.
        let g = grade(&q, &picks(&["Vert", "rouge", "Red"]), &ctx).unwrap();
        assert_eq!(g.points, Some(4.0));
        assert_eq!(g.metadata.as_ref().unwrap()["perfectScore"], true);
        assert_eq!(g.learner_response, json!(["Vert", "rouge", "Red"]));
        assert_eq!(g.feedback[0]["choice"], "Vert, rouge, Red");

        let single = question("SINGLE_CORRECT", 2, colors());
        let g = grade(&single, &picks(&["Bleu"]), &ctx).unwrap();
        assert_eq!(g.points, Some(0.0));
        assert_eq!(
            g.feedback[0]["feedback"],
            "**Incorrect selection:** Bleu (-1 points)"
        );
        // Quotation marks dropped by an older client, and a numeric rewrite.
        let quoted = question(
            "SINGLE_CORRECT",
            1,
            json!([
                {"choice": "\"Hello\"", "isCorrect": true, "points": 1},
                {"choice": "1.620", "isCorrect": false, "points": 0}
            ]),
        );
        assert_eq!(
            grade(&quoted, &picks(&["Hello"]), &ctx).unwrap().points,
            Some(1.0)
        );
        let g = grade(&quoted, &picks(&["1.62"]), &ctx).unwrap();
        assert_eq!(g.metadata.as_ref().unwrap()["isCorrect"], false);
        assert!(g.metadata.as_ref().unwrap().get("error").is_none());
    }

    #[test]
    fn true_false_reads_the_flagged_choice() {
        let q = question(
            "TRUE_FALSE",
            1,
            json!([
                {"choice": "True", "isCorrect": false, "points": 0},
                {"choice": "False", "isCorrect": true, "points": 1}
            ]),
        );
        let g = grade(&q, &tf(false), &ctx()).unwrap();
        assert_eq!(g.points, Some(1.0));
        assert_eq!(
            serde_json::to_string(&g.feedback).unwrap(),
            r#"[{"feedback":"Correct! Your answer is right.","choice":false}]"#
        );
        assert_eq!(
            serde_json::to_string(&g.metadata).unwrap(),
            r#"{"isCorrect":true,"learnerResponse":false,"correctAnswer":false,"possiblePoints":1,"awardedPoints":1,"maxPossiblePoints":1}"#
        );
        let g = grade(
            &q,
            &tf(true),
            &Context {
                language: Some("ar"),
                ..ctx()
            },
        )
        .unwrap();
        assert_eq!(g.points, Some(0.0));
        assert_eq!(g.feedback[0]["feedback"], "خطأ.");
        assert_eq!(g.learner_response, json!(true));
        // Zero question points fall back to the flagged choice's points.
        let zero = question(
            "TRUE_FALSE",
            0,
            json!([{"choice": "True", "isCorrect": true, "points": 3}]),
        );
        assert_eq!(grade(&zero, &tf(true), &ctx()).unwrap().points, Some(3.0));
        // Legacy rows with nothing flagged read the first label.
        let legacy = question(
            "TRUE_FALSE",
            1,
            json!([{"choice": "false"}, {"choice": "true"}]),
        );
        assert_eq!(
            grade(&legacy, &tf(false), &ctx()).unwrap().points,
            Some(1.0)
        );
        // Unparseable label: position decides.
        let odd = question(
            "TRUE_FALSE",
            1,
            json!([{"choice": "Vrai", "isCorrect": true}]),
        );
        assert_eq!(grade(&odd, &tf(true), &ctx()).unwrap().points, Some(1.0));
    }

    #[test]
    fn true_false_refusals() {
        let q = question("TRUE_FALSE", 1, json!([]));
        let err = grade(&q, &tf(true), &ctx()).unwrap_err();
        assert_eq!(
            err.message(),
            "Failed to process question response: missingCorrectAnswer"
        );
        let mut r = SubmittedResponse::empty(10);
        r.text = Some("true".into());
        let q = question(
            "TRUE_FALSE",
            1,
            json!([{"choice": "True", "isCorrect": true}]),
        );
        let err = grade(
            &q,
            &r,
            &Context {
                language: Some("es"),
                ..ctx()
            },
        )
        .unwrap_err();
        assert_eq!(
            err.message(),
            "Failed to process question response: Se esperaba una respuesta verdadero/falso, pero no se recibió."
        );
    }

    #[test]
    fn unreadable_stored_choices_are_refused_without_their_text() {
        let generic = format!("Failed to process question response: {UNREADABLE_CHOICES}");
        let secret = json!({"choice": "Paris", "isCorrect": true});
        for kind in ["SINGLE_CORRECT", "MULTIPLE_CORRECT"] {
            for stored in [secret.clone(), json!(secret.to_string()), json!(7)] {
                let q = question(kind, 2, stored.clone());
                let err = grade(&q, &picks(&["Paris"]), &ctx()).unwrap_err();
                assert_eq!(err.message(), generic, "{kind} {stored}");
                // No pick: the legacy grader answers before reading them.
                let q = question(kind, 2, stored);
                assert_eq!(grade(&q, &picks(&[]), &ctx()).unwrap().points, Some(0.0));
            }
            // Unparsable text grades against no choices, as before.
            let q = question(kind, 2, json!("{not json"));
            assert_eq!(
                grade(&q, &picks(&["Paris"]), &ctx()).unwrap().points,
                Some(0.0)
            );
        }
        for stored in [json!("[{\"choice\": \"True\", \"isCorrect\": tru"), secret] {
            let q = question("TRUE_FALSE", 1, stored);
            let err = grade(&q, &tf(true), &ctx()).unwrap_err();
            assert_eq!(err.message(), generic);
            assert!(!err.message().contains("True") && !err.message().contains("Paris"));
        }
    }
}
