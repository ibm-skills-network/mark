"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Toaster } from "sonner";
import { MarkChat } from "../app/chatbot/components/MarkChat";
import AuthorStoreBridge from "../app/chatbot/store/AuthorStoreBridge";
import ReportBugButton from "@/components/ReportBugButton";
import { useChatbot } from "../hooks/useChatbot";
import { useTheme } from "../hooks/useTheme";
import ErrorModal from "@/components/ErrorModal";
import {
  API_SERVER_ERROR_EVENT,
  type ApiServerErrorDetail,
} from "@/lib/api-events";
import { getAiStatus } from "@/lib/ai-status";

export default function LayoutContent({ children }: { children: ReactNode }) {
  const { isOpen } = useChatbot();
  const { isDark } = useTheme();
  const pathname = usePathname();
  const [chatDisabled, setChatDisabled] = useState(false);
  // Hide the chat widget on admin routes (as before) or when the AI chat
  // component is switched off. The widget hiding is a UX hint only — the
  // backend independently returns an "unavailable" message if chat is used.
  const hideMarkChat =
    (pathname?.startsWith("/admin") ?? false) || chatDisabled;
  const [apiError, setApiError] = useState<ApiServerErrorDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAiStatus().then((status) => {
      if (!cancelled && status) {
        setChatDisabled(status.chat === false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ApiServerErrorDetail>).detail;
      if (!detail) return;
      setApiError(detail);
    };

    window.addEventListener(API_SERVER_ERROR_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(
        API_SERVER_ERROR_EVENT,
        handler as EventListener,
      );
    };
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {apiError ? (
        <ErrorModal
          statusCode={apiError.status}
          headline={apiError.statusText || "Server error"}
          error={apiError.message || "Something went wrong"}
          primaryActionLabel="Reload"
          primaryActionHref="/"
          onClose={() => setApiError(null)}
        />
      ) : null}
      <div
        className={`flex-1 transition-all duration-300 ease-in-out overflow-auto ${
          isOpen && !hideMarkChat ? "w-[75vw]" : "w-full"
        }`}
      >
        <AuthorStoreBridge />
        <Toaster
          richColors
          theme={isDark ? "dark" : "light"}
          position="bottom-left"
          expand={true}
          closeButton={true}
        />

        {children}
      </div>

      {hideMarkChat ? null : <MarkChat />}
      {/* Bug reporting stays available even when the AI chat is disabled. */}
      {pathname?.startsWith("/admin") ? null : <ReportBugButton />}
    </div>
  );
}
