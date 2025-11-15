"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getUser } from "@/lib/talkToBackend";
import Loading from "@/components/Loading";
import animationData from "@/animations/LoadSN.json";
import { AdminLogin } from "../components/AdminLogin";
import { RegradingRequestsContent } from "./components/RegradingRequestsContent";

export default function RegradingRequestsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const checkAdminAccess = async () => {
      try {
        const adminToken = localStorage.getItem("adminSessionToken");
        const adminEmail = localStorage.getItem("adminEmail");
        const expiresAt = localStorage.getItem("adminExpiresAt");

        if (adminToken && adminEmail && expiresAt) {
          const expireDate = new Date(expiresAt);

          if (expireDate > new Date()) {
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
                setSessionToken(adminToken);
                setIsAuthenticated(true);
                setUserRole("admin");
                setIsLoading(false);
                return;
              } else {
                localStorage.removeItem("adminSessionToken");
                localStorage.removeItem("adminEmail");
                localStorage.removeItem("adminExpiresAt");
              }
            } catch (apiError) {
              localStorage.removeItem("adminSessionToken");
              localStorage.removeItem("adminEmail");
              localStorage.removeItem("adminExpiresAt");
            }
          } else {
            localStorage.removeItem("adminSessionToken");
            localStorage.removeItem("adminEmail");
            localStorage.removeItem("adminExpiresAt");
          }
        }
      } catch (error) {
        console.error("Error checking admin access:", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkAdminAccess();
  }, [router]);

  const handleAuthenticated = (token: string) => {
    setSessionToken(token);
    setIsAuthenticated(true);
    setUserRole("admin");
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
        console.error("Error logging out:", error);
      }
    }

    localStorage.removeItem("adminSessionToken");
    localStorage.removeItem("adminEmail");
    localStorage.removeItem("adminExpiresAt");

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
    <RegradingRequestsContent
      sessionToken={sessionToken}
      onLogout={handleLogout}
    />
  );
}
