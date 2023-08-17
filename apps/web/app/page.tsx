import AuthorLayout from "./(author)/components/AuthorLayout";
import LearnerLayout from "./(learner)/components/LearnerLayout";

function getUser() {
  // const res = await fetch("/api/user");
  // The return value is *not* serialized
  // You can return Date, Map, Set, etc.

  // if (!res.ok) {
  // This will activate the closest `error.js` Error Boundary
  // throw new Error("Failed to fetch data");
  // }

  // return res.json();
  return { user: "author" } as { user: "author" | "learner" };
}

export default function Home() {
  const { user } = getUser();

  return (
    <main className="flex flex-col items-center justify-between min-h-screen">
      {user === "author" ? <AuthorLayout /> : <LearnerLayout />}
    </main>
  );
}
