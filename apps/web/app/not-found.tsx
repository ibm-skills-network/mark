import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Not Found",
};

export default function NotFound() {
  return (
    <main>
      <section className="bg-white">
        <div className="flex flex-col items-center justify-center min-h-screen text-center text-black layout">
          <h1 className="mt-8 text-4xl md:text-6xl">Page Not Found</h1>
          <a href="/">{"<- Back to home"}</a>
        </div>
      </section>
    </main>
  );
}
