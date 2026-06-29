/**
 * True when the session carries a verified admin override grant. The claim is
 * only ever set by the gateway's override-session endpoint after validating an
 * email-verified admin session token, so trusting it here is safe.
 *
 * IMPORTANT — trust boundary: `adminOverride` is trusted from the
 * gateway-signed session cookie. The api MUST remain reachable only via the
 * gateway (mesh mTLS / network policy). A forged `user-session` header
 * carrying `adminOverride: true` would bypass all five access guards that
 * call this function. Ensure network policy blocks direct api access.
 */
export function isAdminOverride(session?: {
  adminOverride?: boolean;
}): boolean {
  return session?.adminOverride === true;
}
