import ErrorPage from "@/components/ErrorPage";
import { getUser } from "@/lib/talkToBackend";
import { useAuthorStore } from "@/stores/author";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function Home() {
  const headerList = headers();
  const cookie = headerList.get("cookie");
  if (!cookie && process.env.NODE_ENV === "production") {
    redirect("https://skills.network");
  }
  const user = await getUser(cookie);

  if (!(user?.assignmentId && !Number.isNaN(user.assignmentId))) {
    return <ErrorPage error="assignmentId not found" />;
  }
  if (user?.role === "author") {
    redirect(`/author/${user.assignmentId}`);
  } else if (user?.role === "learner") {
    redirect(`/learner/${user.assignmentId}`);
  } else {
    return <ErrorPage error="User not found" />;
  }
}
