import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import LayoutContent from "../components/LayoutContent";

const inter = Inter({ subsets: ["latin"] });

// Render the layout per request rather than statically prerendering it.
// Required so the Instana key selection below picks up the container's
// runtime APP_ENV (set per-environment by the deploy overlay) instead of
// freezing to whatever was in the build environment.
export const dynamic = "force-dynamic";

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
  // APP_ENV (no NEXT_PUBLIC_ prefix) is intentionally a server-only env
  // var. NEXT_PUBLIC_* gets inlined at build time, so it can't vary per
  // environment from a single image — the container's value would never
  // win. APP_ENV is read on every server render (force-dynamic above),
  // so the deploy overlay's per-env value lands in the HTML at runtime.
  const appEnvironment = process.env.APP_ENV?.toLowerCase() ?? "development";
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

  // Dark only when explicitly stored as "dark", or stored as "system" and the
  // OS prefers dark. Anything else (unset, legacy or corrupted writes) stays
  // light, mirroring getStoredTheme's DEFAULT_THEME fallback.
  const themeBootstrapScript = `(function(){try{var t=localStorage.getItem("mark-theme");var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.setAttribute("data-color-mode",d?"dark":"light");}catch(e){}})();`;

  return (
    <html
      lang="en"
      className="h-full"
      // SSR fallback so @uiw markdown surfaces stay light when the bootstrap
      // script can't run (blocked inline scripts, storage errors, no JS).
      data-color-mode="light"
      // The bootstrap script mutates class/data-color-mode before hydration.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
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
      <body className={`${inter.className} h-full m-0 p-0`}>
        <LayoutContent>{children}</LayoutContent>
      </body>
    </html>
  );
}
