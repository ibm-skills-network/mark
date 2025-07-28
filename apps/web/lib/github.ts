/**
 * GitHub integration API functions
 */
import { API_VERSIONS, getBaseApiPath } from "@/config/constants";
import { toast } from "sonner";

/**
 * Authorizes GitHub integration via backend
 */
export async function authorizeGithubBackend(
  assignmentId: number,
  redirectUrl: string,
  cookies?: string,
): Promise<{ url: string } | undefined> {
  try {
    const res = await fetch(
      `${getBaseApiPath(API_VERSIONS.V1)}/github/oauth-url`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
        body: JSON.stringify({ assignmentId, redirectUrl }),
      },
    );

    if (!res.ok) {
      throw new Error("Failed to fetch OAuth URL");
    }

    return (await res.json()) as { url: string };
  } catch (error: unknown) {
    if (error instanceof Error) {
      toast.error(error.message);
    } else {
      toast.error("Failed to fetch OAuth URL");
    }
  }
}

/**
 * Fetches a stored GitHub token for the current user from the backend.
 *
 * @param cookies Optional cookies for server-side calls.
 * @returns The GitHub token if found, or null if not found or expired.
 */
export async function getStoredGithubToken(
  cookies?: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${getBaseApiPath(API_VERSIONS.V1)}/github/github_token`,
      {
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
      },
    );

    if (!res.ok) {
      return null;
    }

    const token = await res.text();

    if (!token || !token.trim()) {
      return null;
    }

    return token;
  } catch (err) {
    return null;
  }
}

/**
 * Exchanges GitHub code for token
 */
export async function exchangeGithubCodeForToken(
  code: string,
  cookies?: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${getBaseApiPath(API_VERSIONS.V1)}/github/oauth-callback`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
        },
        body: JSON.stringify({ code }),
      },
    );

    const data = ((await res.json()) as { token: string }) || null;
    return data?.token || null;
  } catch (error) {
    return null;
  }
}
