"use client";

import { resolveUiTranslation } from "@/components/RouteUiTranslator";
import { useActiveUiLanguage } from "@/hooks/use-active-ui-language";
import { DEFAULT_UI_LANGUAGE } from "@/lib/ui-language";
import { useCallback } from "react";

export type UiTranslationParams = Record<string, string | number>;

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

export function interpolate(
  template: string,
  params?: UiTranslationParams,
): string {
  if (!params) return template;
  // `hasOwn`, not `in`: `in` reaches Object.prototype, so a `{constructor}` or
  // `{toString}` placeholder would render a function body instead of surviving
  // untouched.
  return template.replace(PLACEHOLDER_PATTERN, (match, key: string) =>
    Object.hasOwn(params, key) ? String(params[key]) : match,
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
  const activeLanguage = useActiveUiLanguage();

  const t = useCallback(
    (source: string, params?: UiTranslationParams): string => {
      if (activeLanguage === DEFAULT_UI_LANGUAGE) {
        return interpolate(source, params);
      }

      return interpolate(resolveUiTranslation(activeLanguage, source), params);
    },
    [activeLanguage],
  );

  return { t, activeLanguage };
}
