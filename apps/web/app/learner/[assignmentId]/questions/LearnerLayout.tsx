"use server";

import animationData from "@/animations/LoadSN.json";
import LoadingPage from "@/app/loading";
import ErrorModal from "@/components/ErrorModal";
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
} from "@/app/learner/utils/attempts";

interface Props {
  params: { assignmentId: string };
  searchParams: { authorMode?: string; lang?: string };
}

async function LearnerLayout(props: Props) {
  const { params, searchParams } = props;
  const { authorMode } = searchParams;
  const assignmentId = ~~params.assignmentId;
  const headerList = headers();
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
  } catch {
    log("User fetch failed", "Unauthorized");
    return (
      <ErrorModal
        statusCode={401}
        error={
          "Oopsies! It looks like you tried to launch this assignment incorrectly. Please open the assignment from your LMS (Coursera, OpenEdx, Author Workbench, or yourLearning). If the problem keeps happening, use the chatbot to open a support ticket."
        }
        headline="Authentication required"
        userSteps={[
          {
            title: "Open the assignment from your LMS",
            description:
              "Launch from Coursera, OpenEdx, Author Workbench, or yourLearning.",
            cta: "Return to course",
          },
          {
            title: "Refresh and sign in again",
            description: "Your session may have expired. Sign in and retry.",
          },
        ]}
        stateTimeline={stateTimeline}
      />
    );
  }

  const role = user?.role;

  if (role === "author" && authorMode === "true") {
    return <ClientLearnerLayout assignmentId={assignmentId} role={role} />;
  }

  const listOfAttempts = await getAttempts(assignmentId, cookieHeader);
  if (!listOfAttempts) {
    log("Attempts fetch failed");
    return (
      <ErrorModal error={"Attempts could not be fetched"} statusCode={500} />
    );
  }

  const inProgressAttempts = listOfAttempts.filter(isAttemptInProgress);
  const latestInProgressAttempt = getLatestAttempt(inProgressAttempts);

  const isNewAttempt = !latestInProgressAttempt;

  const attemptId = latestInProgressAttempt
    ? latestInProgressAttempt.id
    : await createAttempt(assignmentId, cookieHeader);

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

  if (attemptId === "no more attempts") {
    log("No more attempts");
    return (
      <ErrorModal
        className="h-[calc(100vh-100px)]"
        statusCode={422}
        error={
          "You have reached the maximum number of attempts for this assignment, if you need more attempts, please contact the author"
        }
        headline="No more attempts available"
        userSteps={[
          {
            title: "Contact your instructor",
            description: "Ask for an additional attempt if needed.",
          },
          {
            title: "Return to course",
            description: "Go back to the course home.",
          },
        ]}
        stateTimeline={stateTimeline}
      />
    );
  }

  if (attemptId === "in cooldown period") {
    log("Attempt in cooldown");
    return (
      <ErrorModal
        className="h-[calc(100vh-100px)]"
        statusCode={429}
        error={
          "You need to wait until the cooldown period is complete before being able to retake the assignment. Please wait until this period is complete before reattempting."
        }
        headline="Cooldown in effect"
        userSteps={[
          {
            title: "Wait for the cooldown",
            description: "Try again after the cooldown ends.",
          },
          {
            title: "Return to course",
            description: "Head back to the assignment list.",
          },
        ]}
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
  const attempt = await getAttempt(
    Number(assignmentId),
    Number(attemptId),
    cookieHeader,
    lang,
  );
  if (!attempt) {
    throw new Error("Attempt could not be fetched.");
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
