"use client";

import { getStaticUiTranslationsSync } from "@/lib/static-ui-translations";
import {
  DEFAULT_UI_LANGUAGE,
  UI_LANGUAGE_CHANGED_EVENT,
  getStoredUiLanguage,
  isSupportedUiLanguage,
} from "@/lib/ui-language";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export type UiTranslationParams = Record<string, string | number>;

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

export function interpolate(
  template: string,
  params?: UiTranslationParams,
): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER_PATTERN, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * Resolves a user-facing string during render, against the same catalogs
 * `RouteUiTranslator` uses.
 *
 * Prefer this over letting RouteUiTranslator rewrite the DOM afterwards. The
 * source string is the key, so nothing changes for English, and an untranslated
 * key falls back to that source — the same result the DOM translator produces
 * today, so converting a string can never regress it.
 *
 * Runtime values must be passed as `params`, never concatenated into the source:
 *
 *   t("Please wait {time} before retrying", { time })
 *
 * Concatenating instead produces a different string on every change, which no
 * catalog can key on and which forces the DOM translator to re-scan the route.
 * Passing them keeps one stable, translatable sentence and lets each language
 * order the words however it needs to.
 *
 * Mark the element rendering a converted string with `data-no-ui-translate="true"`
 * so RouteUiTranslator neither rewrites nor re-scans what is already translated.
 */
export function useUiTranslation() {
  const searchParams = useSearchParams();
  const queryLanguage = searchParams.get("uiLang");
  const [activeLanguage, setActiveLanguage] =
    useState<string>(DEFAULT_UI_LANGUAGE);

  useEffect(() => {
    if (isSupportedUiLanguage(queryLanguage)) {
      setActiveLanguage(queryLanguage);
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
    return () =>
      window.removeEventListener(
        UI_LANGUAGE_CHANGED_EVENT,
        handleLanguageChange as EventListener,
      );
  }, []);

  const t = useCallback(
    (source: string, params?: UiTranslationParams): string => {
      if (activeLanguage === DEFAULT_UI_LANGUAGE) {
        return interpolate(source, params);
      }
      const translated =
        getStaticUiTranslationsSync(activeLanguage)[source] ?? source;
      return interpolate(translated, params);
    },
    [activeLanguage],
  );

  return { t, activeLanguage };
}
