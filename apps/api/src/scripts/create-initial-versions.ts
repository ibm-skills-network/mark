#!/usr/bin/env ts-node

/**
 * Script to create initial versions (version 1) for all existing assignments
 * This should be run once to migrate existing assignments to the new version system
 */
import { PrismaService } from "../prisma.service";

async function createInitialVersions() {
  const prisma = new PrismaService();

  try {
    console.log(
      "Starting to create initial versions for existing assignments...",
    );

    const alreadyMigrated = await prisma.assignmentVersion.count();
    if (alreadyMigrated > 0) {
      console.log("🚫 Initial versions already exist. Skipping migration.");
      process.exit(0);
    }

    // Find all assignments that don't have any versions yet
    const assignmentsWithoutVersions = await prisma.assignment.findMany({
      where: {
        versions: {
          none: {},
        },
      },
      include: {
        questions: {
          where: { isDeleted: false },
        },
        AssignmentAuthor: true,
      },
    });

    console.log(
      `Found ${assignmentsWithoutVersions.length} assignments without versions`,
    );

    let createdCount = 0;

    for (const assignment of assignmentsWithoutVersions) {
      try {
        await prisma.$transaction(async (tx) => {
          console.log(
            `Creating version 1 for assignment "${assignment.name}" (ID: ${assignment.id})`,
          );

          // Create the initial version (version 1)
          const assignmentVersion = await tx.assignmentVersion.create({
            data: {
              assignmentId: assignment.id,
              versionNumber: "1.0.0",
              name: assignment.name,
              introduction: assignment.introduction,
              instructions: assignment.instructions,
              gradingCriteriaOverview: assignment.gradingCriteriaOverview,
              timeEstimateMinutes: assignment.timeEstimateMinutes,
              type: assignment.type,
              graded: assignment.graded,
              numAttempts: assignment.numAttempts,
              allotedTimeMinutes: assignment.allotedTimeMinutes,
              attemptsPerTimeRange: assignment.attemptsPerTimeRange,
              attemptsTimeRangeHours: assignment.attemptsTimeRangeHours,
              passingGrade: assignment.passingGrade,
              displayOrder: assignment.displayOrder,
              questionDisplay: assignment.questionDisplay,
              numberOfQuestionsPerAttempt:
                assignment.numberOfQuestionsPerAttempt,
              questionOrder: assignment.questionOrder,
              published: assignment.published,
              showAssignmentScore: assignment.showAssignmentScore,
              showQuestionScore: assignment.showQuestionScore,
              showSubmissionFeedback: assignment.showSubmissionFeedback,
              showQuestions: assignment.showQuestions,
              languageCode: assignment.languageCode,
              createdBy: assignment.AssignmentAuthor[0]?.userId || "system",
              isDraft: false, // Existing published assignments become version 1 (non-draft)
              versionDescription:
                "Initial version created from existing assignment",
              isActive: true, // Make this the active version
            },
          });

          // Create question versions for all questions
          for (const [index, question] of assignment.questions.entries()) {
            await tx.questionVersion.create({
              data: {
                assignmentVersionId: assignmentVersion.id,
                questionId: question.id,
                totalPoints: question.totalPoints,
                type: question.type,
                responseType: question.responseType,
                question: question.question,
                maxWords: question.maxWords,
                scoring: question.scoring,
                choices: question.choices,
                randomizedChoices: question.randomizedChoices,
                answer: question.answer,
                gradingContextQuestionIds: question.gradingContextQuestionIds,
                maxCharacters: question.maxCharacters,
                videoPresentationConfig: question.videoPresentationConfig,
                liveRecordingConfig: question.liveRecordingConfig,
                displayOrder: index + 1,
              },
            });
          }

          // Set the assignment's currentVersionId to this new version
          await tx.assignment.update({
            where: { id: assignment.id },
            data: { currentVersionId: assignmentVersion.id },
          });

          // Create version history entry
          await tx.versionHistory.create({
            data: {
              assignmentId: assignment.id,
              toVersionId: assignmentVersion.id,
              action: "initial_version_created",
              description: "Initial version created during migration",
              userId: assignment.AssignmentAuthor[0]?.userId || "system",
            },
          });

          createdCount++;
          console.log(
            `✅ Created version 1 for assignment "${assignment.name}" with ${assignment.questions.length} questions`,
          );
        });
      } catch (error) {
        console.error(
          `❌ Failed to create version for assignment "${assignment.name}" (ID: ${assignment.id}):`,
          error,
        );
      }
    }

    console.log(
      `\n🎉 Successfully created initial versions for ${createdCount} assignments`,
    );

    // Verify the results
    const totalVersions = await prisma.assignmentVersion.count();
    const assignmentsWithVersions = await prisma.assignment.count({
      where: {
        versions: {
          some: {},
        },
      },
    });

    console.log(`\n📊 Summary:`);
    console.log(`- Total assignment versions in database: ${totalVersions}`);
    console.log(`- Assignments with versions: ${assignmentsWithVersions}`);
  } catch (error) {
    console.error("❌ Script failed with error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script if called directly
// eslint-disable-next-line unicorn/prefer-module
if (require.main === module) {
  createInitialVersions()
    .then(() => {
      console.log("✅ Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
}

export { createInitialVersions };
