"use client";

import { DEFAULT_UI_LANGUAGE } from "@/lib/ui-language";
import { useActiveUiLanguage } from "@/hooks/use-active-ui-language";
import {
  getStaticUiTranslations,
  normalizeSourceText,
} from "@/lib/static-ui-translations";
import { trueFalseTranslations } from "@/app/Helpers/Languages/TrueFalseInAllLang";
import { useEffect, useRef } from "react";

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

// What this translator last wrote into each node/attribute. Anything that does
// not match is content the app rewrote, which must become the new source text —
// otherwise a node stays pinned to its first text and every pass restores it.
const lastWrittenTextByNode = new WeakMap<Text, string>();
const lastWrittenAttrsByElement = new WeakMap<Element, Map<string, string>>();

interface RouteUiTranslatorProps {
  scopeSelector?: string;
}

function isTranslatableText(value: string): boolean {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return false;
  if (!/\p{L}/u.test(trimmed)) return false;
  return trimmed.length <= 1000;
}

export function isInsideOptedOutSubtree(node: Node | null): boolean {
  const element =
    node instanceof Element ? node : (node?.parentElement ?? null);
  return Boolean(element?.closest("[data-no-ui-translate='true']"));
}

const SKIP_TAGS_SELECTOR = "script,style,noscript,code,pre,textarea";

// Ancestry-aware: translateScope can now be handed any mutated subtree, so a
// scope root buried inside a code block or opted-out region must be refused
// here, not just direct children of a skipped element.
function shouldSkipElement(element: Element | null): boolean {
  if (!element) return true;
  if (isInsideOptedOutSubtree(element)) return true;
  if (element.closest(SKIP_TAGS_SELECTOR)) return true;

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

// Subtree-root variant for the tree walker: checks only the element's own
// state, because the walker prunes at the topmost skipped element and never
// descends past it.
function isSkippedSubtreeRoot(element: Element): boolean {
  if (element.matches("[data-no-ui-translate='true']")) return true;
  if (SKIP_TAGS.has(element.tagName)) return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

// Attribute carriers get a looser filter than text nodes: SKIP_TAGS and the
// input-type check exist to keep the translator out of user-entered *content*
// (code blocks, field values). placeholder/title/aria-label are chrome, not
// content, so an input's placeholder must translate even though its value
// must not.
function shouldSkipAttrCarrier(element: Element): boolean {
  if (isInsideOptedOutSubtree(element)) return true;
  return Boolean(element.closest("script,style,noscript"));
}

function getRootElement(scopeSelector?: string): HTMLElement | null {
  if (typeof document === "undefined") return null;

  if (!scopeSelector) return document.body;
  const node = document.querySelector(scopeSelector);
  return node instanceof HTMLElement ? node : null;
}

function collectTextNodes(root: HTMLElement): Text[] {
  if (shouldSkipElement(root)) return [];

  // Elements are filtered with FILTER_REJECT so a skipped subtree is pruned
  // in one step instead of every text node inside it re-walking its ancestry.
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return isSkippedSubtreeRoot(node as Element)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP;
        }
        return isTranslatableText(node.textContent || "")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    },
  );

  // Elements are FILTER_SKIPped above, so the walker only ever returns text.
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
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
      if (shouldSkipAttrCarrier(element)) continue;

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
  // Null prototype: lookups here are keyed on arbitrary UI strings, and a
  // source like "constructor" must miss rather than resolve to a function
  // inherited from Object.prototype.
  const augmentedTranslations: Record<string, string> = Object.create(null);

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

// Exported so tests can exercise the real translation path: translateScope
// reads the loaded catalog, and without loading one it returns every string
// unchanged and proves nothing.
export function ensureLanguageTranslationsLoaded(languageCode: string): void {
  if (languageCode === DEFAULT_UI_LANGUAGE) return;
  if (STATIC_TRANSLATIONS.has(languageCode)) return;

  const translations = getStaticUiTranslations(languageCode);
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
  const normalizedTranslations: Record<string, string> = Object.create(null);
  for (const [sourceText, translatedText] of Object.entries(
    augmentedTranslations,
  )) {
    normalizedTranslations[normalizeSourceText(sourceText)] = translatedText;
  }
  NORMALIZED_STATIC_TRANSLATIONS.set(languageCode, normalizedTranslations);
}

// Render-time resolution for `useUiTranslation`, through the same layers the
// DOM path uses — augmented aliases, normalized keys, word-token fallback. A
// separate raw-catalog lookup in the hook would let the same string translate
// on one path and not the other.
export function resolveUiTranslation(
  languageCode: string,
  sourceText: string,
): string {
  if (languageCode === DEFAULT_UI_LANGUAGE) return sourceText;
  ensureLanguageTranslationsLoaded(languageCode);
  ensureTranslationCache(languageCode, [sourceText]);
  return (
    TRANSLATION_CACHE.get(getCacheKey(languageCode, sourceText)) ?? sourceText
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
  const currentText = node.textContent || "";
  const lastWritten = lastWrittenTextByNode.get(node);
  // Re-baseline when the app changed this node since our last write.
  const wasRewrittenByApp =
    lastWritten !== undefined && currentText !== lastWritten;

  if (!originalTextByNode.has(node) || wasRewrittenByApp) {
    originalTextByNode.set(node, currentText);
  }
  return originalTextByNode.get(node) || "";
}

function writeTextTranslation(node: Text, value: string): void {
  if (node.textContent !== value) {
    node.textContent = value;
  }
  lastWrittenTextByNode.set(node, value);
}

function readAttrOriginal(element: Element, attribute: string): string {
  const existingMap =
    originalAttrsByElement.get(element) || new Map<string, string>();
  if (!originalAttrsByElement.has(element)) {
    originalAttrsByElement.set(element, existingMap);
  }

  const currentValue = element.getAttribute(attribute) || "";
  const lastWritten = lastWrittenAttrsByElement.get(element)?.get(attribute);
  const wasRewrittenByApp =
    lastWritten !== undefined && currentValue !== lastWritten;

  if (!existingMap.has(attribute) || wasRewrittenByApp) {
    existingMap.set(attribute, currentValue);
  }
  return existingMap.get(attribute) || "";
}

function writeAttrTranslation(
  element: Element,
  attribute: string,
  value: string,
): void {
  if (element.getAttribute(attribute) !== value) {
    element.setAttribute(attribute, value);
  }
  const written =
    lastWrittenAttrsByElement.get(element) || new Map<string, string>();
  written.set(attribute, value);
  lastWrittenAttrsByElement.set(element, written);
}

export function translateScope(root: HTMLElement, languageCode: string) {
  const textNodes = collectTextNodes(root);
  const attrTargets = collectAttrTargets(root);

  if (languageCode === DEFAULT_UI_LANGUAGE) {
    for (const textNode of textNodes) {
      writeTextTranslation(textNode, readTextOriginal(textNode));
    }

    for (const { element, attribute } of attrTargets) {
      writeAttrTranslation(
        element,
        attribute,
        readAttrOriginal(element, attribute),
      );
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

    writeTextTranslation(textNode, translatedWithPadding);
  }

  for (const { element, attribute } of attrTargets) {
    const originalValue = readAttrOriginal(element, attribute);
    const normalizedOriginalValue = normalizeSourceText(originalValue);
    if (!normalizedOriginalValue) continue;
    const translatedValue =
      TRANSLATION_CACHE.get(getCacheKey(languageCode, originalValue)) ||
      normalizedOriginalValue;
    writeAttrTranslation(element, attribute, translatedValue);
  }
}

// Above this many distinct mutated subtrees per debounce window, give up on
// scoping and run one full pass — the bookkeeping would cost more than the
// walk it saves.
const MAX_SCOPED_TARGETS = 24;

// The element whose subtree a mutation record dirties: the target itself for
// childList/attribute records, its parent for characterData on a text node.
function recordScopeElement(record: MutationRecord): HTMLElement | null {
  const target = record.target;
  return target instanceof HTMLElement ? target : target.parentElement;
}

// Drop any scope contained by another so a subtree is not walked twice.
function pruneNestedScopes(scopes: HTMLElement[]): HTMLElement[] {
  return scopes.filter((scope) =>
    scopes.every((other) => other === scope || !other.contains(scope)),
  );
}

export default function RouteUiTranslator({
  scopeSelector,
}: RouteUiTranslatorProps) {
  const activeLanguage = useActiveUiLanguage();
  const debounceTimerRef = useRef<number | null>(null);

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

    // Mutated subtrees awaiting the next pass; null means the next pass walks
    // every translation root.
    let pendingScopes: Set<HTMLElement> | null = null;

    const runTranslation = (scopes: HTMLElement[] | null) => {
      try {
        for (const root of scopes ?? getTranslationRoots()) {
          translateScope(root, activeLanguage);
        }
      } catch (error) {
        console.error("UI translation failed:", error);
      } finally {
        // Discard the records our own writes just queued — records are
        // delivered after this synchronous pass ends, so without this every
        // effective pass schedules one more that no-ops.
        observer.takeRecords();
      }
    };

    const scheduleTranslation = () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = window.setTimeout(() => {
        const scopes = pendingScopes;
        pendingScopes = new Set();
        runTranslation(
          scopes === null ? null : pruneNestedScopes(Array.from(scopes)),
        );
      }, 120);
    };

    const observer = new MutationObserver((records) => {
      const translationRoots = getTranslationRoots();
      let sawRelevantRecord = false;

      for (const record of records) {
        const scopeElement = recordScopeElement(record);
        if (!scopeElement) continue;
        // Opted-out subtrees are never rewritten, and mutations outside every
        // translation root (chat panel, toasts, body-level portals) cannot
        // change route content — scanning for either is pure cost.
        if (isInsideOptedOutSubtree(scopeElement)) continue;
        if (!translationRoots.some((root) => root.contains(scopeElement))) {
          continue;
        }

        sawRelevantRecord = true;
        if (pendingScopes !== null) {
          pendingScopes.add(scopeElement);
          if (pendingScopes.size > MAX_SCOPED_TARGETS) {
            pendingScopes = null;
          }
        }
      }

      if (sawRelevantRecord) {
        scheduleTranslation();
      }
    });

    // Loading the catalog is a synchronous lookup, so the observer attaches in
    // the same tick as the effect — no gap in which mutations go unobserved.
    ensureLanguageTranslationsLoaded(activeLanguage);

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
    });

    pendingScopes = new Set();
    runTranslation(null);

    return () => {
      observer.disconnect();
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [activeLanguage, scopeSelector]);

  return null;
}
