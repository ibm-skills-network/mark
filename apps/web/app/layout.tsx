import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Mark",
  description: "Grade your learners' work with the power of AI.",
  icons: {
    icon: "favicon.ico",
  },
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
        <Toaster richColors position="top-center" />
        {children}
      </body>
    </html>
  );
}
