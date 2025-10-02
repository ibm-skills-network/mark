-- CreateEnum for CorrectAnswerVisibility
CREATE TYPE "CorrectAnswerVisibility" AS ENUM ('NEVER', 'ALWAYS', 'ON_PASS');

-- Add the new column with ALWAYS as default
ALTER TABLE "Assignment" ADD COLUMN "correctAnswerVisibility" "CorrectAnswerVisibility" DEFAULT 'ALWAYS';

-- Convert existing data: if showCorrectAnswer was true, set to ON_PASS, otherwise set to NEVER
UPDATE "Assignment"
SET "correctAnswerVisibility" = CASE
    WHEN "showCorrectAnswer" = true THEN 'ON_PASS'::"CorrectAnswerVisibility"
    ELSE 'NEVER'::"CorrectAnswerVisibility"
END;

-- Make the new column NOT NULL after data conversion
ALTER TABLE "Assignment" ALTER COLUMN "correctAnswerVisibility" SET NOT NULL;

-- Drop the old column
ALTER TABLE "Assignment" DROP COLUMN "showCorrectAnswer";

-- Add the new column to AssignmentVersion table
ALTER TABLE "AssignmentVersion" ADD COLUMN "correctAnswerVisibility" "CorrectAnswerVisibility" DEFAULT 'ALWAYS';

-- Update existing AssignmentVersion data: copy from parent Assignment
UPDATE "AssignmentVersion" av
SET "correctAnswerVisibility" = a."correctAnswerVisibility"
FROM "Assignment" a
WHERE av."assignmentId" = a.id;

-- Make the new column NOT NULL after data conversion
ALTER TABLE "AssignmentVersion" ALTER COLUMN "correctAnswerVisibility" SET NOT NULL;