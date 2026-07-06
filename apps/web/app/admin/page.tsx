"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Loading from "@/components/Loading";
import animationData from "@/animations/LoadSN.json";
import { AdminLogin } from "./components/AdminLogin";
import { OptimizedAdminDashboard } from "./components/AdminDashboard";
import {
  clearAdminSessionStorage,
  readAdminSessionFromStorage,
} from "@/lib/admin-session";

export default function AdminPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [, setUserRole] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");

  useEffect(() => {
    const checkAdminAccess = async () => {
      try {
        const stored = readAdminSessionFromStorage();

        if (!stored) {
          clearAdminSessionStorage();
          return;
        }

        try {
          const response = await fetch(
            "/api/v1/reports/feedback?page=1&limit=1",
            {
              headers: {
                "x-admin-token": stored.sessionToken,
              },
            },
          );

          if (response.ok) {
            setSessionToken(stored.sessionToken);
            setIsAuthenticated(true);
            setUserRole("admin");
            setIsLoading(false);

            if (returnTo) {
              router.push(returnTo);
            }
            return;
          }

          clearAdminSessionStorage();
        } catch (apiError) {
          console.error("Error validating session with backend:", apiError);
          clearAdminSessionStorage();
        }
      } catch (error) {
        console.error("Failed to check admin access:", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkAdminAccess();
  }, [router, returnTo]);

  const handleAuthenticated = (token: string) => {
    setSessionToken(token);
    setIsAuthenticated(true);
    setUserRole("admin");

    if (returnTo) {
      router.push(returnTo);
    }
  };

  const handleLogout = async () => {
    const stored = readAdminSessionFromStorage();

    if (stored) {
      try {
        await fetch("/api/v1/auth/admin/logout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessionToken: stored.sessionToken }),
        });
      } catch (error) {
        console.error("Failed to logout:", error);
      }
    }

    clearAdminSessionStorage();

    setSessionToken(null);
    setIsAuthenticated(false);
    setUserRole(null);

    router.push("/");
  };

  if (isLoading) {
    return <Loading animationData={animationData} />;
  }

  if (!isAuthenticated) {
    return <AdminLogin onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <OptimizedAdminDashboard
        sessionToken={sessionToken}
        onLogout={handleLogout}
      />
    </div>
  );
}
