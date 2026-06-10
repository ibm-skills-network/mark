"use client";

import { createContext, useContext, type ReactNode } from "react";

interface PromoContextValue {
  /** Master on/off switch, resolved server-side from PROMO_BANNERS_ENABLED. */
  enabled: boolean;
}

const PromoContext = createContext<PromoContextValue>({ enabled: false });

/**
 * Provides the runtime promo on/off flag to client components below it.
 * Rendered by the (server) learner layout, which reads the env var at request
 * time and passes it down — mirroring how APP_ENV is threaded elsewhere.
 */
export default function PromoProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <PromoContext.Provider value={{ enabled }}>
      {children}
    </PromoContext.Provider>
  );
}

export function usePromo(): PromoContextValue {
  return useContext(PromoContext);
}
