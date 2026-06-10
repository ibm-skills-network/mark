"use client";

import { useEffect, useState, type ReactNode } from "react";
import SNIcon from "./SNIcon";

/**
 * Shared shell for full-screen learner notices (session expired, access
 * restricted, ...). Calm and on-brand: a logo badge, a headline, one line of
 * guidance, an optional action, and an optional footnote — deliberately free of
 * status codes and debug detail.
 */
export default function LearnerNotice({
  title,
  description,
  action,
  footnote,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  footnote?: ReactNode;
}) {
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
          {title}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-base leading-relaxed text-gray-500">
          {description}
        </p>

        {action ? (
          <div className="mt-8 flex justify-center">{action}</div>
        ) : null}

        {footnote ? (
          <p className="mx-auto mt-10 max-w-sm text-sm leading-relaxed text-gray-400">
            {footnote}
          </p>
        ) : null}
      </div>
    </main>
  );
}
