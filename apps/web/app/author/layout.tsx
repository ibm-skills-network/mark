import Header from "./(components)/Header";
import { BottomVersionBar } from "@/components/version-control/BottomVersionBar";
import RouteUiTranslator from "@/components/RouteUiTranslator";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div id="author-route-root" className="contents">
      <RouteUiTranslator scopeSelector="#author-route-root" />
      <Header />
      <div className="bg-gray-50 flex flex-col flex-1 pt-28 pb-16 h-screen overflow-auto">
        {children}
      </div>
      <BottomVersionBar />
    </div>
  );
}
