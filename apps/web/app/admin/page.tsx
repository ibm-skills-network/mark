"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getUser } from "@/lib/talkToBackend";
import Loading from "@/components/Loading";
import animationData from "@/animations/LoadSN.json";
import { AdminLogin } from "./components/AdminLogin";
import { OptimizedAdminDashboard } from "./components/AdminDashboard";

export default function AdminPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");

  useEffect(() => {
    const checkAdminAccess = async () => {
      try {
        // First, check if we have a valid admin session token
        const adminToken = localStorage.getItem("adminSessionToken");
        const adminEmail = localStorage.getItem("adminEmail");
        const expiresAt = localStorage.getItem("adminExpiresAt");

        if (adminToken && adminEmail && expiresAt) {
          const expireDate = new Date(expiresAt);

          if (expireDate > new Date()) {
            // Session appears valid, let's verify it with the backend
            try {
              const response = await fetch(
                "/api/v1/reports/feedback?page=1&limit=1",
                {
                  headers: {
                    "x-admin-token": adminToken,
                  },
                },
              );

              if (response.ok) {
                // Session is valid with backend
                setSessionToken(adminToken);
                setIsAuthenticated(true);
                setUserRole("admin");
                setIsLoading(false);

                // If user already has valid session and there's a returnTo parameter, redirect
                if (returnTo) {
                  router.push(returnTo);
                }
                return;
              } else {
                // Session invalid, clear it
                localStorage.removeItem("adminSessionToken");
                localStorage.removeItem("adminEmail");
                localStorage.removeItem("adminExpiresAt");
              }
            } catch (apiError) {
              console.error("Error validating session with backend:", apiError);
              // Clear potentially invalid session
              localStorage.removeItem("adminSessionToken");
              localStorage.removeItem("adminEmail");
              localStorage.removeItem("adminExpiresAt");
            }
          } else {
            // Session expired, clear it
            localStorage.removeItem("adminSessionToken");
            localStorage.removeItem("adminEmail");
            localStorage.removeItem("adminExpiresAt");
          }
        }
      } catch (error) {
        console.error("Failed to check admin access:", error);
        // Will show login form
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

    // Redirect to the original destination if returnTo parameter exists
    if (returnTo) {
      router.push(returnTo);
    }
  };

  const handleLogout = async () => {
    const adminToken = localStorage.getItem("adminSessionToken");

    if (adminToken) {
      try {
        await fetch("/api/v1/auth/admin/logout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessionToken: adminToken }),
        });
      } catch (error) {
        console.error("Failed to logout:", error);
      }
    }

    // Clear local storage
    localStorage.removeItem("adminSessionToken");
    localStorage.removeItem("adminEmail");
    localStorage.removeItem("adminExpiresAt");

    // Reset state
    setSessionToken(null);
    setIsAuthenticated(false);
    setUserRole(null);

    // Redirect to home page
    router.push("/");
  };

  if (isLoading) {
    return <Loading animationData={animationData} />;
  }

  if (!isAuthenticated) {
    return <AdminLogin onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <OptimizedAdminDashboard
        sessionToken={sessionToken}
        onLogout={handleLogout}
      />
    </div>
  );
}
