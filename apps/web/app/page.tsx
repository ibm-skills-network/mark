import AuthorLayout from "./(author)/components/AuthorLayout";
import LearnerLayout from "./(learner)/components/LearnerLayout";
import IntroductionPage from "./(learner)/components/IntroductionPage";

function getUser() {
  // Your code here...
  return { user: "learner" } as { user: "author" | "learner" };
}

export default function Home() {
  const { user } = getUser();

  return (
    <main className="flex flex-col items-center justify-between min-h-screen">
      {user === "author" ? (
        <AuthorLayout>
          <IntroductionPage attemptsAllowed={1} timeLimit={50} outOf={40} />
        </AuthorLayout>
      ) : (
        <LearnerLayout>
          <IntroductionPage attemptsAllowed={1} timeLimit={50} outOf={40} />
        </LearnerLayout>
      )}
    </main>
  );
}
