import { type ReactNode } from "react";
import Header from "./(components)/Header";
import RouteUiTranslator from "@/components/RouteUiTranslator";
import PromoProvider from "@/components/promo/PromoProvider";

export default function RootLayout({ children }: { children: ReactNode }) {
  // Runtime switch (not NEXT_PUBLIC_, so it can vary per environment from a
  // single image). Read here on the server and provided to the client banners.
  const promoEnabled = process.env.PROMO_BANNERS_ENABLED === "true";

  return (
    // A definite height, not a minimum: with `min-h-screen` the column had no
    // definite main size, so the content pane grew to its own height instead
    // of taking what the header left, and the whole route (header included)
    // was pushed out of view by the difference. Every header height now works,
    // including the stacked header's two or three rows.
    <div
      id="learner-route-root"
      className="flex flex-col h-screen overflow-hidden"
    >
      <RouteUiTranslator scopeSelector="#learner-route-root" />
      <Header />
      <PromoProvider enabled={promoEnabled}>
        <div className="flex-1 min-h-0 overflow-auto">{children}</div>
      </PromoProvider>
    </div>
  );
}
