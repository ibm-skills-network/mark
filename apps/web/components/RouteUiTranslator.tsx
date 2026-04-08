"use client";

import {
  DEFAULT_UI_LANGUAGE,
  getStoredUiLanguage,
  isSupportedUiLanguage,
  setStoredUiLanguage,
  UI_LANGUAGE_CHANGED_EVENT,
} from "@/lib/ui-language";
import { getStaticUiTranslations } from "@/lib/static-ui-translations";
import { trueFalseTranslations } from "@/app/Helpers/Languages/TrueFalseInAllLang";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const TRANSLATABLE_ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;
const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "CODE",
  "PRE",
  "TEXTAREA",
]);
const TRANSLATION_CACHE = new Map<string, string>();
const STATIC_TRANSLATIONS = new Map<string, Record<string, string>>();
const NORMALIZED_STATIC_TRANSLATIONS = new Map<
  string,
  Record<string, string>
>();

const originalTextByNode = new WeakMap<Text, string>();
const originalAttrsByElement = new WeakMap<Element, Map<string, string>>();

interface RouteUiTranslatorProps {
  scopeSelector?: string;
}

function isTranslatableText(value: string): boolean {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return false;
  if (!/\p{L}/u.test(trimmed)) return false;
  return trimmed.length <= 1000;
}

function shouldSkipElement(element: Element | null): boolean {
  if (!element) return true;
  if (element.closest("[data-no-ui-translate='true']")) return true;
  if (SKIP_TAGS.has(element.tagName)) return true;

  if (element instanceof HTMLElement) {
    if (element.isContentEditable) return true;
    if (
      element instanceof HTMLInputElement &&
      !["button", "submit", "reset"].includes(element.type)
    ) {
      return true;
    }
  }

  return false;
}

function getRootElement(scopeSelector?: string): HTMLElement | null {
  if (typeof document === "undefined") return null;

  if (!scopeSelector) return document.body;
  const node = document.querySelector(scopeSelector);
  return node instanceof HTMLElement ? node : null;
}

function collectTextNodes(root: HTMLElement): Text[] {
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || shouldSkipElement(parent)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!isTranslatableText(node.textContent || "")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      textNodes.push(node as Text);
    }
    node = walker.nextNode();
  }

  return textNodes;
}

function collectAttrTargets(root: HTMLElement): Array<{
  element: Element;
  attribute: (typeof TRANSLATABLE_ATTRIBUTES)[number];
}> {
  const targets: Array<{
    element: Element;
    attribute: (typeof TRANSLATABLE_ATTRIBUTES)[number];
  }> = [];

  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    const elements: Element[] = [];

    if (root.hasAttribute(attribute)) {
      elements.push(root);
    }
    elements.push(...Array.from(root.querySelectorAll(`[${attribute}]`)));

    for (const element of elements) {
      if (shouldSkipElement(element)) continue;

      const value = element.getAttribute(attribute);
      if (!value || !isTranslatableText(value)) continue;

      targets.push({ element, attribute });
    }
  }

  return targets;
}

function getCacheKey(languageCode: string, sourceText: string): string {
  return `${languageCode}::${normalizeSourceText(sourceText)}`;
}

function normalizeSourceText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function withOriginalPadding(original: string, translatedCore: string): string {
  const leadingWhitespaceMatch = original.match(/^\s*/u);
  const trailingWhitespaceMatch = original.match(/\s*$/u);
  const leadingWhitespace = leadingWhitespaceMatch?.[0] || "";
  const trailingWhitespace = trailingWhitespaceMatch?.[0] || "";

  return `${leadingWhitespace}${translatedCore}${trailingWhitespace}`;
}

function addTranslationAlias(
  target: Record<string, string>,
  sourceText: string,
  translatedText: string,
): void {
  const normalizedSource = normalizeSourceText(sourceText);
  if (!normalizedSource) return;
  if (target[normalizedSource]) return;
  target[normalizedSource] = translatedText;
}

function getFirstAvailableTranslation(
  translations: Record<string, string>,
  sourceTexts: string[],
): string | undefined {
  for (const sourceText of sourceTexts) {
    const normalizedSource = normalizeSourceText(sourceText);
    if (!normalizedSource) continue;
    const translatedText = translations[normalizedSource];
    if (translatedText) return translatedText;
  }
  return undefined;
}

function translateWordTokens(
  value: string,
  languageTranslations: Record<string, string>,
  normalizedTranslations: Record<string, string> | undefined,
): string {
  return value.replace(/\b[\p{L}][\p{L}\-']*\b/gu, (word) => {
    const normalizedWord = normalizeSourceText(word);
    return (
      languageTranslations[word] ||
      languageTranslations[normalizedWord] ||
      languageTranslations[word.toLowerCase()] ||
      languageTranslations[word.toUpperCase()] ||
      normalizedTranslations?.[normalizedWord] ||
      normalizedTranslations?.[word.toLowerCase()] ||
      word
    );
  });
}

function buildAugmentedTranslations(
  languageCode: string,
  translations: Record<string, string>,
): Record<string, string> {
  const augmentedTranslations: Record<string, string> = {};

  for (const [sourceText, translatedText] of Object.entries(translations)) {
    const normalizedSource = normalizeSourceText(sourceText);
    if (!normalizedSource) continue;

    augmentedTranslations[normalizedSource] = translatedText;

    const numberedSourceMatch = normalizedSource.match(/^\d+[.)]?\s+(.+)$/u);
    if (numberedSourceMatch) {
      const numberedTranslatedMatch =
        normalizeSourceText(translatedText).match(/^\d+[.)]?\s+(.+)$/u);
      addTranslationAlias(
        augmentedTranslations,
        numberedSourceMatch[1],
        numberedTranslatedMatch?.[1] || translatedText,
      );
    }

    const quantitySourceMatch = normalizedSource.match(/^\d+\s+(.+)$/u);
    const quantityTranslatedMatch =
      normalizeSourceText(translatedText).match(/^\d+\s+(.+)$/u);
    if (quantitySourceMatch && quantityTranslatedMatch) {
      addTranslationAlias(
        augmentedTranslations,
        quantitySourceMatch[1],
        quantityTranslatedMatch[1],
      );
    }

    if (normalizedSource.includes("(s)")) {
      const singularKey = normalizedSource.replace(/\(s\)/g, "");
      const pluralKey = normalizedSource.replace(/\(s\)/g, "s");
      addTranslationAlias(augmentedTranslations, singularKey, translatedText);
      addTranslationAlias(augmentedTranslations, pluralKey, translatedText);
    }
  }

  const trueFalseLanguageCode =
    languageCode in trueFalseTranslations
      ? languageCode
      : languageCode.split("-")[0];
  const trueFalseTranslation = trueFalseTranslations[trueFalseLanguageCode];
  if (trueFalseTranslation) {
    const trueFalseLabel = `${trueFalseTranslation.true}/${trueFalseTranslation.false}`;
    addTranslationAlias(augmentedTranslations, "True/False", trueFalseLabel);
    addTranslationAlias(
      augmentedTranslations,
      "True / False",
      `${trueFalseTranslation.true} / ${trueFalseTranslation.false}`,
    );
    addTranslationAlias(augmentedTranslations, "TRUE_FALSE", trueFalseLabel);
  }

  const textResponseTranslation = augmentedTranslations["Text Response"];
  if (textResponseTranslation) {
    addTranslationAlias(augmentedTranslations, "TEXT", textResponseTranslation);
  }

  const uploadTranslation = augmentedTranslations.Upload;
  if (uploadTranslation) {
    addTranslationAlias(augmentedTranslations, "UPLOAD", uploadTranslation);
  }

  const fileOrLinkTranslation = augmentedTranslations["File or Link"];
  if (fileOrLinkTranslation) {
    addTranslationAlias(
      augmentedTranslations,
      "LINK_FILE",
      fileOrLinkTranslation,
    );
  }

  const multipleChoiceTranslation = augmentedTranslations["Multiple Choice"];
  if (multipleChoiceTranslation) {
    addTranslationAlias(
      augmentedTranslations,
      "SINGLE_CORRECT",
      multipleChoiceTranslation,
    );
  }

  const multipleSelectTranslation = augmentedTranslations["Multiple Select"];
  if (multipleSelectTranslation) {
    addTranslationAlias(
      augmentedTranslations,
      "MULTIPLE_CORRECT",
      multipleSelectTranslation,
    );
  }

  const urlLinkTranslation = augmentedTranslations["URL Link"];
  if (urlLinkTranslation) {
    addTranslationAlias(augmentedTranslations, "URL", urlLinkTranslation);
  }

  const unlimitedTranslation = augmentedTranslations.Unlimited;
  if (unlimitedTranslation) {
    addTranslationAlias(
      augmentedTranslations,
      "unlimited",
      unlimitedTranslation,
    );
  }

  const questionTranslation = augmentedTranslations.Question;
  if (questionTranslation) {
    addTranslationAlias(augmentedTranslations, "question", questionTranslation);
    addTranslationAlias(
      augmentedTranslations,
      "questions",
      questionTranslation,
    );
  }

  const attemptTranslation = augmentedTranslations.Attempt;
  if (attemptTranslation) {
    addTranslationAlias(augmentedTranslations, "attempt", attemptTranslation);
    addTranslationAlias(augmentedTranslations, "attempts", attemptTranslation);
  }

  const noQuestionsFoundTranslation = getFirstAvailableTranslation(
    augmentedTranslations,
    ["No questions found.", "No questions added yet."],
  );
  if (noQuestionsFoundTranslation) {
    addTranslationAlias(
      augmentedTranslations,
      "No questions have been answered",
      noQuestionsFoundTranslation,
    );
    addTranslationAlias(
      augmentedTranslations,
      "No valid responses to submit",
      noQuestionsFoundTranslation,
    );
  }

  const submitAssignmentTranslation = getFirstAvailableTranslation(
    augmentedTranslations,
    ["Submit assignment", "Submit"],
  );
  if (submitAssignmentTranslation) {
    addTranslationAlias(
      augmentedTranslations,
      "Submitting assignment...",
      submitAssignmentTranslation,
    );
  }

  const uploadProgressTranslation = getFirstAvailableTranslation(
    augmentedTranslations,
    ["Upload", "File Upload"],
  );
  if (uploadProgressTranslation) {
    addTranslationAlias(
      augmentedTranslations,
      "File upload in progress...",
      uploadProgressTranslation,
    );
  }

  return augmentedTranslations;
}

function resolveDynamicTranslation(
  sourceText: string,
  languageTranslations: Record<string, string>,
  normalizedTranslations: Record<string, string> | undefined,
): string | null {
  const normalizedSourceText = normalizeSourceText(sourceText);
  if (!normalizedSourceText) return null;

  const numberedPrefixMatch =
    normalizedSourceText.match(/^(\d+[.)]?\s+)(.+)$/u);
  if (numberedPrefixMatch) {
    const normalizedRemainder = normalizeSourceText(numberedPrefixMatch[2]);
    const exactRemainderTranslation =
      languageTranslations[numberedPrefixMatch[2]] ||
      languageTranslations[normalizedRemainder] ||
      normalizedTranslations?.[normalizedRemainder];
    if (exactRemainderTranslation) {
      return `${numberedPrefixMatch[1]}${exactRemainderTranslation}`;
    }

    const translatedRemainder = translateWordTokens(
      numberedPrefixMatch[2],
      languageTranslations,
      normalizedTranslations,
    );
    if (translatedRemainder !== numberedPrefixMatch[2]) {
      return `${numberedPrefixMatch[1]}${translatedRemainder}`;
    }
  }

  if (!/\d/u.test(normalizedSourceText)) return null;

  const translatedWithTokenFallback = translateWordTokens(
    normalizedSourceText,
    languageTranslations,
    normalizedTranslations,
  );

  return translatedWithTokenFallback !== normalizedSourceText
    ? translatedWithTokenFallback
    : null;
}

function fetchTranslationsForBatch(
  languageCode: string,
  texts: string[],
): Record<string, string> {
  const languageTranslations = STATIC_TRANSLATIONS.get(languageCode);
  const normalizedTranslations =
    NORMALIZED_STATIC_TRANSLATIONS.get(languageCode);
  if (!languageTranslations) {
    return Object.fromEntries(texts.map((text) => [text, text]));
  }

  const results: Record<string, string> = {};
  for (const text of texts) {
    const normalizedText = normalizeSourceText(text);
    const exactTranslation =
      languageTranslations[text] ||
      languageTranslations[normalizedText] ||
      normalizedTranslations?.[normalizedText];

    if (exactTranslation) {
      results[text] = exactTranslation;
      continue;
    }

    const dynamicTranslation = resolveDynamicTranslation(
      normalizedText,
      languageTranslations,
      normalizedTranslations,
    );
    results[text] = dynamicTranslation || text;
  }
  return results;
}

async function ensureLanguageTranslationsLoaded(
  languageCode: string,
): Promise<void> {
  if (languageCode === DEFAULT_UI_LANGUAGE) return;
  if (STATIC_TRANSLATIONS.has(languageCode)) return;

  const translations = await getStaticUiTranslations(languageCode);
  const augmentedTranslations = buildAugmentedTranslations(
    languageCode,
    translations,
  );
  // Clear any fallback entries cached before this language map was loaded.
  for (const cacheKey of Array.from(TRANSLATION_CACHE.keys())) {
    if (cacheKey.startsWith(`${languageCode}::`)) {
      TRANSLATION_CACHE.delete(cacheKey);
    }
  }

  STATIC_TRANSLATIONS.set(languageCode, augmentedTranslations);
  NORMALIZED_STATIC_TRANSLATIONS.set(
    languageCode,
    Object.fromEntries(
      Object.entries(augmentedTranslations).map(
        ([sourceText, translatedText]) => [
          normalizeSourceText(sourceText),
          translatedText,
        ],
      ),
    ),
  );
}

function ensureTranslationCache(
  languageCode: string,
  sourceTexts: string[],
): void {
  const missingTexts = sourceTexts.filter(
    (text) => !TRANSLATION_CACHE.has(getCacheKey(languageCode, text)),
  );

  if (missingTexts.length === 0) return;

  const BATCH_SIZE = 40;
  for (let index = 0; index < missingTexts.length; index += BATCH_SIZE) {
    const batch = missingTexts.slice(index, index + BATCH_SIZE);
    const translations = fetchTranslationsForBatch(languageCode, batch);

    for (const text of batch) {
      TRANSLATION_CACHE.set(
        getCacheKey(languageCode, text),
        translations[text] || text,
      );
    }
  }
}

function readTextOriginal(node: Text): string {
  if (!originalTextByNode.has(node)) {
    originalTextByNode.set(node, node.textContent || "");
  }
  return originalTextByNode.get(node) || "";
}

function readAttrOriginal(element: Element, attribute: string): string {
  const existingMap =
    originalAttrsByElement.get(element) || new Map<string, string>();
  if (!originalAttrsByElement.has(element)) {
    originalAttrsByElement.set(element, existingMap);
  }
  if (!existingMap.has(attribute)) {
    existingMap.set(attribute, element.getAttribute(attribute) || "");
  }
  return existingMap.get(attribute) || "";
}

function translateScope(root: HTMLElement, languageCode: string) {
  const textNodes = collectTextNodes(root);
  const attrTargets = collectAttrTargets(root);

  if (languageCode === DEFAULT_UI_LANGUAGE) {
    for (const textNode of textNodes) {
      const originalText = readTextOriginal(textNode);
      if (textNode.textContent !== originalText) {
        textNode.textContent = originalText;
      }
    }

    for (const { element, attribute } of attrTargets) {
      const originalValue = readAttrOriginal(element, attribute);
      if (element.getAttribute(attribute) !== originalValue) {
        element.setAttribute(attribute, originalValue);
      }
    }

    return;
  }

  const sourceTextSet = new Set<string>();

  for (const textNode of textNodes) {
    const normalized = normalizeSourceText(readTextOriginal(textNode));
    if (normalized) {
      sourceTextSet.add(normalized);
    }
  }

  for (const { element, attribute } of attrTargets) {
    const normalized = normalizeSourceText(
      readAttrOriginal(element, attribute),
    );
    if (normalized) {
      sourceTextSet.add(normalized);
    }
  }

  const sourceTexts = Array.from(sourceTextSet);
  ensureTranslationCache(languageCode, sourceTexts);

  for (const textNode of textNodes) {
    const originalText = readTextOriginal(textNode);
    const normalizedOriginalText = normalizeSourceText(originalText);
    if (!normalizedOriginalText) continue;
    const translatedText =
      TRANSLATION_CACHE.get(getCacheKey(languageCode, originalText)) ||
      normalizedOriginalText;

    const translatedWithPadding = withOriginalPadding(
      originalText,
      translatedText,
    );

    if (textNode.textContent !== translatedWithPadding) {
      textNode.textContent = translatedWithPadding;
    }
  }

  for (const { element, attribute } of attrTargets) {
    const originalValue = readAttrOriginal(element, attribute);
    const normalizedOriginalValue = normalizeSourceText(originalValue);
    if (!normalizedOriginalValue) continue;
    const translatedValue =
      TRANSLATION_CACHE.get(getCacheKey(languageCode, originalValue)) ||
      normalizedOriginalValue;
    if (element.getAttribute(attribute) !== translatedValue) {
      element.setAttribute(attribute, translatedValue);
    }
  }
}

export default function RouteUiTranslator({
  scopeSelector,
}: RouteUiTranslatorProps) {
  const searchParams = useSearchParams();
  const queryLanguage = searchParams.get("uiLang");
  const [activeLanguage, setActiveLanguage] =
    useState<string>(DEFAULT_UI_LANGUAGE);
  const isApplyingRef = useRef(false);
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isSupportedUiLanguage(queryLanguage)) {
      setActiveLanguage(queryLanguage);
      setStoredUiLanguage(queryLanguage);
      return;
    }

    const storedLanguage = getStoredUiLanguage();
    setActiveLanguage(storedLanguage || DEFAULT_UI_LANGUAGE);
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

  useEffect(() => {
    const rootElement = getRootElement(scopeSelector);
    if (!rootElement) return;

    document.documentElement.lang = activeLanguage;

    const getTranslationRoots = (): HTMLElement[] => {
      const roots: HTMLElement[] = [rootElement];
      const dropdownPortal = document.getElementById("dropdown-portal");
      if (dropdownPortal instanceof HTMLElement) {
        roots.push(dropdownPortal);
      }
      return roots;
    };

    const runTranslation = () => {
      if (isApplyingRef.current) return;
      isApplyingRef.current = true;
      try {
        const translationRoots = getTranslationRoots();
        for (const root of translationRoots) {
          translateScope(root, activeLanguage);
        }
      } catch (error) {
        console.error("UI translation failed:", error);
      } finally {
        isApplyingRef.current = false;
      }
    };

    const observer = new MutationObserver(() => {
      if (isApplyingRef.current) return;
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = window.setTimeout(() => {
        runTranslation();
      }, 120);
    });

    let cancelled = false;

    const initializeTranslation = async () => {
      await ensureLanguageTranslationsLoaded(activeLanguage);
      if (cancelled) return;

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
      });

      runTranslation();
    };

    void initializeTranslation();

    return () => {
      cancelled = true;
      observer.disconnect();
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [activeLanguage, scopeSelector]);

  return null;
}
