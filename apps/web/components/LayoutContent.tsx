"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Toaster } from "sonner";
import { MarkChat } from "../app/chatbot/components/MarkChat";
import AuthorStoreBridge from "../app/chatbot/store/AuthorStoreBridge";
import { useChatbot } from "../hooks/useChatbot";
import ErrorModal from "@/components/ErrorModal";
import {
  API_SERVER_ERROR_EVENT,
  type ApiServerErrorDetail,
} from "@/lib/api-events";

export default function LayoutContent({ children }: { children: ReactNode }) {
  const { isOpen } = useChatbot();
  const pathname = usePathname();
  const hideMarkChat = pathname?.startsWith("/admin") ?? false;
  const [apiError, setApiError] = useState<ApiServerErrorDetail | null>(null);

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
          position="bottom-left"
          expand={true}
          closeButton={true}
        />

        {children}
      </div>

      {hideMarkChat ? null : <MarkChat />}
    </div>
  );
}
