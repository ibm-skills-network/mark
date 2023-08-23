import AuthorHeader from "./(author)/components/AuthorHeader";
import AuthorLayout from "./(author)/components/AuthorLayout";
import LearnerHeader from "./(learner)/components/LearnerHeader";
import LearnerLayout from "./(learner)/components/LearnerLayout";

export default function Home() {
  const role = "author";

  return (
    <>
      {role === "author" ? <AuthorHeader /> : <LearnerHeader />}
      <main className="flex flex-col items-center justify-between min-h-screen p-4 m-4">
        {role === "author" ? <AuthorLayout /> : <LearnerLayout />}
      </main>
    </>
  );
}
