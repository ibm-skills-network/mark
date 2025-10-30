import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import LayoutContent from "../components/LayoutContent";

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
    <html lang="en" className="h-full">
      <body
        className={`${inter.className} h-full m-0 p-0`}
        data-color-mode="light"
      >
        <LayoutContent>{children}</LayoutContent>
      </body>
    </html>
  );
}
