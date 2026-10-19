// yourLearning courses run on this Open edX host (and its subdomains).
const YOUR_LEARNING_HOST = "yl.skillsnetwork.site";

/**
 * Whether the session's lmsHost is yourLearning. lmsHost is derived on the
 * server from the session's grade-callback URL, never from anything in the
 * page URL.
 */
export function isYourLearningHost(host: string | undefined): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase();
  return (
    normalized === YOUR_LEARNING_HOST ||
    normalized.endsWith(`.${YOUR_LEARNING_HOST}`)
  );
}
