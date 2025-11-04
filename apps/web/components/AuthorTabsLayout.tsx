"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useChatbot } from "@/hooks/useChatbot";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FileText, Settings, HelpCircle, CheckCircle, Eye } from "lucide-react";

interface AuthorTabsLayoutProps {
  children: React.ReactNode;
  assignmentId: string;
}

export function AuthorTabsLayout({
  children,
  assignmentId,
}: AuthorTabsLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isOpen: isChatbotOpen } = useChatbot();

  const getCurrentTab = () => {
    if (pathname.includes("/config")) return "config";
    if (pathname.includes("/questions")) return "questions";
    if (pathname.includes("/review")) return "review";
    return "overview";
  };

  const currentTab = getCurrentTab();

  const handleTabChange = (value: string) => {
    const basePath = `/author/${assignmentId}`;

    switch (value) {
      case "overview":
        router.push(basePath);
        break;
      case "questions":
        router.push(`${basePath}/questions`);
        break;
      case "config":
        router.push(`${basePath}/config`);
        break;
      case "review":
        router.push(`${basePath}/review`);
        break;
    }
  };

  return (
    <div className="w-full">
      <Tabs
        value={currentTab}
        onValueChange={handleTabChange}
        className="w-full"
      >
        <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
          <div className="container mx-auto px-4">
            <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-flex">
              <TabsTrigger value="overview" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">Overview</span>
              </TabsTrigger>

              <TabsTrigger
                value="questions"
                className="flex items-center gap-2"
              >
                <HelpCircle className="h-4 w-4" />
                <span className="hidden sm:inline">Questions</span>
              </TabsTrigger>

              <TabsTrigger value="config" className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                <span className="hidden sm:inline">Settings</span>
              </TabsTrigger>

              <TabsTrigger value="review" className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                <span className="hidden sm:inline">Review</span>
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <div className="container mx-auto px-4 py-6">
          <TabsContent value="overview" className="mt-0">
            {currentTab === "overview" && children}
          </TabsContent>

          <TabsContent value="questions" className="mt-0">
            {currentTab === "questions" && children}
          </TabsContent>

          <TabsContent value="config" className="mt-0">
            {currentTab === "config" && children}
          </TabsContent>

          <TabsContent value="review" className="mt-0">
            {currentTab === "review" && children}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
