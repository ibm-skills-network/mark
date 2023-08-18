import { BASE_API_ROUTES } from "@config/constants";
import type { User } from "@config/types";
import AuthorHeader from "./(author)/components/AuthorHeader";
import AuthorLayout from "./(author)/components/AuthorLayout";
import IntroductionPage from "./(learner)/components/IntroductionPage";
import LearnerHeader from "./(learner)/components/LearnerHeader";
import LearnerLayout from "./(learner)/components/LearnerLayout";

// async function getUser<T>() {
//   const res = await fetch(BASE_API_ROUTES.user);

//   if (!res.ok) {
//     throw new Error("Failed to fetch user data");
//   }

//   return res.json() as Promise<T>;
// }

export default function Home() {
  // const { role } = await getUser<User>();
  const role = "author";

  return (
    <>
      {role === "author" ? (
        <AuthorHeader />
      ) : (
        <LearnerHeader attemptsAllowed={1} timeLimit={50} outOf={40} />
      )}
      <main className="flex flex-col items-center justify-between min-h-screen">
        {role === "author" ? (
          <AuthorLayout />
        ) : (
          <LearnerLayout>
            <IntroductionPage attemptsAllowed={1} timeLimit={50} outOf={40} />
          </LearnerLayout>
        )}
      </main>
    </>
  );
}
