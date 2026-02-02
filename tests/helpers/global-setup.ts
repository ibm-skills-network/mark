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
  const repoRoot = path.resolve(__dirname, "..");
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

  const requestContext = await request.newContext({
    baseURL: apiBaseUrl,
  });

  try {
    const response = await requestContext.post("/api/v1/admin/assignments", {
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
    });

    if (!response.ok()) {
      const body = await response.text();
      throw new Error(
        `Failed to create assignment (${response.status()}): ${body}`,
      );
    }

    const assignment = (await response.json()) as AssignmentCache;
    if (!assignment?.id) {
      throw new Error(
        `Assignment creation response missing id: ${JSON.stringify(assignment)}`,
      );
    }

    process.env.PW_ASSIGNMENT_ID = String(assignment.id);

    const cacheDir = path.resolve(repoRoot, "playwright", ".cache");
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
