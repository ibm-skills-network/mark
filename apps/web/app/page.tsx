import ErrorPage from "@/components/ErrorPage";
import { getUser } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function Home() {
  const headerList = headers();
  const cookie = headerList.get("cookie");
  console.log("headerList", headerList);
  console.log("cookie", cookie);
  // if (!cookie) {
  //   // show error page
  //   return <ErrorPage error="cookie not found" />;
  // }
  const user = await getUser(cookie);
  // assignmentId is Number
  if (!(user?.assignmentId && !isNaN(user.assignmentId))) {
    return <ErrorPage error="assignmentId not found" />;
  }
  if (user?.role === "author") {
    useAuthorStore.setState({ activeAssignmentId: user.assignmentId });
    redirect(`/author/${user.assignmentId}`);
  } else if (user?.role === "learner") {
    redirect(`/learner/${user.assignmentId}`);
  } else {
    // show error page
    return <ErrorPage error="User not found" />;
  }
}
