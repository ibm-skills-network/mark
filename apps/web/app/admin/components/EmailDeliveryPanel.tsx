"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBaseApiPath } from "@/config/constants";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface BounceHealth {
  configured: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  stale: boolean;
  domains: { domain: string; recipients: number; lastBounceAt: string }[];
  senderWarning: { active: boolean; domains: number; recipients: number };
}

interface TemporaryHolds {
  items: {
    email: string;
    stage: number;
    reason: string;
    holdUntil: string;
    probeStartedAt: string | null;
    probeAcceptedAt: string | null;
  }[];
  total: number;
}

interface Suppressions {
  items: { id: number; email: string; reason: string; detail: string | null }[];
  total: number;
}

export function EmailDeliveryPanel({ sessionToken }: { sessionToken: string }) {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [holdPage, setHoldPage] = useState(1);
  const queryClient = useQueryClient();
  const base = `${getBaseApiPath("v1")}/admin-dashboard/email-suppressions`;
  const options = { headers: { "x-admin-token": sessionToken }, quiet: true };
  const health = useQuery({
    queryKey: ["email-bounce-health", sessionToken],
    queryFn: () =>
      apiClient.get<BounceHealth>(`${base}/bounce-health`, options),
    refetchInterval: 60_000,
  });
  const suppressions = useQuery({
    queryKey: ["email-suppressions", sessionToken, page],
    queryFn: () =>
      apiClient.get<Suppressions>(`${base}?page=${page}&limit=25`, options),
    enabled: expanded,
  });
  const release = useMutation({
    mutationFn: (id: number) => apiClient.delete(`${base}/${id}`, options),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["email-suppressions", sessionToken],
      });
    },
  });
  const holds = useQuery({
    queryKey: ["email-temporary-holds", sessionToken, holdPage],
    queryFn: () =>
      apiClient.get<TemporaryHolds>(
        `${base}/temporary-holds?page=${holdPage}&limit=25`,
        options,
      ),
    enabled: expanded,
    refetchInterval: 60_000,
  });
  const releaseHold = useMutation({
    mutationFn: (email: string) =>
      apiClient.post(`${base}/temporary-holds/release`, { email }, options),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["email-temporary-holds", sessionToken],
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email delivery</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Temporary delivery failures are paused and retried automatically.
          Routine review is not required.
        </p>
        {health.isPending && <p>Loading email delivery status…</p>}
        {health.isError && (
          <p role="alert">Could not load email delivery status.</p>
        )}
        {health.data && (
          <>
            <p className="text-sm text-muted-foreground">
              {health.data.lastSuccessAt
                ? `Last bounce check: ${new Date(health.data.lastSuccessAt).toLocaleString()}`
                : "No completed bounce check yet."}
            </p>
            {(!health.data.configured ||
              health.data.stale ||
              health.data.lastError) && (
              <p
                role="alert"
                className="text-sm text-amber-700 dark:text-amber-300"
              >
                Bounce monitoring needs attention.{" "}
                {health.data.lastError || "No recent successful check."}
              </p>
            )}
            {health.data.senderWarning?.active && (
              <p
                role="alert"
                className="text-sm text-amber-700 dark:text-amber-300"
              >
                Possible sender or relay problem:{" "}
                {health.data.senderWarning.recipients} recipients across{" "}
                {health.data.senderWarning.domains} domains failed in the last
                hour. Check the sending infrastructure.
              </p>
            )}
            {health.data.domains.length > 0 && (
              <div role="status" className="space-y-2">
                <p>
                  Repeated delivery failures in the last 7 days. Automatic
                  recovery is active; these domains are shown for
                  troubleshooting.
                </p>
                <ul className="list-disc pl-5">
                  {health.data.domains.map((domain) => (
                    <li key={domain.domain}>
                      {domain.domain}: {domain.recipients} distinct recipients;
                      latest refusal{" "}
                      {new Date(domain.lastBounceAt).toLocaleString()}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <Button
          variant="outline"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? "Hide delivery controls" : "Manage suppressed addresses"}
        </Button>
        {expanded && (
          <div className="space-y-3">
            <h3 className="font-medium">Temporary holds</h3>
            <p className="text-sm">
              After a pause, the next naturally triggered email tests recovery.
              Normal sending resumes after a 24-hour observation period and a
              complete bounce check. This does not confirm delivery.
            </p>
            {holds.isPending && <p>Loading temporary holds…</p>}
            {(holds.isError || releaseHold.isError) && (
              <p role="alert">
                Could not update temporary holds. Please try again.
              </p>
            )}
            {holds.data && (
              <>
                <p>{holds.data.total} temporary holds</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th className="p-2">Address</th>
                        <th className="p-2">Automatic recovery</th>
                        <th className="p-2">Override</th>
                      </tr>
                    </thead>
                    <tbody>
                      {holds.data.items.map((hold) => (
                        <tr key={hold.email} className="border-t">
                          <td className="p-2">
                            {hold.email}
                            <p className="text-muted-foreground break-all">
                              {hold.reason}
                            </p>
                          </td>
                          <td className="p-2">
                            {hold.probeStartedAt
                              ? "Trial reserved; awaiting outcome and bounce observation"
                              : `Next trial eligible after ${new Date(hold.holdUntil).toLocaleString()}`}
                          </td>
                          <td className="p-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={releaseHold.isPending}
                              onClick={() => releaseHold.mutate(hold.email)}
                              aria-label={`Lift temporary hold for ${hold.email}`}
                            >
                              Lift hold
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={holdPage === 1}
                    onClick={() => setHoldPage(holdPage - 1)}
                  >
                    Previous holds
                  </Button>
                  <span>Page {holdPage}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={holdPage * 25 >= holds.data.total}
                    onClick={() => setHoldPage(holdPage + 1)}
                  >
                    Next holds
                  </Button>
                </div>
              </>
            )}
            <h3 className="font-medium">Permanent suppressions</h3>
            <p className="text-sm">
              Release an address after confirming it can receive email. Older
              bounce reports will not suppress it again.
            </p>
            {suppressions.isPending && <p>Loading suppressed addresses…</p>}
            {(suppressions.isError || release.isError) && (
              <p role="alert">
                Could not complete the request. Please try again.
              </p>
            )}
            {suppressions.data && (
              <>
                <p>{suppressions.data.total} suppressed addresses</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th className="p-2">Address</th>
                        <th className="p-2">Reason</th>
                        <th className="p-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suppressions.data.items.map((item) => (
                        <tr key={item.id} className="border-t">
                          <td className="p-2">{item.email}</td>
                          <td className="p-2">
                            <p>{item.reason.replaceAll("_", " ")}</p>
                            <p className="text-muted-foreground break-all">
                              {item.detail}
                            </p>
                          </td>
                          <td className="p-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={release.isPending}
                              onClick={() => release.mutate(item.id)}
                              aria-label={`Release ${item.email}`}
                            >
                              Release
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </Button>
                  <span>Page {page}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page * 25 >= suppressions.data.total}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
