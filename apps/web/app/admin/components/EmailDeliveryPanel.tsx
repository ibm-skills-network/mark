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
}

interface Suppressions {
  items: { id: number; email: string; reason: string; detail: string | null }[];
  total: number;
}

export function EmailDeliveryPanel({ sessionToken }: { sessionToken: string }) {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(false);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email delivery</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
            {health.data.domains.length > 0 && (
              <div role="status" className="space-y-2">
                <p>
                  Repeated delivery refusals in the last 7 days. Review the mail
                  policy with the receiving organisation.
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
          {expanded
            ? "Hide suppressed addresses"
            : "Manage suppressed addresses"}
        </Button>
        {expanded && (
          <div className="space-y-3">
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
