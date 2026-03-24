import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import LayoutContent from "../components/LayoutContent";

const inter = Inter({ subsets: ["latin"] });

const INSTANA_SCRIPT_SRC = "https://eum.instana.io/1.8.1/eum.min.js";
const INSTANA_SCRIPT_INTEGRITY =
  "sha384-qFzHZ5BC7HOPEBSYkbYSv+DBWrG34P1QW9mIaCR41db6yOJNYmH4antW6KLkc6v1";
const INSTANA_REPORTING_URL = "https://eum-coral-saas.instana.io";
const INSTANA_KEYS = {
  production: "Mlt8PAS5SeGSSua57_S3JQ",
  staging: "zdCjA1AVS9SkBrwEFHqmzg",
} as const;

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
  const appEnvironment =
    process.env.NEXT_PUBLIC_APP_ENV?.toLowerCase() ?? "development";
  const instanaKey =
    appEnvironment === "production" || appEnvironment === "staging"
      ? INSTANA_KEYS[appEnvironment]
      : null;

  const instanaBootstrapScript = instanaKey
    ? `(function(s,t,a,n){s[t]||(s[t]=a,n=s[a]=function(){n.q.push(arguments)},n.q=[],n.v=2,n.l=1*new Date)})(window,"InstanaEumObject","ineum");
ineum('reportingUrl', '${INSTANA_REPORTING_URL}');
ineum('key', '${instanaKey}');
ineum('trackSessions');
ineum('autoPageDetection', { titleAsPageName: true });`
    : null;

  return (
    <html lang="en" className="h-full">
      <head>
        {instanaBootstrapScript ? (
          <>
            <script
              dangerouslySetInnerHTML={{ __html: instanaBootstrapScript }}
            />
            <script
              crossOrigin="anonymous"
              defer
              integrity={INSTANA_SCRIPT_INTEGRITY}
              src={INSTANA_SCRIPT_SRC}
            />
          </>
        ) : null}
      </head>
      <body
        className={`${inter.className} h-full m-0 p-0`}
        data-color-mode="light"
        suppressHydrationWarning
      >
        <LayoutContent>{children}</LayoutContent>
      </body>
    </html>
  );
}
