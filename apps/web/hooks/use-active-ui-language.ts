"use client";

import {
  DEFAULT_UI_LANGUAGE,
  UI_LANGUAGE_CHANGED_EVENT,
  getStoredUiLanguage,
  isSupportedUiLanguage,
  setStoredUiLanguage,
} from "@/lib/ui-language";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The UI language currently in effect: `?uiLang` if it names a supported
 * language (which is then remembered), otherwise the stored choice, otherwise
 * the default. Stays in sync with `UI_LANGUAGE_CHANGED_EVENT`.
 *
 * Single source of truth on purpose. `RouteUiTranslator` and
 * `useUiTranslation` both need this while translation is being migrated from
 * DOM rewriting to render-time lookup, and two copies of the resolution rules
 * would eventually disagree — which shows up as a half-translated page.
 */
export function useActiveUiLanguage(): string {
  const searchParams = useSearchParams();
  const queryLanguage = searchParams.get("uiLang");
  const [activeLanguage, setActiveLanguage] =
    useState<string>(DEFAULT_UI_LANGUAGE);

  useEffect(() => {
    if (isSupportedUiLanguage(queryLanguage)) {
      setActiveLanguage(queryLanguage);
      setStoredUiLanguage(queryLanguage);
      return;
    }

    setActiveLanguage(getStoredUiLanguage() || DEFAULT_UI_LANGUAGE);
  }, [queryLanguage]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleLanguageChange = (event: Event) => {
      const selectedLanguage = (event as CustomEvent<string>).detail;
      if (!isSupportedUiLanguage(selectedLanguage)) return;
      setActiveLanguage(selectedLanguage);
    };

    window.addEventListener(
      UI_LANGUAGE_CHANGED_EVENT,
      handleLanguageChange as EventListener,
    );

    return () => {
      window.removeEventListener(
        UI_LANGUAGE_CHANGED_EVENT,
        handleLanguageChange as EventListener,
      );
    };
  }, []);

  return activeLanguage;
}
