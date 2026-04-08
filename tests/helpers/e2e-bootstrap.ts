import fs from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";
import {
  addContentToAssignment,
  ASSIGNMENTS_CACHE_PATH,
  createApiContext,
  createAssignment,
  createUserSessionHeader,
  ensurePlaywrightDirectories,
  getTestEnvironmentConfig,
  PLAYWRIGHT_AUTH_DIR,
  type TestAssignment,
  type TestAssignments,
  type TestEnvironmentConfig,
  tryReadAssignmentsCache,
  writeAssignmentsCache,
} from "./assignment-helpers";

type TestRole = "author" | "learner";

type JwtPayload = {
  userID: string;
  role: TestRole;
  assignmentID: number;
  groupID: string;
  gradingCallbackRequired: false;
  returnUrl: string;
  launch_presentation_locale: string;
  iat: number;
  exp: number;
};

const DEFAULT_RETURN_URL = "https://skills.network";
const DEFAULT_LOCALE = "en";

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function createSignedJwtToken(
  role: TestRole,
  assignmentId: number,
  config: TestEnvironmentConfig,
) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 6 * 60 * 60;
  const payload: JwtPayload = {
    userID: `${role}@example.com`,
    role,
    assignmentID: assignmentId,
    groupID: config.groupId,
    gradingCallbackRequired: false,
    returnUrl: DEFAULT_RETURN_URL,
    launch_presentation_locale: DEFAULT_LOCALE,
    iat: issuedAt,
    exp: expiresAt,
  };

  const encodedHeader = base64UrlEncode(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  );
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", config.jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return {
    token: `${encodedHeader}.${encodedPayload}.${signature}`,
    expiresAt,
  };
}

function getStorageStatePath(role: TestRole) {
  return path.join(PLAYWRIGHT_AUTH_DIR, `${role}.json`);
}

function buildStorageState(
  role: TestRole,
  assignmentId: number,
  config: TestEnvironmentConfig,
) {
  const { token, expiresAt } = createSignedJwtToken(role, assignmentId, config);
  const { hostname } = new URL(config.webBaseUrl);

  return {
    cookies: [
      {
        name: "authentication",
        value: token,
        domain: hostname,
        path: "/",
        expires: expiresAt,
        httpOnly: false,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };
}

function normalizeAssignment(
  assignment: TestAssignment,
  config: TestEnvironmentConfig,
): TestAssignment {
  return {
    id: assignment.id,
    name: assignment.name,
    type: assignment.type,
    groupId: assignment.groupId || config.groupId,
  };
}

async function validateLearnerAssignment(
  assignment: TestAssignment | undefined,
  config: TestEnvironmentConfig,
) {
  if (!assignment || assignment.groupId !== config.groupId) {
    return null;
  }

  const requestContext = await createApiContext(config);
  try {
    const response = await requestContext.get(
      `/api/v1/admin/assignments/${assignment.id}`,
      {
        headers: createUserSessionHeader("admin", {
          userId: config.adminEmail,
          groupId: config.groupId,
          assignmentId: assignment.id,
        }),
      },
    );

    if (!response.ok()) {
      return null;
    }

    const body = (await response.json()) as { currentVersion?: unknown };
    return body.currentVersion ? assignment : null;
  } finally {
    await requestContext.dispose();
  }
}

async function validateAuthorAssignment(
  assignment: TestAssignment | undefined,
  config: TestEnvironmentConfig,
) {
  if (!assignment || assignment.groupId !== config.groupId) {
    return null;
  }

  const requestContext = await createApiContext(config);
  try {
    const response = await requestContext.get(
      `/api/v1/admin/assignments/${assignment.id}`,
      {
        headers: createUserSessionHeader("admin", {
          userId: config.adminEmail,
          groupId: config.groupId,
          assignmentId: assignment.id,
        }),
      },
    );

    return response.ok() ? assignment : null;
  } finally {
    await requestContext.dispose();
  }
}

async function createLearnerAssignment(config: TestEnvironmentConfig) {
  const requestContext = await createApiContext(config);
  try {
    const learnerAssignment = await createAssignment(requestContext, {
      name: `${config.assignmentName} (Learner)`,
      type: config.assignmentType,
      groupId: config.groupId,
    });

    await addContentToAssignment(requestContext, learnerAssignment.id, {
      assignment: {
        name: `${config.assignmentName} (Learner)`,
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
    });

    return normalizeAssignment(learnerAssignment, config);
  } finally {
    await requestContext.dispose();
  }
}

async function createAuthorAssignment(config: TestEnvironmentConfig) {
  const requestContext = await createApiContext(config);
  try {
    const authorAssignment = await createAssignment(requestContext, {
      name: `${config.assignmentName} (Author)`,
      type: config.assignmentType,
      groupId: config.groupId,
    });

    return normalizeAssignment(authorAssignment, config);
  } finally {
    await requestContext.dispose();
  }
}

export async function ensureTestAssignments(
  config = getTestEnvironmentConfig(),
) {
  const cachedAssignments = tryReadAssignmentsCache();
  let learnerAssignment = await validateLearnerAssignment(
    cachedAssignments?.learner,
    config,
  );
  let authorAssignment = await validateAuthorAssignment(
    cachedAssignments?.author,
    config,
  );

  if (!learnerAssignment) {
    console.log("Creating learner assignment...");
    learnerAssignment = await createLearnerAssignment(config);
  }

  if (!authorAssignment) {
    console.log("Creating author assignment...");
    authorAssignment = await createAuthorAssignment(config);
  }

  const assignments: TestAssignments = {
    learner: learnerAssignment,
    author: authorAssignment,
  };

  writeAssignmentsCache(assignments);
  return assignments;
}

export function writeAuthStorageStates(
  assignments: TestAssignments,
  config = getTestEnvironmentConfig(),
) {
  ensurePlaywrightDirectories();

  fs.writeFileSync(
    getStorageStatePath("learner"),
    JSON.stringify(
      buildStorageState("learner", assignments.learner.id, config),
      null,
      2,
    ),
    "utf-8",
  );

  fs.writeFileSync(
    getStorageStatePath("author"),
    JSON.stringify(
      buildStorageState("author", assignments.author.id, config),
      null,
      2,
    ),
    "utf-8",
  );
}

function printSummary(
  assignments: TestAssignments,
  config: TestEnvironmentConfig,
) {
  console.log(`\n${"=".repeat(60)}`);
  console.log("Playwright E2E state is ready");
  console.log(`${"=".repeat(60)}\n`);
  console.log(`Learner assignment: ${assignments.learner.id}`);
  console.log(`  ${config.webBaseUrl}/learner/${assignments.learner.id}`);
  console.log(`Author assignment: ${assignments.author.id}`);
  console.log(`  ${config.webBaseUrl}/author/${assignments.author.id}`);
  console.log(`Cache: ${ASSIGNMENTS_CACHE_PATH}`);
  console.log(`Auth states:`);
  console.log(`  ${getStorageStatePath("learner")}`);
  console.log(`  ${getStorageStatePath("author")}`);
  console.log(`\nRun the local suite with: yarn test:e2e`);
  console.log(`Run the full matrix with: yarn test:e2e:all\n`);
}

export async function bootstrapPlaywrightState() {
  const config = getTestEnvironmentConfig();
  const assignments = await ensureTestAssignments(config);
  writeAuthStorageStates(assignments, config);
  printSummary(assignments, config);

  return assignments;
}
