"use server";

import animationData from "@/animations/LoadSN.json";
import LoadingPage from "@/app/loading";
import ErrorModal from "@/components/ErrorModal";
import ServiceUnavailableNotice from "@/components/ServiceUnavailableNotice";
import { ErrorScreen, statusFromError } from "@/lib/error-screen";
import {
  createAttempt,
  getAttempt,
  getAttempts,
  getUser,
} from "@/lib/talkToBackend";
import QuestionPage from "@learnerComponents/Question";
import { headers } from "next/headers";
import { Suspense } from "react";
import ClientLearnerLayout from "./ClientComponent";
import {
  getLatestAttempt,
  isAttemptInProgress,
  isAttemptSubmitted,
} from "@/app/learner/utils/attempts";

interface Props {
  params: { assignmentId: string };
  searchParams: { authorMode?: string; lang?: string };
}

/**
 * Attempt-creation rejections that render the standard explanatory modal,
 * keyed by the sentinel string createAttempt resolves the API error to.
 */
const attemptRejectionModals: Record<
  string,
  {
    logStep: string;
    statusCode: number;
    headline: string;
    error: string;
    userSteps: { title: string; description: string }[];
  }
> = {
  "no more attempts": {
    logStep: "No more attempts",
    statusCode: 422,
    headline: "No more attempts available",
    error:
      "You have reached the maximum number of attempts for this assignment, if you need more attempts, please contact the author",
    userSteps: [
      {
        title: "Contact your instructor",
        description: "Ask for an additional attempt if needed.",
      },
      {
        title: "Return to course",
        description: "Go back to the course home.",
      },
    ],
  },
  "time range exceeded": {
    logStep: "Time-range attempt limit reached",
    statusCode: 422,
    headline: "Attempt limit reached for this period",
    error:
      "You have exceeded the allowed number of attempts for this assignment within the allowed time period. Please wait before trying again.",
    userSteps: [
      {
        title: "Wait before retrying",
        description:
          "The assignment limits how many attempts can be made in a given period.",
      },
      {
        title: "Return to course",
        description: "Go back to the course home.",
      },
    ],
  },
  "in cooldown period": {
    logStep: "Attempt in cooldown",
    statusCode: 429,
    headline: "Cooldown in effect",
    error:
      "You need to wait until the cooldown period is complete before being able to retake the assignment. Please wait until this period is complete before reattempting.",
    userSteps: [
      {
        title: "Wait for the cooldown",
        description: "Try again after the cooldown ends.",
      },
      {
        title: "Return to course",
        description: "Head back to the assignment list.",
      },
    ],
  },
  "attempt in progress": {
    logStep: "Attempt in progress but could not be resumed",
    statusCode: 422,
    headline: "An attempt is already in progress",
    error:
      "You already have an attempt in progress for this assignment, but it couldn't be loaded automatically. Reload the page to resume it.",
    userSteps: [
      {
        title: "Reload this page",
        description: "Your in-progress attempt should resume.",
      },
      {
        title: "Return to course",
        description: "Go back to the course home and reopen the assignment.",
      },
    ],
  },
};

async function LearnerLayout(props: Props) {
  const { params, searchParams } = props;
  const { authorMode } = searchParams;
  const assignmentId = Math.trunc(Number(params.assignmentId));
  const headerList = await headers();
  const cookieHeader = headerList.get("cookie") || "";
  const stateTimeline: { step: string; detail?: string; timestamp?: string }[] =
    [];
  const log = (step: string, detail?: string) => {
    stateTimeline.push({
      step,
      detail,
      timestamp: new Date().toISOString(),
    });
  };

  log("Load learner layout", `Assignment ${assignmentId}`);

  let user = null;
  try {
    user = await getUser(cookieHeader);
    log("User fetched", `Role: ${user?.role ?? "unknown"}`);
  } catch (error) {
    const status = statusFromError(error);
    log(
      "User fetch failed",
      status === 401 ? "Unauthorized" : `Status ${status}`,
    );
    return <ErrorScreen status={status} />;
  }

  const role = user?.role;

  if (role === "author" && authorMode === "true") {
    return <ClientLearnerLayout assignmentId={assignmentId} role={role} />;
  }

  let listOfAttempts;
  try {
    listOfAttempts = await getAttempts(assignmentId, cookieHeader, {
      throwOnAuthError: true,
    });
  } catch (error) {
    // An expired session or revoked access is the learner's situation, not a
    // server fault — route it to the matching screen instead of a 500 modal.
    const status = statusFromError(error);
    log("Attempts fetch unauthorized", `Status ${status}`);
    return <ErrorScreen status={status} />;
  }
  if (!listOfAttempts) {
    log("Attempts fetch failed");
    return (
      <ErrorModal error={"Attempts could not be fetched"} statusCode={500} />
    );
  }

  const inProgressAttempts = listOfAttempts.filter(isAttemptInProgress);
  const latestInProgressAttempt = getLatestAttempt(inProgressAttempts);

  // Flipped to false on every path that resumes an existing attempt:
  // QuestionPage wipes the assignment's draft-answer localStorage for new
  // attempts, and a resumed attempt must keep the learner's drafts.
  let isNewAttempt = !latestInProgressAttempt;

  let attemptId: Awaited<ReturnType<typeof createAttempt>> =
    latestInProgressAttempt?.id;

  if (attemptId === undefined) {
    const created = await createAttempt(assignmentId, cookieHeader);
    if (created === "attempt in progress") {
      // A concurrent render of this page created the attempt between our
      // getAttempts and createAttempt calls. Re-list and resume that attempt
      // instead of showing a lockout — it is this learner's own usable attempt.
      // The server just vouched an attempt is active, so when the client-clock
      // in-progress filter disagrees (clock skew), fall back to the latest
      // unsubmitted attempt rather than dead-ending.
      const refreshedAttempts = await getAttempts(assignmentId, cookieHeader);
      const resumableAttempt = refreshedAttempts
        ? (getLatestAttempt(refreshedAttempts.filter(isAttemptInProgress)) ??
          getLatestAttempt(
            refreshedAttempts.filter((attempt) => !isAttemptSubmitted(attempt)),
          ))
        : undefined;
      if (resumableAttempt) {
        attemptId = resumableAttempt.id;
        isNewAttempt = false;
        log(
          "Resumed attempt after concurrent creation",
          `Attempt ${resumableAttempt.id}`,
        );
      } else {
        // Keep the sentinel: the rejection modal below explains the state
        // instead of a generic 500.
        attemptId = created;
        log("Resume after concurrent creation failed", "No resumable attempt");
      }
    } else {
      attemptId = created;
      if (
        typeof created === "number" &&
        listOfAttempts.some((attempt) => attempt.id === created)
      ) {
        // The server resumed an existing attempt (its clock still considers
        // it active even though ours does not) rather than creating one.
        isNewAttempt = false;
      }
    }
  }

  log(
    "Attempt resolved",
    latestInProgressAttempt
      ? `Reusing attempt ${latestInProgressAttempt.id}`
      : `Created attempt ${attemptId}`,
  );

  if (!attemptId && role === "author" && authorMode === undefined) {
    log("Author attempt disallowed");
    return (
      <ErrorModal
        error={
          "You can't take the assignment as an author, please switch to learner mode or check learner side in the review page to try the assignment"
        }
        statusCode={403}
        stateTimeline={stateTimeline}
      />
    );
  } else if (!attemptId) {
    log("Attempt creation failed");
    return (
      <ErrorModal
        error={"Attempt could not be created"}
        statusCode={500}
        stateTimeline={stateTimeline}
      />
    );
  }

  if (attemptId === "ai temporarily unavailable") {
    log("AI grading temporarily disabled");
    return (
      <ServiceUnavailableNotice message="This assignment is graded with AI, which is paused for maintenance right now. Your work hasn't been started or lost." />
    );
  }

  if (typeof attemptId === "string") {
    const rejection = attemptRejectionModals[attemptId];
    if (!rejection) {
      log("Unhandled attempt state", attemptId);
      return (
        <ErrorModal
          error={"Attempt could not be created"}
          statusCode={500}
          stateTimeline={stateTimeline}
        />
      );
    }
    log(rejection.logStep);
    return (
      <ErrorModal
        className="h-[calc(100vh-100px)]"
        statusCode={rejection.statusCode}
        error={rejection.error}
        headline={rejection.headline}
        userSteps={rejection.userSteps}
        stateTimeline={stateTimeline}
      />
    );
  }

  return (
    <Suspense fallback={<LoadingPage animationData={animationData} />}>
      <AttemptLoader
        assignmentId={assignmentId}
        attemptId={attemptId}
        cookieHeader={cookieHeader}
        role={role}
        lang={searchParams.lang}
        isNewAttempt={isNewAttempt}
      />
    </Suspense>
  );
}

async function AttemptLoader({
  assignmentId,
  attemptId,
  cookieHeader,
  role,
  lang,
  isNewAttempt,
}: {
  assignmentId: number;
  attemptId: number;
  cookieHeader: string;
  role: string;
  lang?: string;
  isNewAttempt: boolean;
}) {
  let attempt;
  try {
    attempt = await getAttempt(
      Number(assignmentId),
      Number(attemptId),
      cookieHeader,
      lang,
      { throwOnAuthError: true },
    );
  } catch (error) {
    return <ErrorScreen status={statusFromError(error)} />;
  }
  if (!attempt) {
    // Transient failures were already retried inside getAttempt and auth
    // failures threw above, so this is a genuine repeated failure. Render a
    // contained error instead of throwing to Next's error boundary (which
    // would show the generic app crash page).
    return (
      <ErrorModal error={"Attempt could not be fetched"} statusCode={500} />
    );
  }

  return (
    role === "learner" && (
      <main
        id="exam-root"
        className="flex flex-col h-[calc(100vh-80px)] sm:h-[calc(100vh-100px)] overflow-hidden"
      >
        <QuestionPage
          attempt={attempt}
          assignmentId={assignmentId}
          role={role}
          isNewAttempt={isNewAttempt}
        />
      </main>
    )
  );
}

export default LearnerLayout;
