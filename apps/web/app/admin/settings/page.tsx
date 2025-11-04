"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminNav } from "../components/AdminNav";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Settings {
  emailOnRegradingRequest: boolean;
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>({
    emailOnRegradingRequest: true,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const token = localStorage.getItem("adminSessionToken");
      if (!token) {
        router.push("/admin");
        return;
      }

      const response = await fetch("/api/v1/admin-dashboard/settings", {
        headers: {
          "x-admin-token": token,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch settings");
      }

      const data = await response.json();
      setSettings({
        emailOnRegradingRequest: data.emailOnRegradingRequest,
      });
    } catch (error) {
      toast.error("Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      setIsSaving(true);
      const token = localStorage.getItem("adminSessionToken");
      if (!token) {
        router.push("/admin");
        return;
      }

      const response = await fetch("/api/v1/admin-dashboard/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        throw new Error("Failed to save settings");
      }

      toast.success("Settings saved successfully");
    } catch (error) {
      toast.error("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("adminSessionToken");
    router.push("/admin");
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen">
        <AdminNav onLogout={handleLogout} />
        <main className="flex-1 p-8">
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500">Loading settings...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <AdminNav onLogout={handleLogout} />
      <main className="flex-1 p-8">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold mb-6">Settings</h1>

          <Card>
            <CardHeader>
              <CardTitle>Email Notifications</CardTitle>
              <CardDescription>
                Configure when you want to receive email notifications
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="regrading-emails" className="text-base">
                    Regrading Requests
                  </Label>
                  <p className="text-sm text-gray-500">
                    Receive emails when learners submit regrading requests
                  </p>
                </div>
                <Switch
                  id="regrading-emails"
                  checked={settings.emailOnRegradingRequest}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      emailOnRegradingRequest: checked,
                    })
                  }
                />
              </div>

              <div className="pt-4 border-t">
                <Button onClick={saveSettings} disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save Settings"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
