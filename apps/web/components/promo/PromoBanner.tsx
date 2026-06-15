"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import {
  pickPromo,
  PROMO_COMPLETION,
  PROMO_PRE_START,
  type PromoItem,
} from "@/config/promo";
import { usePromo } from "./PromoProvider";

type Placement = "preStart" | "completion";

const ITEMS: Record<Placement, PromoItem[]> = {
  preStart: PROMO_PRE_START,
  completion: PROMO_COMPLETION,
};

/**
 * Subtle promotional banner. Renders nothing unless the feature is enabled
 * (runtime flag via PromoProvider) and the placement has content.
 *
 * The random item is chosen after mount rather than during render: these pages
 * are server-rendered client components, and picking during render would risk a
 * server/client hydration mismatch. A brief absence on first paint is fine for
 * an unobtrusive promo.
 */
export default function PromoBanner({ placement }: { placement: Placement }) {
  const { enabled } = usePromo();
  const [item, setItem] = useState<PromoItem | null>(null);

  useEffect(() => {
    if (!enabled) {
      setItem(null);
      return;
    }
    setItem(pickPromo(ITEMS[placement]));
  }, [enabled, placement]);

  if (!enabled || !item) return null;

  return (
    <aside
      aria-label="Sponsored"
      className="w-full flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3"
    >
      {item.imgSrc ? (
        // Plain <img> (not next/image): banner assets can be arbitrary hosts
        // not in next.config images config, and this also serves local /public
        // assets. Fixed box keeps layout stable regardless of aspect ratio.
        <img
          src={item.imgSrc}
          alt={item.imgAlt ?? ""}
          className="h-8 w-8 flex-shrink-0 rounded object-contain"
          loading="lazy"
        />
      ) : (
        <Sparkles
          className="h-5 w-5 text-violet-500 flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-violet-900">{item.title}</p>
        <p className="text-sm text-violet-800 mt-0.5">{item.blurb}</p>
      </div>
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-violet-700 hover:text-violet-900 inline-flex items-center gap-1 flex-shrink-0 mt-0.5"
      >
        {item.ctaText}
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </a>
    </aside>
  );
}
