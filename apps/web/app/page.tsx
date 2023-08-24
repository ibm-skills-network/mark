import ErrorPage from "@components/ErrorPage";
import { BASE_API_ROUTES } from "@config/constants";
import { User } from "@config/types";
import { redirect } from "next/navigation";

async function getUser<T>() {
  const res = await fetch(BASE_API_ROUTES.user);

  if (!res.ok) {
    throw new Error("Failed to fetch user data");
  }

  return res.json() as Promise<T>;
}

export default async function Home() {
  const { role } = await getUser<User>();
  if (role === "author") {
    redirect("/author/introduction");
  } else if (role === "learner") {
    redirect("/learner");
  }
  return <ErrorPage error={new Error("Invalid role")} />;
}
