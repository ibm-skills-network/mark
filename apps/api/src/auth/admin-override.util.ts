/**
 * True when the session carries a verified admin override grant. The claim is
 * only ever set by the gateway's override-session endpoint after validating an
 * email-verified admin session token, so trusting it here is safe.
 */
export function isAdminOverride(session?: {
  adminOverride?: boolean;
}): boolean {
  return session?.adminOverride === true;
}
