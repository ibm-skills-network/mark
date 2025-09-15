"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { MarkChat } from "../app/chatbot/components/MarkChat";
import AuthorStoreBridge from "../app/chatbot/store/AuthorStoreBridge";
import { useChatbot } from "../hooks/useChatbot";

export default function LayoutContent({ children }: { children: ReactNode }) {
  const { isOpen } = useChatbot();

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Main content area that shrinks when chatbot is open */}
      <div
        className={`flex-1 transition-all duration-300 ease-in-out overflow-auto ${
          isOpen ? "w-[75vw]" : "w-full"
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

      {/* Chatbot panel */}
      <MarkChat />
    </div>
  );
}
