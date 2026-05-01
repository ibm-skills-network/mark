import fs from "node:fs";
import path from "node:path";
import { APIRequestContext, request } from "@playwright/test";

const DEFAULT_API_PORT = "4222";
const DEFAULT_GATEWAY_PORT = "8000";
const DEFAULT_WEB_PORT = "3010";
const DEFAULT_ASSIGNMENT_TYPE = "AI_GRADED";
const DEFAULT_ASSIGNMENT_NAME = "Playwright Assignment";
const DEFAULT_GROUP_ID = "pw-group";
const DEFAULT_ADMIN_EMAIL = "admin@example.com";
const DEFAULT_JWT_SECRET = "devsecret"; // pragma: allowlist secret

export type TestAssignment = {
  id: number;
  name?: string;
  type?: string;
  groupId?: string;
};

export type TestAssignments = {
  learner: TestAssignment;
  author: TestAssignment;
};

export type TestEnvironmentConfig = {
  repoRoot: string;
  markApiBaseUrl: string;
  gatewayBaseUrl: string;
  webBaseUrl: string;
  groupId: string;
  assignmentName: string;
  assignmentType: string;
  adminEmail: string;
  jwtSecret: string;
};

export const PLAYWRIGHT_CACHE_DIR = path.resolve(
  process.cwd(),
  "playwright/.cache",
);
export const PLAYWRIGHT_AUTH_DIR = path.resolve(
  process.cwd(),
  "playwright/.auth",
);
export const ASSIGNMENTS_CACHE_PATH = path.join(
  PLAYWRIGHT_CACHE_DIR,
  "assignments.json",
);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseTestAssignment(
  value: unknown,
  role: "learner" | "author",
): TestAssignment {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid ${role} assignment cache entry.`);
  }

  const assignment = value as Record<string, unknown>;
  if (typeof assignment.id !== "number" || Number.isNaN(assignment.id)) {
    throw new Error(`Missing ${role} assignment id in cache.`);
  }

  return {
    id: assignment.id,
    name: typeof assignment.name === "string" ? assignment.name : undefined,
    type: typeof assignment.type === "string" ? assignment.type : undefined,
    groupId:
      typeof assignment.groupId === "string" ? assignment.groupId : undefined,
  };
}

function parseAssignmentsCache(raw: string): TestAssignments {
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  return {
    learner: parseTestAssignment(parsed.learner, "learner"),
    author: parseTestAssignment(parsed.author, "author"),
  };
}

export function loadEnvFile(filePath: string) {
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
    if (!value || value.startsWith("#")) {
      continue;
    }

    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));

    if (!isQuoted) {
      value = value.replace(/\s+#.*$/, "").trim();
      if (!value || value.startsWith("#")) {
        continue;
      }
    } else {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function loadPlaywrightEnvironment(repoRoot = process.cwd()) {
  loadEnvFile(path.join(repoRoot, "dev.env"));
  loadEnvFile(path.join(repoRoot, "apps/api-gateway/dev.env"));
}

export function ensurePlaywrightDirectories() {
  fs.mkdirSync(PLAYWRIGHT_CACHE_DIR, { recursive: true });
  fs.mkdirSync(PLAYWRIGHT_AUTH_DIR, { recursive: true });
}

export function getTestEnvironmentConfig(
  repoRoot = process.cwd(),
): TestEnvironmentConfig {
  loadPlaywrightEnvironment(repoRoot);

  const apiPort = process.env.API_PORT || DEFAULT_API_PORT;
  const gatewayPort = process.env.API_GATEWAY_PORT || DEFAULT_GATEWAY_PORT;
  const webPort = process.env.PORT || DEFAULT_WEB_PORT;
  const configuredSecret = process.env.SECRET; // pragma: allowlist secret

  return {
    repoRoot,
    markApiBaseUrl:
      process.env.PW_MARK_API_BASE_URL || `http://127.0.0.1:${apiPort}`,
    gatewayBaseUrl:
      process.env.PW_GATEWAY_BASE_URL ||
      process.env.API_GATEWAY_HOST ||
      `http://localhost:${gatewayPort}`,
    webBaseUrl: process.env.PW_WEB_BASE_URL || `http://localhost:${webPort}`,
    groupId: process.env.PW_GROUP_ID || DEFAULT_GROUP_ID,
    assignmentName: process.env.PW_ASSIGNMENT_NAME || DEFAULT_ASSIGNMENT_NAME,
    assignmentType: process.env.PW_ASSIGNMENT_TYPE || DEFAULT_ASSIGNMENT_TYPE,
    adminEmail: process.env.PW_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL,
    jwtSecret:
      isNonEmptyString(configuredSecret) &&
      !configuredSecret.trim().startsWith("#")
        ? configuredSecret.trim()
        : DEFAULT_JWT_SECRET,
  };
}

export function tryReadAssignmentsCache(): TestAssignments | null {
  try {
    return parseAssignmentsCache(
      fs.readFileSync(ASSIGNMENTS_CACHE_PATH, "utf-8"),
    );
  } catch {
    return null;
  }
}

export function readAssignmentsCache(): TestAssignments {
  try {
    return parseAssignmentsCache(
      fs.readFileSync(ASSIGNMENTS_CACHE_PATH, "utf-8"),
    );
  } catch (error) {
    throw new Error(
      `Missing or invalid Playwright assignment cache at ${ASSIGNMENTS_CACHE_PATH}. Run 'yarn test:e2e' or 'yarn test:setup'.`,
      { cause: error },
    );
  }
}

export function writeAssignmentsCache(assignments: TestAssignments) {
  ensurePlaywrightDirectories();
  fs.writeFileSync(
    ASSIGNMENTS_CACHE_PATH,
    JSON.stringify(assignments, null, 2),
    "utf-8",
  );
}

export function getLearnerAssignmentId(
  assignments = readAssignmentsCache(),
): number {
  return assignments.learner.id;
}

export function getAuthorAssignmentId(
  assignments = readAssignmentsCache(),
): number {
  return assignments.author.id;
}

export function getGroupId(): string {
  return getTestEnvironmentConfig().groupId;
}

export async function createApiContext(
  config = getTestEnvironmentConfig(),
): Promise<APIRequestContext> {
  return await request.newContext({
    baseURL: config.markApiBaseUrl,
  });
}

export function createUserSessionHeader(
  role: "admin" | "author" | "learner",
  options?: {
    userId?: string;
    groupId?: string;
    assignmentId?: number;
  },
) {
  const config = getTestEnvironmentConfig();

  return {
    "user-session": JSON.stringify({
      userId: options?.userId || config.adminEmail,
      role,
      groupId: options?.groupId || config.groupId,
      assignmentId: options?.assignmentId ?? 0,
    }),
  };
}

export async function createAssignment(
  requestContext: APIRequestContext,
  data: {
    name: string;
    type: string;
    groupId?: string;
  },
) {
  const groupId = data.groupId || getGroupId();

  const response = await requestContext.post("/api/v1/admin/assignments", {
    data: {
      name: data.name,
      type: data.type,
      groupId,
    },
    headers: createUserSessionHeader("admin", {
      groupId,
      assignmentId: 0,
    }),
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(
      `Failed to create assignment (${response.status()}): ${body}`,
    );
  }

  return (await response.json()) as TestAssignment;
}

export async function addContentToAssignment(
  requestContext: APIRequestContext,
  assignmentId: number,
  content: {
    assignment: {
      name: string;
      introduction: string;
      instructions: string;
    };
    config: Record<string, unknown>;
    feedbackConfig: Record<string, unknown>;
    gradingCriteria: string;
    questions: Array<Record<string, unknown>>;
  },
) {
  const response = await requestContext.post(
    `/api/v1/admin/assignments/${assignmentId}/content`,
    {
      data: content,
      headers: createUserSessionHeader("admin", { assignmentId }),
    },
  );

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(
      `Failed to add content to assignment (${response.status()}): ${body}`,
    );
  }

  return await response.json();
}
