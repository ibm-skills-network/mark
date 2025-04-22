import ErrorPage from "@/components/ErrorPage";
import { getUser } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function Home() {
  const headerList = headers();
  const cookie = headerList.get("cookie");
  if (!cookie && process.env.NODE_ENV === "production") {
    // that means the user is not logged in/cookie expired
    // TODO: do nothing and show the marketing page
    redirect("https://skills.network");
  }
  const user = await getUser(cookie);
  // assignmentId is Number
  if (!(user?.assignmentId && !Number.isNaN(user.assignmentId))) {
    return <ErrorPage error="assignmentId not found" />;
  }
  if (user?.role === "author") {
    redirect(`/author/${user.assignmentId}`);
  } else if (user?.role === "learner") {
    redirect(`/learner/${user.assignmentId}`);
  } else {
    // show error page
    return <ErrorPage error="User not found" />;
  }
}
