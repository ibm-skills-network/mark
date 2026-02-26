import { type ReactNode } from "react";
import Header from "./(components)/Header";
import RouteUiTranslator from "@/components/RouteUiTranslator";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <div
      id="learner-route-root"
      className="flex flex-col min-h-screen overflow-hidden"
    >
      <RouteUiTranslator scopeSelector="#learner-route-root" />
      <Header />
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
