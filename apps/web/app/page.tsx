import AuthorView from "./(author)/components/AuthorView";
import LearnerView from "./(learner)/components/LearnerView";

async function getUser() {
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

export default async function Home() {
  const { user } = await getUser();

  return (
    <main className="flex flex-col items-center justify-between min-h-screen">
      {user === "author" ? <AuthorView /> : <LearnerView />}
    </main>
  );
}
