#![allow(clippy::expect_used)]

//! Every statement in `store` against a real schema. Runs only when
//! `DATABASE_URL` is set *and* the Prisma schema is present (CI's empty
//! Postgres has no tables, so it skips there). Catches table/column typos.
//!
//! Safe against a live database: everything runs inside one
//! `BEGIN READ ONLY` transaction that is rolled back, against ids that do
//! not exist. Writes therefore fail with 25006 after parse/analysis, which
//! is exactly the check we want (a bad column fails earlier with 42xxx).
//! No session-level settings are touched.

use std::collections::HashMap;

use mark_learner::store::{self, FrozenSelectionInsert, Owner};
use mark_platform::{db, Config, Role};
use sqlx::{Connection, PgConnection, Row};

fn database_url() -> Option<String> {
    std::env::var("DATABASE_URL").ok().filter(|v| !v.is_empty())
}

/// A statement is well-formed if it ran, or failed only because the
/// transaction is read-only or a constraint rejected the fake ids.
fn assert_well_formed<T: std::fmt::Debug>(name: &str, result: Result<T, sqlx::Error>) {
    if let Err(err) = result {
        let code = match &err {
            sqlx::Error::Database(db) => db.code().map(std::borrow::Cow::into_owned),
            _ => None,
        };
        let ok = matches!(code.as_deref(), Some("25006"))
            || code.as_deref().is_some_and(|c| c.starts_with("23"));
        assert!(ok, "{name}: {err} (sqlstate {code:?})");
    }
}

macro_rules! check {
    ($tx:expr, $name:literal, $call:expr) => {{
        sqlx::query("SAVEPOINT stmt")
            .persistent(false)
            .execute(&mut *$tx)
            .await
            .expect("savepoint");
        let result = $call.await;
        assert_well_formed($name, result);
        sqlx::query("ROLLBACK TO SAVEPOINT stmt")
            .persistent(false)
            .execute(&mut *$tx)
            .await
            .expect("rollback to savepoint");
    }};
}

#[tokio::test]
#[allow(clippy::too_many_lines)] // one line per statement, by design
async fn every_statement_prepares_against_the_schema() {
    let Some(url) = database_url() else {
        eprintln!("DATABASE_URL not set; skipping");
        return;
    };
    let leaked: &'static str = Box::leak(url.into_boxed_str());
    let config =
        Config::load(Role::Api, &HashMap::from([("DATABASE_URL", leaked)])).expect("config");
    let pool = db::pool(&config).expect("pool");
    let mut conn = pool.acquire().await.expect("connection");

    let present: bool = sqlx::query(r#"SELECT to_regclass('"Assignment"') IS NOT NULL AS present"#)
        .persistent(false)
        .fetch_one(&mut *conn)
        .await
        .expect("to_regclass")
        .try_get("present")
        .expect("column");
    if !present {
        eprintln!("Prisma schema not present; skipping");
        return;
    }

    let mut tx = conn
        .begin_with("BEGIN READ ONLY")
        .await
        .expect("begin read only");
    let c: &mut PgConnection = &mut tx;
    let now = chrono::Utc::now().naive_utc();
    let none: Vec<i32> = vec![-1];
    let frozen = vec![FrozenSelectionInsert {
        question_id: -1,
        variant_id: None,
        randomized_choices: Some("[]".into()),
    }];

    check!(
        c,
        "assignment_access",
        store::assignment_access(c, -1, Some("g"))
    );
    check!(
        c,
        "heal_group_link",
        store::heal_group_link(c, -1, "no-such-group")
    );
    check!(
        c,
        "find_attempt user",
        store::find_attempt(c, -1, -1, Owner::User("u"))
    );
    check!(
        c,
        "find_attempt any",
        store::find_attempt(c, -1, -1, Owner::Anyone)
    );
    check!(
        c,
        "list_attempts user",
        store::list_attempts(c, -1, Owner::User("u"))
    );
    check!(
        c,
        "list_attempts any",
        store::list_attempts(c, -1, Owner::Anyone)
    );
    check!(c, "load_assignment", store::load_assignment(c, -1));
    check!(
        c,
        "load_active_version",
        store::load_active_version(c, -1, Some(-1))
    );
    check!(
        c,
        "load_active_version null",
        store::load_active_version(c, -1, None)
    );
    check!(
        c,
        "assignment_translations",
        store::assignment_translations(c, -1, "fr%")
    );
    check!(c, "language_codes", store::language_codes(c, -1));
    check!(c, "attempt_settings", store::attempt_settings(c, -1));
    check!(
        c,
        "version_alloted_time",
        store::version_alloted_time(c, -1)
    );
    check!(c, "version_questions", store::version_questions(c, -1));
    check!(c, "live_questions", store::live_questions(c, -1));
    check!(c, "frozen_selections", store::frozen_selections(c, -1));
    check!(
        c,
        "question_translations",
        store::question_translations(c, "fr%", &none, &none)
    );
    check!(c, "question_responses", store::question_responses(c, -1));
    check!(c, "find_resumable", store::find_resumable(c, -1, "u", now));
    check!(
        c,
        "set_local_lock_timeout",
        store::set_local_lock_timeout(c)
    );
    check!(
        c,
        "lock_attempt_creation",
        store::lock_attempt_creation(c, "statement-check:-1")
    );
    check!(
        c,
        "has_ai_graded_question",
        store::has_ai_graded_question(c, -1)
    );
    check!(
        c,
        "count_attempts_between",
        store::count_attempts_between(c, -1, "u", now, now)
    );
    check!(c, "count_attempts", store::count_attempts(c, -1, "u"));
    check!(
        c,
        "last_submitted_reference",
        store::last_submitted_reference(c, -1, "u")
    );
    check!(
        c,
        "insert_attempt",
        store::insert_attempt(c, -1, None, "u", None)
    );
    check!(c, "version_pool", store::version_pool(c, -1));
    check!(c, "live_pool", store::live_pool(c, -1));
    check!(c, "live_variants", store::live_variants(c, -1));
    check!(
        c,
        "set_question_order",
        store::set_question_order(c, -1, &[1, 2])
    );
    check!(
        c,
        "insert_frozen_selections",
        store::insert_frozen_selections(c, -1, &frozen)
    );
    check!(
        c,
        "lock_attempt_for_abandon",
        store::lock_attempt_for_abandon(c, -1)
    );
    check!(c, "delete_attempt", store::delete_attempt(c, -1));

    // Submit and results.
    let responses = vec![store::ResponseInsert {
        question_id: -1,
        learner_response: r#"["a"]"#.into(),
        points: 1.0,
        feedback: r#"[{"feedback":"x"}]"#.into(),
        metadata: Some(r#""{\"isCorrect\":true}""#.into()),
    }];
    check!(c, "submit_settings", store::submit_settings(c, -1));
    check!(c, "pinned_questions", store::pinned_questions(c, -1));
    check!(
        c,
        "live_grading_questions",
        store::live_grading_questions(c, -1)
    );
    check!(c, "questions_by_ids", store::questions_by_ids(c, &none));
    check!(
        c,
        "translations_of_questions any",
        store::translations_of_questions(c, &none, None)
    );
    check!(
        c,
        "translations_of_questions family",
        store::translations_of_questions(c, &none, Some("fr%"))
    );
    check!(
        c,
        "close_expired_attempt",
        store::close_expired_attempt(c, -1, "closed")
    );
    check!(c, "attempt_submitted", store::attempt_submitted(c, -1));
    check!(
        c,
        "insert_question_responses",
        store::insert_question_responses(c, -1, &responses, now)
    );
    check!(
        c,
        "prune_question_responses",
        store::prune_question_responses(c, -1, &none)
    );
    check!(
        c,
        "commit_attempt",
        store::commit_attempt(c, -1, 0.5, "en", now)
    );
    check!(
        c,
        "complete_grading_progress",
        store::complete_grading_progress(c, -1, now)
    );
    check!(
        c,
        "enable_grading_notification",
        store::enable_grading_notification(c, -1, "u@x", now)
    );
    check!(c, "attempt_grades", store::attempt_grades(c, -1, "u"));
    check!(
        c,
        "insert_lti_sync",
        store::insert_lti_sync(
            c,
            &store::LtiSyncInsert {
                attempt_id: -1,
                user_id: "u",
                assignment_id: -1,
                grade: 0.5,
                auth_cookie: "cookie",
                gateway_url: Some("http://gateway"),
                now,
            }
        )
    );
    check!(
        c,
        "mark_lti_sync_success",
        store::mark_lti_sync_success(c, -1, now)
    );
    check!(
        c,
        "schedule_lti_sync_retry",
        store::schedule_lti_sync_retry(
            c,
            -1,
            1,
            "boom",
            &serde_json::json!([{"attempt": 1}]),
            now,
            now
        )
    );
    check!(
        c,
        "insert_lti_error_log",
        store::insert_lti_error_log(
            c,
            &store::LtiErrorLogInsert {
                sync_id: -1,
                attempt_number: 1,
                error_message: "boom",
                http_status: Some(500),
                response_body: Some("{}"),
                metadata: serde_json::json!({"attemptId": -1}),
                now,
            }
        )
    );
    check!(
        c,
        "insert_grade_sync_notification",
        store::insert_grade_sync_notification(c, "u", "t", "m", "{}", now)
    );
    check!(
        c,
        "mark_lti_learner_notified",
        store::mark_lti_learner_notified(c, -1, now)
    );
    check!(c, "latest_lti_sync", store::latest_lti_sync(c, -1));
    check!(c, "lti_error_logs", store::lti_error_logs(c, -1));

    tx.rollback().await.expect("rollback");
}
