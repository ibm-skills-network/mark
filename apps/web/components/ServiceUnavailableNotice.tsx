"use client";

import { Clock } from "lucide-react";

/**
 * Calm, non-alarming full-screen notice for a *planned* temporary outage (e.g.
 * the AI kill-switch). Deliberately NOT the generic ErrorModal/ErrorPage — no
 * "something went wrong", no status code, no "details for support" — so a
 * learner reads it as "this is paused, not broken" and doesn't file a bug.
 */
export default function ServiceUnavailableNotice({
  title = "Temporarily out of service",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <div className="flex min-h-[calc(100vh-100px)] w-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
          <Clock className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-slate-600">{message}</p>
        <p className="mt-4 text-sm text-slate-400">
          Nothing is broken and you don&apos;t need to do anything — your
          progress is safe. Please check back a little later.
        </p>
        <button
          type="button"
          onClick={() => globalThis.location.reload()}
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
