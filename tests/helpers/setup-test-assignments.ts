#!/usr/bin/env ts-node
import fs from "fs";
import path from "path";
import { request } from "@playwright/test";

type AssignmentCache = {
  id: number;
  name?: string;
  type?: string;
  groupId?: string;
};

type AssignmentsCache = {
  learner: AssignmentCache;
  author: AssignmentCache;
};

const DEFAULT_API_PORT = "4222";
const DEFAULT_ASSIGNMENT_TYPE = "AI_GRADED";
const DEFAULT_ASSIGNMENT_NAME = "Playwright Assignment";
const DEFAULT_GROUP_ID = "pw-group";
const DEFAULT_ADMIN_EMAIL = "admin@example.com";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("export ")) {
      trimmed = trimmed.slice("export ".length).trim();
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (!value) {
      continue;
    }

    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));

    if (!isQuoted) {
      value = value.replace(/\s+#.*$/, "").trim();
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function waitForApiReady(baseUrl: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = new URL("/health/readiness", baseUrl).toString();

  console.log(`Waiting for API at ${healthUrl}...`);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        console.log("✓ API is ready");
        return;
      }
    } catch {
      // Ignore until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for API health at ${healthUrl}`);
}

async function main() {
  const repoRoot = process.cwd();
  loadEnvFile(path.join(repoRoot, "dev.env"));

  const apiPort =
    process.env.API_GATEWAY_PORT || process.env.API_PORT || DEFAULT_API_PORT;
  const apiBaseUrl =
    process.env.PW_API_BASE_URL || `http://localhost:${apiPort}`;
  const groupId = process.env.PW_GROUP_ID || DEFAULT_GROUP_ID;
  const assignmentName =
    process.env.PW_ASSIGNMENT_NAME || DEFAULT_ASSIGNMENT_NAME;
  const assignmentType =
    process.env.PW_ASSIGNMENT_TYPE || DEFAULT_ASSIGNMENT_TYPE;
  const adminEmail = process.env.PW_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;

  await waitForApiReady(apiBaseUrl);

  const cacheDir = path.join(repoRoot, "tests/playwright/.cache");
  const cachePath = path.join(cacheDir, "assignments.json");

  // Check if we have cached assignment IDs
  let cachedAssignments: AssignmentsCache | null = null;
  if (fs.existsSync(cachePath)) {
    try {
      cachedAssignments = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      console.log(`\nFound cached assignments:`);
      console.log(`  Learner: ${cachedAssignments?.learner?.id}`);
      console.log(`  Author: ${cachedAssignments?.author?.id}`);
    } catch {
      // Ignore cache read errors
    }
  }

  const requestContext = await request.newContext({
    baseURL: apiBaseUrl,
  });

  try {
    let learnerAssignment: AssignmentCache | null = null;
    let authorAssignment: AssignmentCache | null = null;

    // Check if cached learner assignment still exists and is published
    if (cachedAssignments?.learner) {
      console.log(
        `\nChecking learner assignment ${cachedAssignments.learner.id}...`,
      );
      const checkResponse = await requestContext.get(
        `/api/v1/admin/assignments/${cachedAssignments.learner.id}`,
        {
          headers: {
            "user-session": JSON.stringify({
              userId: adminEmail,
              role: "admin",
              groupId,
              assignmentId: cachedAssignments.learner.id,
            }),
          },
        },
      );

      if (checkResponse.ok()) {
        const existing = await checkResponse.json();
        if (existing.currentVersion) {
          console.log(
            `✓ Learner assignment ${cachedAssignments.learner.id} is valid (published)`,
          );
          learnerAssignment = cachedAssignments.learner;
        } else {
          console.log(`✗ Learner assignment exists but is not published`);
        }
      } else {
        console.log(
          `✗ Learner assignment ${cachedAssignments.learner.id} not found`,
        );
      }
    }

    // Check if cached author assignment still exists
    if (cachedAssignments?.author) {
      console.log(
        `\nChecking author assignment ${cachedAssignments.author.id}...`,
      );
      const checkResponse = await requestContext.get(
        `/api/v1/admin/assignments/${cachedAssignments.author.id}`,
        {
          headers: {
            "user-session": JSON.stringify({
              userId: adminEmail,
              role: "admin",
              groupId,
              assignmentId: cachedAssignments.author.id,
            }),
          },
        },
      );

      if (checkResponse.ok()) {
        console.log(
          `✓ Author assignment ${cachedAssignments.author.id} is valid`,
        );
        authorAssignment = cachedAssignments.author;
      } else {
        console.log(
          `✗ Author assignment ${cachedAssignments.author.id} not found`,
        );
      }
    }

    // If both assignments exist, we're done
    if (learnerAssignment && authorAssignment) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`All assignments ready!`);
      console.log(`${"=".repeat(60)}\n`);
      printAssignmentInfo(learnerAssignment, authorAssignment);
      return;
    }

    // Create learner assignment if needed (published with content)
    if (!learnerAssignment) {
      console.log("\nCreating learner assignment...");
      const createResponse = await requestContext.post(
        "/api/v1/admin/assignments",
        {
          data: {
            name: `${assignmentName} (Learner)`,
            type: assignmentType,
            groupId,
          },
          headers: {
            "user-session": JSON.stringify({
              userId: adminEmail,
              role: "admin",
              groupId,
              assignmentId: 0,
            }),
          },
        },
      );

      if (!createResponse.ok()) {
        const body = await createResponse.text();
        throw new Error(
          `Failed to create learner assignment (${createResponse.status()}): ${body}`,
        );
      }

      learnerAssignment = (await createResponse.json()) as AssignmentCache;
      if (!learnerAssignment?.id) {
        throw new Error(
          `Learner assignment creation response missing id: ${JSON.stringify(learnerAssignment)}`,
        );
      }

      console.log(
        `✓ Created learner assignment with ID: ${learnerAssignment.id}`,
      );

      // Add content to publish the learner assignment
      console.log(`Publishing learner assignment ${learnerAssignment.id}...`);
      const contentResponse = await requestContext.post(
        `/api/v1/admin/assignments/${learnerAssignment.id}/content`,
        {
          data: {
            assignment: {
              name: `${assignmentName} (Learner)`,
              introduction: "This is a test assignment created by Playwright.",
              instructions:
                "Complete all questions to the best of your ability.",
            },
            config: {
              numAttempts: 3,
              attemptsBeforeCoolDown: 3,
              retakeAttemptCoolDownMinutes: 0,
              passingGrade: 60,
              displayOrder: "DEFINED",
              graded: true,
              questionVariationNumber: 1,
              questionDisplay: "ALL_PER_PAGE",
              showQuestions: true,
              showSubmissionFeedback: true,
              showAssignmentScore: true,
              showQuestionScore: true,
              correctAnswerVisibility: "ALWAYS",
              numberOfQuestionsPerAttempt: null,
              timeEstimateMinutes: 15,
              allotedTimeMinutes: 30,
              attemptsPerTimeRange: null,
              attemptsTimeRangeHours: null,
            },
            feedbackConfig: {
              verbosityLevel: "detailed",
              showSubmissionFeedback: true,
              showQuestionScore: true,
              showAssignmentScore: true,
              showQuestions: true,
            },
            gradingCriteria: "Answers will be graded on correctness.",
            questions: [
              {
                type: "SINGLE_CORRECT",
                question: "What is 2 + 2?",
                responseType: "OTHER",
                totalPoints: 10,
                maxWords: null,
                maxCharacters: null,
                randomizedChoices: false,
                choices: [
                  {
                    id: 1,
                    choice: "3",
                    isCorrect: false,
                    points: 0,
                    feedback: "Incorrect.",
                  },
                  {
                    id: 2,
                    choice: "4",
                    isCorrect: true,
                    points: 10,
                    feedback: "Correct!",
                  },
                  {
                    id: 3,
                    choice: "5",
                    isCorrect: false,
                    points: 0,
                    feedback: "Incorrect.",
                  },
                ],
                scoring: {
                  type: "AUTOMATIC",
                  showSubQuestionsToLearner: false,
                  showPoints: true,
                  showRubricsToLearner: false,
                  rubrics: [],
                },
              },
            ],
          },
          headers: {
            "user-session": JSON.stringify({
              userId: adminEmail,
              role: "admin",
              groupId,
              assignmentId: learnerAssignment.id,
            }),
          },
        },
      );

      if (!contentResponse.ok()) {
        const body = await contentResponse.text();
        throw new Error(
          `Failed to add content to learner assignment (${contentResponse.status()}): ${body}`,
        );
      }

      console.log(`✓ Published learner assignment ${learnerAssignment.id}`);
    }

    // Create author assignment if needed (empty, unpublished)
    if (!authorAssignment) {
      console.log("\nCreating author assignment...");
      const createResponse = await requestContext.post(
        "/api/v1/admin/assignments",
        {
          data: {
            name: `${assignmentName} (Author)`,
            type: assignmentType,
            groupId,
          },
          headers: {
            "user-session": JSON.stringify({
              userId: adminEmail,
              role: "admin",
              groupId,
              assignmentId: 0,
            }),
          },
        },
      );

      if (!createResponse.ok()) {
        const body = await createResponse.text();
        throw new Error(
          `Failed to create author assignment (${createResponse.status()}): ${body}`,
        );
      }

      authorAssignment = (await createResponse.json()) as AssignmentCache;
      if (!authorAssignment?.id) {
        throw new Error(
          `Author assignment creation response missing id: ${JSON.stringify(authorAssignment)}`,
        );
      }

      console.log(
        `✓ Created author assignment with ID: ${authorAssignment.id} (empty)`,
      );
    }

    // Save both assignments to cache
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify(
        {
          learner: {
            id: learnerAssignment.id,
            name: learnerAssignment.name,
            type: learnerAssignment.type,
            groupId,
          },
          author: {
            id: authorAssignment.id,
            name: authorAssignment.name,
            type: authorAssignment.type,
            groupId,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Assignments created and cached!`);
    console.log(`${"=".repeat(60)}\n`);
    printAssignmentInfo(learnerAssignment, authorAssignment);
  } finally {
    await requestContext.dispose();
  }
}

function printAssignmentInfo(
  learnerAssignment: AssignmentCache,
  authorAssignment: AssignmentCache,
) {
  console.log(`📚 LEARNER ASSIGNMENT (Published with content)`);
  console.log(`   ID: ${learnerAssignment.id}`);
  console.log(`   URL: http://localhost:3010/learner/${learnerAssignment.id}`);
  console.log(``);
  console.log(`✏️  AUTHOR ASSIGNMENT (Empty - for authoring tests)`);
  console.log(`   ID: ${authorAssignment.id}`);
  console.log(`   URL: http://localhost:3010/author/${authorAssignment.id}`);
  console.log(``);
  console.log(`📝 NEXT STEPS:`);
  console.log(``);
  console.log(
    `   1. Update the mock guard with the assignment ID you're testing:`,
  );
  console.log(
    `      File: apps/api-gateway/src/auth/jwt/cookie-based/mock.jwt.cookie.auth.guard.ts`,
  );
  console.log(``);
  console.log(`      For LEARNER tests:`);
  console.log(`        role: UserRole.LEARNER,`);
  console.log(`        assignmentId: ${learnerAssignment.id},`);
  console.log(``);
  console.log(`      For AUTHOR tests:`);
  console.log(`        role: UserRole.AUTHOR,`);
  console.log(`        assignmentId: ${authorAssignment.id},`);
  console.log(``);
  console.log(`   2. Start (or restart) your dev server:`);
  console.log(`      yarn dev`);
  console.log(``);
  console.log(`   3. Run your tests:`);
  console.log(`      yarn playwright test`);
  console.log(``);
  console.log(`   Or use codegen:`);
  console.log(
    `      yarn playwright codegen http://localhost:3010/learner/${learnerAssignment.id}`,
  );
  console.log(
    `      yarn playwright codegen http://localhost:3010/author/${authorAssignment.id}`,
  );
  console.log(``);
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((error) => {
  console.error("\n❌ Error:", error.message);
  process.exit(1);
});
