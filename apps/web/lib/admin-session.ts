const ADMIN_SESSION_TOKEN_KEY = "adminSessionToken";
const ADMIN_EMAIL_KEY = "adminEmail";
const ADMIN_EXPIRES_AT_KEY = "adminExpiresAt";

export interface StoredAdminSession {
  sessionToken: string;
  email: string;
  expiresAt: Date;
}

export function readAdminSessionFromStorage(): StoredAdminSession | null {
  if (typeof window === "undefined") return null;

  const sessionToken = localStorage.getItem(ADMIN_SESSION_TOKEN_KEY);
  const email = localStorage.getItem(ADMIN_EMAIL_KEY);
  const expiresAtRaw = localStorage.getItem(ADMIN_EXPIRES_AT_KEY);

  if (!sessionToken || !email || !expiresAtRaw) return null;

  const expiresAt = new Date(expiresAtRaw);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) return null;

  return { sessionToken, email, expiresAt };
}

export function clearAdminSessionStorage(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ADMIN_SESSION_TOKEN_KEY);
  localStorage.removeItem(ADMIN_EMAIL_KEY);
  localStorage.removeItem(ADMIN_EXPIRES_AT_KEY);
}

export function writeAdminSessionToStorage(session: {
  sessionToken: string;
  email: string;
  expiresAt: string;
}): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ADMIN_SESSION_TOKEN_KEY, session.sessionToken);
  localStorage.setItem(ADMIN_EMAIL_KEY, session.email);
  localStorage.setItem(ADMIN_EXPIRES_AT_KEY, session.expiresAt);
}

export function buildAdminLoginRedirect(currentPath: string): string {
  return `/admin?returnTo=${encodeURIComponent(currentPath)}`;
}
