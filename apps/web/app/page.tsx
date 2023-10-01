import ErrorPage from "@/components/ErrorPage";
import { getUser } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import { useLearnerStore } from "@/stores/learner";
// import { useRouter } from "next/navigation";
import { redirect } from "next/navigation";

export default async function Home() {
  // const router = useRouter();

  // const setAuthorActiveAssignmentId = useAuthorStore(
  //   (state) => state.setActiveAssignmentId
  // );

  // const setLearnerActiveAssignmentId = useLearnerStore(
  //   (state) => state.setActiveAssignmentId
  // );
  const user = await getUser();
  if (user?.role === "author") {
    useAuthorStore.setState({ activeAssignmentId: user.assignmentId });
    redirect(`/author/${user.assignmentId}`);
  } else if (user?.role === "learne") {
    useLearnerStore.setState({ activeAssignmentId: user.assignmentId });
    redirect(`/learner/${user.assignmentId}`);
  } else {
    // show error page
    return <ErrorPage error="User not found" />;
  }
}
