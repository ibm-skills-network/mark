"use client";

import LearnerNotice from "./LearnerNotice";
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
 * Shown when a learner's session has expired (401). Reload re-establishes the
 * LMS session for a transient blip; the "Back to home" link is the escape hatch
 * so a genuinely-gone session doesn't trap the learner reloading the same
 * failing assignment URL forever (the learner home redirects out to "/").
 */
export default function SessionExpired() {
  return (
    <LearnerNotice
      title="Your session has expired"
      description="Reload the page to sign back in and pick up where you left off."
      action={
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            version="primary"
            LeftIcon={RefreshIcon}
            onClick={() => window.location.reload()}
            className="px-6"
          >
            Reload page
          </Button>
          <a
            href="/learner"
            className="btn-tertiary inline-flex items-center px-6"
          >
            Back to home
          </a>
        </div>
      }
      footnote={
        <>
          Opened this from a course? Relaunch the assignment from{" "}
          <span className="text-gray-500">Coursera</span>,{" "}
          <span className="text-gray-500">edX</span>,{" "}
          <span className="text-gray-500">Author Workbench</span>, or{" "}
          <span className="text-gray-500">yourLearning</span>.
        </>
      }
    />
  );
}
