import { type ReactNode } from "react";
import Header from "./(components)/Header";
import RouteUiTranslator from "@/components/RouteUiTranslator";
import PromoProvider from "@/components/promo/PromoProvider";

export default function RootLayout({ children }: { children: ReactNode }) {
  // Runtime switch (not NEXT_PUBLIC_, so it can vary per environment from a
  // single image). Read here on the server and provided to the client banners.
  const promoEnabled = process.env.PROMO_BANNERS_ENABLED === "true";

  return (
    <div
      id="learner-route-root"
      className="flex flex-col min-h-screen overflow-hidden"
    >
      <RouteUiTranslator scopeSelector="#learner-route-root" />
      <Header />
      <PromoProvider enabled={promoEnabled}>
        <div className="flex-1 overflow-auto">{children}</div>
      </PromoProvider>
    </div>
  );
}
