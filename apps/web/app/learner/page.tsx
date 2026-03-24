import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/talkToBackend";

export default async function LearnerIndexPage() {
  const cookie = (await headers()).get("cookie") || "";
  try {
    const user = await getUser(cookie);
    if (user?.role === "learner" && user?.assignmentId) {
      redirect(`/learner/${user.assignmentId}`);
    }
    if (user?.role === "author" && user?.assignmentId) {
      redirect(`/author/${user.assignmentId}`);
    }
  } catch {
    // User not authenticated - redirect to homepage
  }

  redirect("/");
}
