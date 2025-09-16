-- 2025-08-12: Backfill initial versions (v1) for assignments without versions
-- Mirrors createInitialVersions() behavior with per-assignment error isolation.

DO $$
DECLARE
  r RECORD;
  v_assignment_version_id "AssignmentVersion".id%TYPE;
BEGIN
  RAISE NOTICE 'Starting to create initial versions for existing assignments...';

  -- Loop over assignments that have NO versions
  FOR r IN
    SELECT
      a.id AS "assignmentId",
      a.name,
      a.introduction,
      a.instructions,
      a."gradingCriteriaOverview",
      a."timeEstimateMinutes",
      a.type,
      a.graded,
      a."numAttempts",
      a."allotedTimeMinutes",
      a."attemptsPerTimeRange",
      a."attemptsTimeRangeHours",
      a."passingGrade",
      a."displayOrder",
      a."questionDisplay",
      a."numberOfQuestionsPerAttempt",
      a."questionOrder",
      a.published,
      a."showAssignmentScore",
      a."showQuestionScore",
      a."showSubmissionFeedback",
      a."showQuestions",
      a."languageCode",
      COALESCE(la."userId", 'system') AS "createdBy"
    FROM "Assignment" a
    LEFT JOIN "AssignmentVersion" av
      ON av."assignmentId" = a.id
    -- choose "first" author, mimicking array [0]; deterministic by createdAt, then id
    LEFT JOIN LATERAL (
      SELECT aa."userId"
      FROM "AssignmentAuthor" aa
      WHERE aa."assignmentId" = a.id
      ORDER BY aa."createdAt" NULLS LAST, aa.id
      LIMIT 1
    ) la ON TRUE
    WHERE av.id IS NULL
  LOOP
    BEGIN
      RAISE NOTICE 'Creating version 1 for assignment "%"(ID: %)', r.name, r."assignmentId";

      -- Create AssignmentVersion v1 (non-draft, active)
      INSERT INTO "AssignmentVersion" (
        "assignmentId",
        "versionNumber",
        name,
        introduction,
        instructions,
        "gradingCriteriaOverview",
        "timeEstimateMinutes",
        type,
        graded,
        "numAttempts",
        "allotedTimeMinutes",
        "attemptsPerTimeRange",
        "attemptsTimeRangeHours",
        "passingGrade",
        "displayOrder",
        "questionDisplay",
        "numberOfQuestionsPerAttempt",
        "questionOrder",
        published,
        "showAssignmentScore",
        "showQuestionScore",
        "showSubmissionFeedback",
        "showQuestions",
        "languageCode",
        "createdBy",
        "isDraft",
        "versionDescription",
        "isActive"
      )
      VALUES (
        r."assignmentId",
        1,
        r.name,
        r.introduction,
        r.instructions,
        r."gradingCriteriaOverview",
        r."timeEstimateMinutes",
        r.type,
        r.graded,
        r."numAttempts",
        r."allotedTimeMinutes",
        r."attemptsPerTimeRange",
        r."attemptsTimeRangeHours",
        r."passingGrade",
        r."displayOrder",
        r."questionDisplay",
        r."numberOfQuestionsPerAttempt",
        r."questionOrder",
        r.published,
        r."showAssignmentScore",
        r."showQuestionScore",
        r."showSubmissionFeedback",
        r."showQuestions",
        r."languageCode",
        r."createdBy",
        FALSE,
        'Initial version created from existing assignment',
        TRUE
      )
      RETURNING id INTO v_assignment_version_id;

      -- Create QuestionVersion rows for non-deleted questions
      INSERT INTO "QuestionVersion" (
        "assignmentVersionId",
        "questionId",
        "totalPoints",
        type,
        "responseType",
        question,
        "maxWords",
        scoring,
        choices,
        "randomizedChoices",
        answer,
        "gradingContextQuestionIds",
        "maxCharacters",
        "videoPresentationConfig",
        "liveRecordingConfig",
        "displayOrder"
      )
      SELECT
        v_assignment_version_id,
        q.id,
        q."totalPoints",
        q.type,
        q."responseType",
        q.question,
        q."maxWords",
        q.scoring,
        q.choices,
        q."randomizedChoices",
        q.answer,
        q."gradingContextQuestionIds",
        q."maxCharacters",
        q."videoPresentationConfig",
        q."liveRecordingConfig",
        ROW_NUMBER() OVER (
          ORDER BY q."createdAt", q.id
        )::int AS "displayOrder"  -- index + 1 equivalent
      FROM "Question" q
      WHERE q."assignmentId" = r."assignmentId"
        AND q."isDeleted" = FALSE;

      -- Update Assignment.currentVersionId
      UPDATE "Assignment"
      SET "currentVersionId" = v_assignment_version_id
      WHERE id = r."assignmentId";

      -- VersionHistory entry (userId same selection as createdBy)
      INSERT INTO "VersionHistory" (
        "assignmentId",
        "toVersionId",
        action,
        description,
        "userId"
      )
      VALUES (
        r."assignmentId",
        v_assignment_version_id,
        'initial_version_created',
        'Initial version created during migration',
        r."createdBy"
      );

      RAISE NOTICE '✅ Created version 1 for assignment "%" (ID: %)', r.name, r."assignmentId";

    EXCEPTION WHEN OTHERS THEN
      -- Match script behavior: log error and continue with next assignment
      RAISE WARNING '❌ Failed to create version for assignment "%" (ID: %): %',
        r.name, r."assignmentId", SQLERRM;
      -- Continue to next record
    END;
  END LOOP;

  -- Optional verification like the script's summary
  RAISE NOTICE '📊 Summary:';
  PERFORM 1; -- no-op to keep block structure tidy
  RAISE NOTICE '- Total assignment versions in database: %',
    (SELECT COUNT(*) FROM "AssignmentVersion");
  RAISE NOTICE '- Assignments with versions: %',
    (SELECT COUNT(*) FROM "Assignment" a WHERE EXISTS (
       SELECT 1 FROM "AssignmentVersion" av WHERE av."assignmentId" = a.id
     ));

  RAISE NOTICE '✅ Migration block completed';
END
$$ LANGUAGE plpgsql;
