import { Page, test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/**
 * Get the current test role from environment variable
 * Set this in your shell or .env file to skip mismatched tests
 *
 * Example: TEST_ROLE=learner yarn playwright test
 */
export function getCurrentTestRole(): "learner" | "author" | null {
  const role = process.env.TEST_ROLE?.toLowerCase();
  if (role === "learner" || role === "author") {
    return role;
  }
  return null;
}

/**
 * Load cached assignment IDs from the test setup
 */
function loadCachedAssignments(): { learner: number; author: number } | null {
  try {
    const cachePath = path.join(
      process.cwd(),
      "tests/playwright/.cache/assignments.json",
    );
    if (fs.existsSync(cachePath)) {
      const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      return {
        learner: cache.learner?.id,
        author: cache.author?.id,
      };
    }
  } catch (error) {
    console.warn("Failed to load cached assignments", error);
  }
  return null;
}

/**
 * Set authentication cookie for the given role
 * This automatically uses the correct assignmentId from the cache
 *
 * Usage in tests:
 *   await setAuthCookie(page, "learner");
 *   await setAuthCookie(page, "author");
 */
export async function setAuthCookie(
  page: Page,
  role: "learner" | "author",
  options?: { userId?: string; groupId?: string },
): Promise<void> {
  const cached = loadCachedAssignments();
  const assignmentId = cached?.[role] || 2324;

  const userSession = {
    userId: options?.userId || "user@email.com",
    role: role === "author" ? "author" : "learner",
    groupId: options?.groupId || "pw-group",
    assignmentId,
    gradingCallbackRequired: false,
    returnUrl: "https://skills.network",
    launch_presentation_locale: "en",
  };

  // Set the authentication cookie with the user session
  await page.context().addCookies([
    {
      name: "authentication",
      value: JSON.stringify(userSession),
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

/**
 * Skip this test if the current role doesn't match
 *
 * Usage:
 *   skipIfNotRole("learner"); // in learner tests
 *   skipIfNotRole("author");  // in author tests
 */
export function skipIfNotRole(requiredRole: "learner" | "author") {
  const currentRole = getCurrentTestRole();
  if (currentRole && currentRole !== requiredRole) {
    test.skip();
  }
}

/**
 * Create a test.describe that automatically skips if role doesn't match
 *
 * Usage:
 *   describeForRole("learner", "Learner - Assignment Flow", () => {
 *     test("should view assignment", async ({ page }) => { ... });
 *   });
 */
export function describeForRole(
  role: "learner" | "author",
  title: string,
  fn: () => void,
) {
  test.describe(title, () => {
    test.beforeEach(() => {
      skipIfNotRole(role);
    });
    fn();
  });
}
