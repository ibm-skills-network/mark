"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { getBaseApiPath } from "@/config/constants";
import { readAdminSessionFromStorage } from "@/lib/admin-session";

type AssumableRole = "learner" | "author";

/** The role and assignment this page needs, or undefined off quiz pages. */
export function pageSessionTarget(
  pathname: string,
  search: string,
): { role: AssumableRole; assignmentId: number } | undefined {
  const match = pathname.match(/^\/(author|learner)\/([1-9]\d*)(?:\/|$)/);
  if (!match) return undefined;
  const assignmentId = Number(match[2]);
  if (!Number.isSafeInteger(assignmentId)) return undefined;
  // An author preview runs under /learner but needs the author session.
  const role =
    match[1] === "author" ||
    new URLSearchParams(search).get("authorMode") === "true"
      ? "author"
      : "learner";
  return { role, assignmentId };
}

/**
 * Admin-only shortcut: swap the session cookie for one that matches this page
 * and reload. Shown only when the browser holds an admin dashboard login; the
 * server re-checks that login and the admin allow-list on every click.
 */
export default function AdminAssumeRoleButton() {
  const pathname = usePathname();
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [target, setTarget] =
    useState<ReturnType<typeof pageSessionTarget>>(undefined);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setAdminToken(readAdminSessionFromStorage()?.sessionToken ?? null);
    setTarget(pageSessionTarget(pathname ?? "", window.location.search));
  }, [pathname]);

  if (!adminToken || !target) return null;

  const assume = async () => {
    setPending(true);
    try {
      const response = await fetch(
        `${getBaseApiPath("v1")}/auth/admin/assume-role`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": adminToken,
          },
          body: JSON.stringify(target),
        },
      );
      if (!response.ok) {
        toast.error(
          response.status === 401 || response.status === 403
            ? "Admin login expired. Sign in again on /admin."
            : `Could not open this page as ${target.role} (${response.status}).`,
        );
        setPending(false);
        return;
      }
      window.location.reload();
    } catch {
      toast.error("Could not reach Mark. Try again.");
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void assume()}
      disabled={pending}
      className="fixed top-2 right-2 z-[1000] rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-amber-600 disabled:opacity-60"
      title="Replace your session with an admin-issued one for this page"
    >
      {pending ? "Switching…" : `Admin: open as ${target.role}`}
    </button>
  );
}
