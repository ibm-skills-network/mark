"use client";

import { useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { abandonAttempt } from "@/lib/talkToBackend";

interface Props {
  assignmentId: number;
  attemptId: number;
}

export default function VersionMismatchBanner({
  assignmentId,
  attemptId,
}: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  if (dismissed) return null;

  const onStartOver = async () => {
    setPending(true);
    const ok = await abandonAttempt(assignmentId, attemptId);
    if (!ok) {
      toast.error(
        "Couldn't start a new attempt. Please refresh the page or contact support.",
      );
      setPending(false);
      return;
    }
    router.refresh();
  };

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-start gap-3">
      <AlertCircle
        className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900">
          A newer version of this assignment is available
        </p>
        <p className="text-sm text-amber-800 mt-0.5">
          You haven&apos;t answered any questions yet. Start over to take the
          latest version, or continue with the version you began with.
        </p>
      </div>
      <button
        type="button"
        onClick={onStartOver}
        disabled={pending}
        className="text-sm font-medium px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
      >
        {pending ? "Starting over…" : "Start over"}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="text-amber-700 hover:text-amber-900 flex-shrink-0 p-1"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
