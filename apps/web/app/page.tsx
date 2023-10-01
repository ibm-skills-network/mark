import ErrorPage from "@/components/ErrorPage";
import { getUser } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import { useLearnerStore } from "@/stores/learner";
import { redirect } from "next/navigation";

export default async function Home() {
  const user = await getUser();

  if (user?.role === "author") {
    useAuthorStore.setState({ activeAssignmentId: user.assignmentId });
    redirect(`/author/${user.assignmentId}`);
  } else if (user?.role === "learner") {
    useLearnerStore.setState({ activeAssignmentId: user.assignmentId });
    redirect(`/learner/${user.assignmentId}`);
  } else {
    // show error page
    return <ErrorPage error="User not found" />;
  }
}
