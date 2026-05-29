"use client";

import { useEffect, useState } from "react";
import SNIcon from "./SNIcon";
import Button from "./Button";

function RefreshIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/**
 * Calm, on-brand screen shown when a learner's session has expired (401).
 * Deliberately minimal: no status code, no debug timeline, no support dump —
 * the one clear action is to reload (which re-establishes the LMS session),
 * with a fallback hint to relaunch from the course.
 */
export default function SessionExpired() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main className="relative flex min-h-[80vh] w-full items-center justify-center overflow-hidden bg-white px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-violet-200/40 blur-3xl"
      />

      <div
        className={`relative w-full max-w-md text-center transition-all duration-700 ease-out ${
          mounted ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
        }`}
      >
        <div className="mb-8 flex justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-100 bg-violet-50 shadow-sm">
            <SNIcon />
          </span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
          Your session has expired
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-base leading-relaxed text-gray-500">
          Reload the page to sign back in and pick up where you left off.
        </p>

        <div className="mt-8 flex justify-center">
          <Button
            version="primary"
            LeftIcon={RefreshIcon}
            onClick={() => window.location.reload()}
            className="px-6"
          >
            Reload page
          </Button>
        </div>

        <p className="mx-auto mt-10 max-w-sm text-sm leading-relaxed text-gray-400">
          Opened this from a course? Relaunch the assignment from{" "}
          <span className="text-gray-500">Coursera</span>,{" "}
          <span className="text-gray-500">edX</span>,{" "}
          <span className="text-gray-500">Author Workbench</span>, or{" "}
          <span className="text-gray-500">yourLearning</span>.
        </p>
      </div>
    </main>
  );
}
