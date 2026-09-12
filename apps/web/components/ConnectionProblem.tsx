"use client";

import ErrorPage from "@/components/ErrorPage";
import type { NetworkFailureKind } from "@/lib/api-client";
import { reloadPage } from "@/lib/utils";

/**
 * Shown when a request produced no HTTP response at all — the browser gave up
 * waiting, or the connection could not be completed.
 *
 * These were previously rendered as server faults: the client synthesised
 * `408` for its own timeout and anything else without a status was floored to
 * `500`, so a learner on a dropped mobile connection was told "Something went
 * wrong on our side" and invited to report an outage. Nothing failed on our
 * side, so this screen says so and offers the retry that actually helps.
 */
const COPY: Record<
  NetworkFailureKind,
  {
    headline: string;
    message: string;
    steps: { title: string; description: string }[];
  }
> = {
  timeout: {
    headline: "The request timed out",
    message:
      "Your device didn't get a response in time. That is usually a slow or interrupted connection or network, not a problem with the assignment.",
    steps: [
      {
        title: "Try again",
        description: "Most timeouts clear on a second attempt.",
      },
      {
        title: "Check your connection",
        description:
          "Weak mobile signal, a VPN, or a captive Wi-Fi portal can all stall the request.",
      },
      {
        title: "Nothing you submitted is lost",
        description: "Your answers stay saved until you submit them.",
      },
    ],
  },
  unreachable: {
    headline: "We couldn't reach Mark from this network",
    message:
      "Your device couldn't complete the request. That is usually a dropped or offline connection or network.",
    steps: [
      {
        title: "Check that you are online",
        description: "Reconnect to Wi-Fi or mobile data, then try again.",
      },
      {
        title: "Try again",
        description: "A dropped connection normally recovers straight away.",
      },
      {
        title: "Nothing you submitted is lost",
        description: "Your answers stay saved until you submit them.",
      },
    ],
  },
};

export default function ConnectionProblem({
  kind,
  variant,
  onRetry = reloadPage,
}: {
  kind: NetworkFailureKind;
  variant?: "page" | "modal";
  onRetry?: () => void;
}) {
  const copy = COPY[kind];

  return (
    <ErrorPage
      error={copy.message}
      // No status: the server never answered, so it has none to report.
      statusLabel="Network"
      fault="client-network"
      headline={copy.headline}
      userSteps={copy.steps}
      onRetry={onRetry}
      variant={variant}
    />
  );
}
