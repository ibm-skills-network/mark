CREATE TABLE "Assignment" (id INTEGER PRIMARY KEY, name TEXT, introduction TEXT, instructions TEXT, "gradingCriteriaOverview" TEXT, "updatedAt" TIMESTAMPTZ DEFAULT '2020-01-01');
CREATE TABLE "AssignmentVersion" (id INTEGER PRIMARY KEY, "assignmentId" INTEGER, introduction TEXT, instructions TEXT, "gradingCriteriaOverview" TEXT);
CREATE TABLE "AssignmentDraft" (id INTEGER PRIMARY KEY, "assignmentId" INTEGER, introduction TEXT, instructions TEXT, "gradingCriteriaOverview" TEXT, "questionsData" JSONB, "updatedAt" TIMESTAMPTZ DEFAULT '2020-01-01');
CREATE TABLE "Question" (id INTEGER PRIMARY KEY, "assignmentId" INTEGER, question TEXT, type TEXT DEFAULT 'TEXT', "isDeleted" BOOLEAN DEFAULT TRUE, "totalPoints" INTEGER DEFAULT 10);
CREATE TABLE "QuestionVersion" (id INTEGER PRIMARY KEY, "assignmentVersionId" INTEGER, "questionId" INTEGER, question TEXT, type TEXT DEFAULT 'TEXT');
CREATE TABLE "QuestionVariant" (id INTEGER PRIMARY KEY, "questionId" INTEGER, "variantContent" TEXT, "isDeleted" BOOLEAN DEFAULT TRUE, UNIQUE("questionId", "variantContent"));
CREATE TABLE "Translation" (id INTEGER PRIMARY KEY, "questionId" INTEGER, "variantId" INTEGER, "translatedText" TEXT, "untranslatedText" TEXT);
CREATE TABLE "AssignmentTranslation" (id INTEGER PRIMARY KEY, "assignmentId" INTEGER, introduction TEXT, instructions TEXT, "gradingCriteriaOverview" TEXT, "translatedIntroduction" TEXT, "translatedInstructions" TEXT, "translatedGradingCriteriaOverview" TEXT);
CREATE TABLE "AssignmentAttempt" (id INTEGER PRIMARY KEY, "assignmentId" INTEGER, "assignmentVersionId" INTEGER, grade NUMERIC DEFAULT 7.25, submitted BOOLEAN DEFAULT TRUE);
CREATE TABLE "QuestionResponse" (id INTEGER PRIMARY KEY, "assignmentAttemptId" INTEGER, "questionId" INTEGER, "learnerResponse" TEXT, points NUMERIC DEFAULT 7.25, feedback JSONB DEFAULT '{"feedback":"original"}', "gradedAt" TIMESTAMPTZ DEFAULT '2020-01-01');

CREATE TABLE "FeedbackTranslation" (id INTEGER PRIMARY KEY, "questionId" INTEGER, "translatedFeedback" JSONB, "untranslatedFeedback" JSONB);
ALTER TABLE "Question" ADD "authorComment" TEXT, ADD scoring JSONB, ADD choices JSONB;
ALTER TABLE "QuestionVersion" ADD "authorComment" TEXT, ADD scoring JSONB, ADD choices JSONB;
ALTER TABLE "QuestionVariant" ADD scoring JSONB, ADD choices JSONB;
ALTER TABLE "Translation" ADD "translatedChoices" JSONB, ADD "untranslatedChoices" JSONB;
ALTER TABLE "QuestionResponse" ADD metadata JSONB;
