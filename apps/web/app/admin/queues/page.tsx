"use client";

import { useEffect, useState } from "react";
import { readAdminSessionFromStorage } from "@/lib/admin-session";
import { QueueStatusDashboard } from "../components/QueueStatusDashboard";

export default function AdminQueuesPage() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = readAdminSessionFromStorage();
    setToken(session?.sessionToken ?? null);
    setReady(true);
  }, []);

  if (!ready) return null;
  if (!token) {
    return (
      <div className="p-6 text-sm">
        Admin sign-in required. Open{" "}
        <a className="underline" href="/admin">
          /admin
        </a>{" "}
        first.
      </div>
    );
  }
  return (
    <div className="p-6">
      <QueueStatusDashboard sessionToken={token} />
    </div>
  );
}
