export const ADMIN_EMAILS = // read from environment variable or hardcoded list
  process.env.ADMIN_EMAILS
    ? process.env.ADMIN_EMAILS.split(",").map((email) =>
        email.trim().toLowerCase(),
      )
    : [];

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
