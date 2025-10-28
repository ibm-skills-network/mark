"use server";

import animationData from "@/animations/LoadSN.json";
import LoadingPage from "@/app/loading";
import ErrorPage from "@/components/ErrorPage";
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
import { coerceSubmitted } from "@/app/learner/utils/attempts";

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
  const user = await getUser(cookieHeader);
  const role = user?.role;

  if (role === "author" && authorMode === "true") {
    return <ClientLearnerLayout assignmentId={assignmentId} role={role} />;
  }

  const listOfAttempts = await getAttempts(assignmentId, cookieHeader);
  if (!listOfAttempts) {
    return <ErrorPage error={"Attempts could not be fetched"} />;
  }

  const unsubmittedAssignment = listOfAttempts.find(
    (attempt) => !coerceSubmitted(attempt.submitted),
  );
  const attemptId = unsubmittedAssignment
    ? unsubmittedAssignment.id
    : await createAttempt(assignmentId, cookieHeader);

  if (!attemptId && role === "author" && authorMode === undefined) {
    return (
      <ErrorPage
        error={
          "You can't take the assignment as an author, please switch to learner mode or check learner side in the review page to try the assignment"
        }
        statusCode={403}
      />
    );
  } else if (!attemptId) {
    return <ErrorPage error={"Attempt could not be created"} />;
  }

  if (attemptId === "no more attempts") {
    return (
      <ErrorPage
        className="h-[calc(100vh-100px)]"
        statusCode={422}
        error={
          "You have reached the maximum number of attempts for this assignment, if you need more attempts, please contact the author"
        }
      />
    );
  }

  if (attemptId === "in cooldown period") {
    return (
      <ErrorPage
        className="h-[calc(100vh-100px)]"
        statusCode={429}
        error={
          "You need to wait until the cooldown period is complete before being able to retake the assignment. Please wait until this period is complete before reattempting."
        }
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
}: {
  assignmentId: number;
  attemptId: number;
  cookieHeader: string;
  role: string;
  lang?: string;
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
      <main className="flex flex-col h-[calc(100vh-80px)] sm:h-[calc(100vh-100px)] overflow-hidden">
        <QuestionPage
          attempt={attempt}
          assignmentId={assignmentId}
          role={role}
        />
      </main>
    )
  );
}

export default LearnerLayout;
