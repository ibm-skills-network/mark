import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { MarkChat } from "./chatbot/components/MarkChat";
import AuthorStoreBridge from "./chatbot/store/AuthorStoreBridge";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Mark",
  description: "Grade your learners' work with the power of AI.",
  keywords: [
    "mark",
    "skills network",
    "ai",
    "AI graded assignments",
    "online learning",
    "online courses",
  ],
  authors: [
    {
      name: "Skills Network",
      url: "https://skills.network",
    },
    {
      name: "Rami Maalouf",
      url: "https://rami-maalouf.tech",
    },
  ],
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className}`} data-color-mode="light">
        <MarkChat />
        <AuthorStoreBridge />
        <Toaster
          richColors
          position="bottom-left"
          expand={true}
          closeButton={true}
        />
        {children}
      </body>
    </html>
  );
}
