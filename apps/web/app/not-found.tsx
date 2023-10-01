import { Metadata } from "next";

// import { RiAlarmWarningFill } from 'react-icons/ri';

export const metadata: Metadata = {
  title: "Not Found",
};

export default function NotFound() {
  return (
    <main>
      <section className="bg-white">
        <div className="flex flex-col items-center justify-center min-h-screen text-center text-black layout">
          {/* <RiAlarmWarningFill
            size={60}
            className='text-red-500 drop-shadow-glow animate-flicker'
          /> */}
          <h1 className="mt-8 text-4xl md:text-6xl">Page Not Found</h1>
          <a href="/">{"<- Back to home"}</a>
        </div>
      </section>
    </main>
  );
}
