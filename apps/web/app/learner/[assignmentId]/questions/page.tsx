import ErrorPage from "@/components/ErrorPage";
import {
  createAttempt,
  getAttempt,
  getAttempts,
  getUser,
} from "@/lib/talkToBackend";
import QuestionPage from "@learnerComponents/Question";
import { headers } from "next/headers";
import ClientLearnerLayout from "./ClientComponent";

interface Props {
  params: { assignmentId: string };
  searchParams: { authorMode?: string };
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
    (attempt) =>
      attempt.submitted === false &&
      (attempt.expiresAt === null ||
        Date.now() < Date.parse(attempt.expiresAt)),
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

  const attempt = await getAttempt(assignmentId, attemptId, cookieHeader);
  if (!attempt) {
    return <ErrorPage error={"Attempt could not be fetched"} />;
  }

  return (
    role === "learner" && (
      <main className="flex flex-col h-[calc(100vh-100px)]">
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
