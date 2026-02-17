import fs from "fs";
import path from "path";
import { request, APIRequestContext } from "@playwright/test";

const DEFAULT_ASSIGNMENT_ID = 1;
const DEFAULT_API_PORT = "4222";
const DEFAULT_GROUP_ID = "pw-group";
const DEFAULT_ADMIN_EMAIL = "admin@example.com";

const CACHE_PATH = path.resolve(
  __dirname,
  "../playwright/.cache/assignments.json",
);

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

/**
 * Get the learner assignment ID (published with content)
 */
export function getLearnerAssignmentId(): number {
  const envValue = process.env.PW_LEARNER_ASSIGNMENT_ID;
  if (envValue) {
    const parsed = Number(envValue);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    const data = JSON.parse(raw) as AssignmentsCache;
    if (
      typeof data.learner?.id === "number" &&
      !Number.isNaN(data.learner.id)
    ) {
      return data.learner.id;
    }
  } catch {
    // Ignore cache read errors and fall back to default.
  }

  return DEFAULT_ASSIGNMENT_ID;
}

/**
 * Get the author assignment ID (empty, for testing authoring workflow)
 */
export function getAuthorAssignmentId(): number {
  const envValue = process.env.PW_AUTHOR_ASSIGNMENT_ID;
  if (envValue) {
    const parsed = Number(envValue);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    const data = JSON.parse(raw) as AssignmentsCache;
    if (typeof data.author?.id === "number" && !Number.isNaN(data.author.id)) {
      return data.author.id;
    }
  } catch {
    // Ignore cache read errors and fall back to default.
  }

  return DEFAULT_ASSIGNMENT_ID;
}

/**
 * @deprecated Use getLearnerAssignmentId() or getAuthorAssignmentId() instead
 */
export function getAssignmentId(): number {
  return getLearnerAssignmentId();
}

export function getAssignmentCache(): AssignmentsCache | null {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    return JSON.parse(raw) as AssignmentsCache;
  } catch {
    return null;
  }
}

export function getGroupId(): string {
  return process.env.PW_GROUP_ID || DEFAULT_GROUP_ID;
}

export async function createApiContext(): Promise<APIRequestContext> {
  const apiPort = process.env.API_PORT || DEFAULT_API_PORT;
  const apiBaseUrl =
    process.env.PW_API_BASE_URL || `http://localhost:${apiPort}`;

  return await request.newContext({
    baseURL: apiBaseUrl,
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
  const groupId = options?.groupId || getGroupId();
  const assignmentId = options?.assignmentId || getLearnerAssignmentId();
  const userId = options?.userId || DEFAULT_ADMIN_EMAIL;

  return {
    "user-session": JSON.stringify({
      userId,
      role,
      groupId,
      assignmentId,
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
    headers: createUserSessionHeader("admin", { groupId }),
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(
      `Failed to create assignment (${response.status()}): ${body}`,
    );
  }

  return (await response.json()) as AssignmentCache;
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
