"use client";

import ErrorPage from "@components/ErrorPage";
import { BASE_API_ROUTES } from "@config/constants";
import { User } from "@config/types";
import { useRouter } from "next/navigation";
// import { redirect } from "next/navigation";
import { useEffect } from "react";

async function getUser<T>() {
  const res = await fetch(window.location.origin + BASE_API_ROUTES.user);

  if (!res.ok) {
    throw new Error("Failed to fetch user data");
  }

  return res.json() as Promise<T>;
}

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const asyncFunc = async () => {
      const { role } = await getUser<User>();
      if (role === "author") {
        router.push("/author/introduction");
      } else if (role === "learner") {
        router.push("/learner");
      }
    };
    void asyncFunc();
  }, []);
}
