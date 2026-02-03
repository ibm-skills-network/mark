import fs from "fs";
import path from "path";
import { request } from "@playwright/test";

type AssignmentCache = {
  id: number;
  name?: string;
  type?: string;
  groupId?: string;
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
  const healthUrl = new URL("/health", baseUrl).toString();

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for API health at ${healthUrl}`);
}

export default async function globalSetup() {
  const repoRoot = path.resolve(__dirname, "../..");
  loadEnvFile(path.join(repoRoot, "dev.env"));

  const apiPort = process.env.API_PORT || DEFAULT_API_PORT;
  const apiBaseUrl =
    process.env.PW_API_BASE_URL || `http://localhost:${apiPort}`;
  const groupId = process.env.PW_GROUP_ID || DEFAULT_GROUP_ID;
  const assignmentName =
    process.env.PW_ASSIGNMENT_NAME || DEFAULT_ASSIGNMENT_NAME;
  const assignmentType =
    process.env.PW_ASSIGNMENT_TYPE || DEFAULT_ASSIGNMENT_TYPE;
  const adminEmail = process.env.PW_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;

  await waitForApiReady(apiBaseUrl);

  const cacheDir = path.resolve(__dirname, "../playwright/.cache");
  const cachePath = path.join(cacheDir, "assignment.json");

  // Check if we have a cached assignment ID
  let existingAssignmentId: number | null = null;
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      existingAssignmentId = cached.id;
      console.log(`Found cached assignment ID: ${existingAssignmentId}`);
    } catch {
      // Ignore cache read errors
    }
  }

  const requestContext = await request.newContext({
    baseURL: apiBaseUrl,
  });

  try {
    // Check if cached assignment still exists and is published
    if (existingAssignmentId) {
      const checkResponse = await requestContext.get(
        `/api/v1/admin/assignments/${existingAssignmentId}`,
        {
          headers: {
            "user-session": JSON.stringify({
              userId: adminEmail,
              role: "admin",
              groupId,
              assignmentId: existingAssignmentId,
            }),
          },
        },
      );

      if (checkResponse.ok()) {
        const existingAssignment = await checkResponse.json();
        // Check if it has a published version
        if (existingAssignment.currentVersion) {
          console.log(
            `Reusing existing published assignment ${existingAssignmentId}`,
          );
          process.env.PW_ASSIGNMENT_ID = String(existingAssignmentId);
          return; // Exit early, reuse existing assignment
        } else {
          console.log(
            `Assignment ${existingAssignmentId} exists but is not published, will recreate`,
          );
        }
      } else {
        console.log(
          `Cached assignment ${existingAssignmentId} no longer exists, will create new one`,
        );
      }
    }

    // Step 1: Create empty assignment
    const createResponse = await requestContext.post(
      "/api/v1/admin/assignments",
      {
        data: {
          name: assignmentName,
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
        `Failed to create assignment (${createResponse.status()}): ${body}`,
      );
    }

    const assignment = (await createResponse.json()) as AssignmentCache;
    if (!assignment?.id) {
      throw new Error(
        `Assignment creation response missing id: ${JSON.stringify(assignment)}`,
      );
    }

    console.log(`Created assignment with ID: ${assignment.id}`);

    // Step 2: Add content to publish the assignment
    const contentResponse = await requestContext.post(
      `/api/v1/admin/assignments/${assignment.id}/content`,
      {
        data: {
          assignment: {
            name: assignmentName,
            introduction: "This is a test assignment created by Playwright.",
            instructions: "Complete all questions to the best of your ability.",
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
            assignmentId: assignment.id,
          }),
        },
      },
    );

    if (!contentResponse.ok()) {
      const body = await contentResponse.text();
      throw new Error(
        `Failed to add content to assignment (${contentResponse.status()}): ${body}`,
      );
    }

    console.log(`Published assignment ${assignment.id} with content`);

    process.env.PW_ASSIGNMENT_ID = String(assignment.id);

    const cacheDir = path.resolve(__dirname, "../playwright/.cache");
    const cachePath = path.join(cacheDir, "assignment.json");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify(
        {
          id: assignment.id,
          name: assignment.name,
          type: assignment.type,
          groupId,
        },
        null,
        2,
      ),
      "utf-8",
    );
  } finally {
    await requestContext.dispose();
  }
}
