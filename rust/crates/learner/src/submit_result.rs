//! The learner-facing submit result (`submit-result.util.ts`) and the
//! pass/fail rule (`pass-fail.util.ts`) shared with the completed read.

use serde::Serialize;
use serde_json::Value;

use crate::answer_key;
use crate::params::whole_f64;

/// Passing grade when an assignment leaves it unset (the column default).
pub const DEFAULT_PASSING_GRADE: i32 = 50;

/// Whether a 0-1 grade meets an integer percentage passing grade. The
/// threshold is scaled down rather than the grade up (`0.29 * 100` is
/// 28.999999999999996). No grade never passes.
pub fn meets_passing_grade(grade: Option<f64>, passing_grade: Option<i32>) -> bool {
    grade.is_some_and(|g| g >= f64::from(passing_grade.unwrap_or(DEFAULT_PASSING_GRADE)) / 100.0)
}

/// The pass/fail verdict, only when the indicator is on and a grade exists.
pub fn passed_indicator(
    show: bool,
    grade: Option<f64>,
    passing_grade: Option<i32>,
) -> Option<bool> {
    (show && grade.is_some()).then(|| meets_passing_grade(grade, passing_grade))
}

/// Whether the answer key may be shown: `ALWAYS`, or `ON_PASS` with a passing
/// grade.
pub fn answers_revealed(visibility: &str, grade: Option<f64>, passing_grade: Option<i32>) -> bool {
    match visibility {
        "ALWAYS" => true,
        "ON_PASS" => meets_passing_grade(grade, passing_grade),
        _ => false,
    }
}

/// The assignment settings a result is shaped by (base `Assignment` row,
/// visibility from the current version).
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(clippy::struct_excessive_bools)] // mirrors the assignment columns
pub struct ResultSettings {
    pub show_assignment_score: bool,
    pub show_submission_feedback: bool,
    pub show_questions: bool,
    pub show_question_score: bool,
    pub show_pass_fail_indicator: bool,
    pub passing_grade: Option<i32>,
    pub correct_answer_visibility: String,
}

/// One graded and stored answer, as the result reports it.
#[derive(Debug, Clone, PartialEq)]
pub struct ResultResponse {
    /// The stored `QuestionResponse` id.
    pub id: i32,
    pub question_id: i32,
    pub points: Option<f64>,
    pub feedback: Vec<Value>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionFeedback {
    pub id: i32,
    pub question_id: i32,
    #[serde(serialize_with = "whole_f64")]
    pub total_points: Option<f64>,
    pub feedback: Option<Vec<Value>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)] // wire shape fixed by the contract
pub struct SubmitResult {
    pub id: i32,
    pub submitted: bool,
    #[serde(serialize_with = "whole_f64")]
    pub grade: Option<f64>,
    #[serde(serialize_with = "whole_f64")]
    pub total_points_earned: Option<f64>,
    #[serde(serialize_with = "whole_f64")]
    pub total_possible_points: Option<f64>,
    pub passed: Option<bool>,
    pub show_assignment_score: bool,
    pub show_submission_feedback: bool,
    pub show_questions: bool,
    pub show_question_score: bool,
    pub show_pass_fail_indicator: bool,
    pub correct_answer_visibility: String,
    pub feedbacks_for_questions: Vec<QuestionFeedback>,
}

/// `buildSubmitResult`: each value the assignment hides is null; with
/// `showQuestions` off no per-question entry is sent; the answer-key
/// sentences appear only when the key is revealed.
pub fn build(
    attempt_id: i32,
    grade: Option<f64>,
    total_points_earned: f64,
    total_possible_points: f64,
    settings: &ResultSettings,
    responses: &[ResultResponse],
    language: Option<&str>,
) -> SubmitResult {
    let reveal = answers_revealed(
        &settings.correct_answer_visibility,
        grade,
        settings.passing_grade,
    );
    let show_score = settings.show_assignment_score;
    let feedbacks = if settings.show_questions {
        responses
            .iter()
            .map(|r| QuestionFeedback {
                id: r.id,
                question_id: r.question_id,
                total_points: r.points.filter(|_| settings.show_question_score),
                feedback: settings.show_submission_feedback.then(|| {
                    answer_key::apply_from_metadata(
                        &r.feedback,
                        r.metadata.as_ref(),
                        reveal,
                        language,
                    )
                }),
            })
            .collect()
    } else {
        Vec::new()
    };
    SubmitResult {
        id: attempt_id,
        submitted: true,
        grade: grade.filter(|_| show_score),
        total_points_earned: show_score.then_some(total_points_earned),
        total_possible_points: show_score.then_some(total_possible_points),
        passed: passed_indicator(
            settings.show_pass_fail_indicator,
            grade,
            settings.passing_grade,
        ),
        show_assignment_score: show_score,
        show_submission_feedback: settings.show_submission_feedback,
        show_questions: settings.show_questions,
        show_question_score: settings.show_question_score,
        show_pass_fail_indicator: settings.show_pass_fail_indicator,
        correct_answer_visibility: settings.correct_answer_visibility.clone(),
        feedbacks_for_questions: feedbacks,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn settings() -> ResultSettings {
        ResultSettings {
            show_assignment_score: true,
            show_submission_feedback: true,
            show_questions: true,
            show_question_score: true,
            show_pass_fail_indicator: true,
            passing_grade: Some(50),
            correct_answer_visibility: "ALWAYS".into(),
        }
    }

    fn responses() -> Vec<ResultResponse> {
        vec![
            ResultResponse {
                id: 101,
                question_id: 1,
                points: Some(1.0),
                feedback: vec![json!({"choice": "a, c", "feedback": "x."})],
                metadata: Some(json!({"perfectScore": false, "correctChoices": ["a", "b"]})),
            },
            ResultResponse {
                id: 102,
                question_id: 2,
                points: Some(0.0),
                feedback: vec![json!({"feedback": "Incorrect.", "choice": true})],
                metadata: Some(json!({"isCorrect": false, "correctAnswer": false})),
            },
        ]
    }

    #[test]
    fn everything_shown() {
        let r = build(
            7,
            Some(0.5),
            1.0,
            2.0,
            &settings(),
            &responses(),
            Some("en"),
        );
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            concat!(
                r#"{"id":7,"submitted":true,"grade":0.5,"totalPointsEarned":1,"totalPossiblePoints":2,"passed":true,"#,
                r#""showAssignmentScore":true,"showSubmissionFeedback":true,"showQuestions":true,"showQuestionScore":true,"#,
                r#""showPassFailIndicator":true,"correctAnswerVisibility":"ALWAYS","feedbacksForQuestions":["#,
                r#"{"id":101,"questionId":1,"totalPoints":1,"feedback":[{"choice":"a, c","feedback":"x.\nThe correct option(s) were: **a, b**."}]},"#,
                r#"{"id":102,"questionId":2,"totalPoints":0,"feedback":[{"feedback":"Incorrect. The correct answer is False.","choice":true}]}]}"#
            )
        );
    }

    #[test]
    fn each_flag_hides_its_values() {
        let mut s = settings();
        s.show_assignment_score = false;
        let r = build(7, Some(0.5), 1.0, 2.0, &s, &responses(), None);
        assert_eq!(
            (r.grade, r.total_points_earned, r.total_possible_points),
            (None, None, None)
        );
        // Pass/fail is computed even when the score is hidden.
        assert_eq!(r.passed, Some(true));

        let mut s = settings();
        s.show_question_score = false;
        let r = build(7, Some(0.5), 1.0, 2.0, &s, &responses(), None);
        assert!(r
            .feedbacks_for_questions
            .iter()
            .all(|f| f.total_points.is_none()));
        let text = serde_json::to_string(&r).unwrap();
        assert!(text.contains(r#""totalPoints":null"#), "{text}");

        let mut s = settings();
        s.show_submission_feedback = false;
        let r = build(7, Some(0.5), 1.0, 2.0, &s, &responses(), None);
        assert!(r
            .feedbacks_for_questions
            .iter()
            .all(|f| f.feedback.is_none()));

        let mut s = settings();
        s.show_questions = false;
        let r = build(7, Some(0.5), 1.0, 2.0, &s, &responses(), None);
        assert!(r.feedbacks_for_questions.is_empty());

        let mut s = settings();
        s.show_pass_fail_indicator = false;
        assert_eq!(
            build(7, Some(0.5), 1.0, 2.0, &s, &responses(), None).passed,
            None
        );
    }

    #[test]
    fn answer_key_follows_visibility() {
        let mut s = settings();
        s.correct_answer_visibility = "NEVER".into();
        let r = build(7, Some(1.0), 2.0, 2.0, &s, &responses(), None);
        assert_eq!(
            r.feedbacks_for_questions[0].feedback.as_ref().unwrap()[0]["feedback"],
            "x."
        );
        s.correct_answer_visibility = "ON_PASS".into();
        let r = build(7, Some(0.49), 1.0, 2.0, &s, &responses(), None);
        assert_eq!(
            r.feedbacks_for_questions[1].feedback.as_ref().unwrap()[0]["feedback"],
            "Incorrect."
        );
        let r = build(7, Some(0.5), 1.0, 2.0, &s, &responses(), Some("fr"));
        assert_eq!(
            r.feedbacks_for_questions[1].feedback.as_ref().unwrap()[0]["feedback"],
            "Incorrect. La bonne réponse est Faux."
        );
    }

    #[test]
    fn pass_fail_rule() {
        assert!(meets_passing_grade(Some(0.29), Some(29)));
        assert!(!meets_passing_grade(Some(0.28), Some(29)));
        assert!(meets_passing_grade(Some(0.5), None));
        assert!(!meets_passing_grade(None, Some(0)));
        assert_eq!(passed_indicator(true, None, None), None);
        assert_eq!(passed_indicator(true, Some(0.1), None), Some(false));
        assert!(!answers_revealed("ON_PASS", None, Some(0)));
    }
}
