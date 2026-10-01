/**
 * Copy and status for the screen shown when a learner's results page cannot be
 * loaded.
 *
 * Every failure used to be rendered as "404 — this submission does not belong
 * to your account", which is wrong for an expired session, a server fault, or
 * a session that was replaced when the learner opened another assignment. The
 * mapping lives here so the page renders the status the server actually
 * returned and the learner is told something they can act on.
 */
export type AttemptViewError = {
  statusCode: number;
  headline: string;
  message: string;
  primaryActionHref?: string;
  primaryActionLabel: string;
  userSteps: { title: string; description: string }[];
};

const REOPEN_FROM_COURSE =
  "Reopen this assignment from your course to see your results. Your submission and grade are safe.";

const REOPEN_STEP = {
  title: "Reopen this assignment from your course",
  description:
    "Your course page starts a fresh session for this assignment and takes you to your results.",
};

const ONE_AT_A_TIME_STEP = {
  title: "Open one assignment at a time",
  description:
    "This browser keeps a single assignment session, so opening a second assignment signs this tab out of the first.",
};

export function resolveAttemptViewError(params: {
  status: number;
  routeAssignmentId: number;
  /** Assignment this browser session was last launched for, when known. */
  sessionAssignmentId?: number;
  /** Course URL carried by the session, when the launch supplied one. */
  returnUrl?: string;
}): AttemptViewError {
  const { status, routeAssignmentId, sessionAssignmentId } = params;
  // A launch without a return URL sends an empty string; treat it as absent so
  // the screen hides the action rather than rendering a dead link.
  const returnUrl = params.returnUrl || undefined;

  // The session belongs to a different assignment, so this tab's session was
  // replaced by a later launch. Say that instead of implying the learner is
  // looking at someone else's work — and do not offer a link back into this
  // assignment, which fails for the same reason.
  // A 5xx is the server failing, not the session being wrong: the replaced-
  // session copy would hide an outage behind advice that cannot work.
  const sessionWasReplaced =
    typeof sessionAssignmentId === "number" &&
    sessionAssignmentId !== routeAssignmentId &&
    status < 500;

  if (sessionWasReplaced) {
    return {
      statusCode: status,
      headline: "You opened another assignment",
      message: `Opening another assignment in this browser replaced this tab's session. ${REOPEN_FROM_COURSE}`,
      primaryActionHref: returnUrl,
      primaryActionLabel: "Back to my course",
      userSteps: [REOPEN_STEP, ONE_AT_A_TIME_STEP],
    };
  }

  if (status === 401) {
    return {
      statusCode: 401,
      headline: "Your session has expired",
      message: `Your sign-in is no longer valid. ${REOPEN_FROM_COURSE}`,
      primaryActionHref: returnUrl,
      primaryActionLabel: "Back to my course",
      userSteps: [REOPEN_STEP],
    };
  }

  if (status === 403) {
    return {
      statusCode: 403,
      headline: "Results are not available in this session",
      message: `This session does not have access to this assignment's results. ${REOPEN_FROM_COURSE}`,
      primaryActionHref: returnUrl,
      primaryActionLabel: "Back to my course",
      userSteps: [REOPEN_STEP, ONE_AT_A_TIME_STEP],
    };
  }

  if (status === 404) {
    return {
      statusCode: 404,
      headline: "Attempt not found",
      message:
        "This submission no longer exists or belongs to another account. Open the assignment from your course to view your own attempts.",
      primaryActionHref: `/learner/${routeAssignmentId}`,
      primaryActionLabel: "Go to my assignments",
      userSteps: [
        {
          title: "Open your own submission",
          description:
            "Go to your assignments list and open the attempt you submitted.",
        },
        REOPEN_STEP,
      ],
    };
  }

  return {
    statusCode: status,
    headline: "We could not load your results",
    message:
      "Something went wrong while loading this submission. Your work was saved — try again in a moment.",
    primaryActionHref: `/learner/${routeAssignmentId}`,
    primaryActionLabel: "Try again",
    userSteps: [
      {
        title: "Try again in a moment",
        description:
          "This is a temporary failure on our side; your submission and grade are unaffected.",
      },
      REOPEN_STEP,
    ],
  };
}
