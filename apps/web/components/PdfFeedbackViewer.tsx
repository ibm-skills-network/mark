"use client";

import { HighlightLevel, ResponseHighlighting } from "@/config/types";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { useMemo, useState, useEffect } from "react";

interface PdfFeedbackViewerProps {
  pdfUrl: string;
  highlighting?: ResponseHighlighting | string;
  strengths?: string[];
  needsWork?: string[];
  guidance?: string[];
  scoreRationale?: string;
  isModal?: boolean;
}

const highlightClass: Record<HighlightLevel, string> = {
  [HighlightLevel.CORRECT]: "bg-green-100 text-green-800 border-green-400",
  [HighlightLevel.PARTIAL]: "bg-amber-100 text-amber-800 border-amber-400",
  [HighlightLevel.INCORRECT]: "bg-rose-100 text-rose-800 border-rose-400",
  [HighlightLevel.NEUTRAL]: "bg-gray-100 text-gray-700 border-gray-300",
};

const highlightLabel: Record<HighlightLevel, string> = {
  [HighlightLevel.CORRECT]: "Correct",
  [HighlightLevel.PARTIAL]: "Partial",
  [HighlightLevel.INCORRECT]: "Needs work",
  [HighlightLevel.NEUTRAL]: "Info",
};

const highlightIcon: Record<HighlightLevel, JSX.Element> = {
  [HighlightLevel.CORRECT]: (
    <CheckCircleIcon className="h-4 w-4 text-green-600" />
  ),
  [HighlightLevel.PARTIAL]: (
    <ExclamationTriangleIcon className="h-4 w-4 text-amber-600" />
  ),
  [HighlightLevel.INCORRECT]: <XCircleIcon className="h-4 w-4 text-rose-600" />,
  [HighlightLevel.NEUTRAL]: (
    <div className="h-4 w-4 rounded-full bg-gray-400" />
  ),
};

const withPdfPageFragment = (url: string, page: number): string => {
  if (!url) return url;

  const baseUrl = url.split("#")[0];
  if (!Number.isFinite(page) || page < 1) {
    return baseUrl;
  }

  return `${baseUrl}#page=${page}`;
};

const renderHighlightCard = (
  highlight: any,
  index: number,
  highlightClass: Record<HighlightLevel, string>,
  highlightIcon: Record<HighlightLevel, JSX.Element>,
  highlightLabel: Record<HighlightLevel, string>,
  showPageNumber?: boolean,
) => {
  const commentMatch = highlight.comment?.match(
    /^\[([^\]]+)\]\s+\*\*([^*]+)\*\*\s+\(([^)]+)\):\s+(.+)$/,
  );

  if (commentMatch) {
    const [, status, criterion, points, feedback] = commentMatch;
    return (
      <div
        key={index}
        className={`rounded-lg border p-4 transition-all duration-300 ${highlightClass[highlight.level]} shadow-sm`}
      >
        <div className="mb-3 flex items-start gap-2">
          {highlightIcon[highlight.level]}
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs font-bold uppercase px-2 py-0.5 rounded bg-white/60 border border-current/20">
                {status}
              </span>
              <span className="text-xs font-semibold text-gray-700">
                {points}
              </span>
              {showPageNumber && highlight.page && (
                <span className="text-xs text-gray-600">
                  • Page {highlight.page}
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-gray-900 leading-snug">
              {criterion}
            </p>
          </div>
        </div>
        {highlight.text && (
          <div className="mb-3 rounded bg-white/50 border-l-3 border-current p-2.5">
            <p className="text-xs font-medium text-gray-600 mb-1.5">
              Referenced text:
            </p>
            <p className="text-xs italic text-gray-700 leading-relaxed">
              "{highlight.text.substring(0, 150)}
              {highlight.text.length > 150 ? "..." : ""}"
            </p>
          </div>
        )}
        <div className="rounded bg-white/30 p-2.5">
          <p className="text-sm leading-relaxed text-gray-900">
            {feedback.trim()}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      key={index}
      className={`rounded-lg border p-3 transition-all duration-300 ${highlightClass[highlight.level]}`}
    >
      <div className="mb-2 flex items-start gap-2">
        {highlightIcon[highlight.level]}
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase">
            {highlightLabel[highlight.level]}
            {showPageNumber && highlight.page && ` - Page ${highlight.page}`}
          </p>
        </div>
      </div>
      {highlight.text && (
        <p className="mb-2 border-l-2 border-current pl-2 text-xs italic text-gray-700">
          "{highlight.text.substring(0, showPageNumber ? 80 : 100)}
          {highlight.text.length > (showPageNumber ? 80 : 100) ? "..." : ""}"
        </p>
      )}
      <p className="text-sm leading-relaxed text-gray-800">
        {highlight.comment}
      </p>
    </div>
  );
};

export default function PdfFeedbackViewer({
  pdfUrl,
  highlighting,
  strengths = [],
  needsWork = [],
  guidance = [],
  scoreRationale,
  isModal = false,
}: PdfFeedbackViewerProps) {
  const [activeTab, setActiveTab] = useState<
    "feedback" | "highlights" | "currentPage"
  >("currentPage");
  const [currentPage, setCurrentPage] = useState<number>(1);

  const normalizedHighlighting = useMemo(() => {
    if (!highlighting) return undefined;

    if (typeof highlighting === "string") {
      try {
        return JSON.parse(highlighting) as ResponseHighlighting;
      } catch {
        return undefined;
      }
    }

    return highlighting;
  }, [highlighting]);

  const pagesArray = useMemo(() => {
    const pages = normalizedHighlighting?.pages;
    if (Array.isArray(pages)) {
      return pages;
    }

    if (pages && typeof pages === "object") {
      return Object.entries(pages as Record<string, unknown>).map(
        ([pageKey, pageValue]) => {
          if (
            pageValue &&
            typeof pageValue === "object" &&
            "highlights" in pageValue
          ) {
            const page = pageValue as {
              pageNumber?: number;
              highlights: unknown;
            };
            const pageNumber =
              typeof page.pageNumber === "number"
                ? page.pageNumber
                : Number.isFinite(Number(pageKey))
                  ? Number(pageKey)
                  : undefined;
            return {
              ...(pageValue as Record<string, unknown>),
              pageNumber,
            } as unknown as ResponseHighlighting;
          }

          if (Array.isArray(pageValue)) {
            const fallbackPageNumber = Number.isFinite(Number(pageKey))
              ? Number(pageKey)
              : undefined;
            return {
              pageNumber: fallbackPageNumber,
              highlights: pageValue,
            } as unknown as ResponseHighlighting;
          }

          return {
            pageNumber: Number.isFinite(Number(pageKey)) ? Number(pageKey) : 1,
            highlights: [],
          } as unknown as ResponseHighlighting;
        },
      );
    }

    return [];
  }, [normalizedHighlighting]);

  const legendCounts = useMemo(() => {
    const allHighlights = pagesArray.flatMap((page) => page.highlights);

    return Object.values(HighlightLevel).reduce(
      (acc, level) => {
        acc[level as HighlightLevel] = allHighlights.filter(
          (h) => h.level === level,
        ).length;
        return acc;
      },
      {} as Record<HighlightLevel, number>,
    );
  }, [pagesArray]);

  const allPageHighlights = useMemo(() => {
    const highlights = pagesArray.flatMap((page) =>
      page.highlights.map((h) => ({ ...h, page: page.pageNumber })),
    );

    return highlights.sort((a, b) => (a.page || 0) - (b.page || 0));
  }, [pagesArray]);

  const currentPageHighlights = useMemo(() => {
    return allPageHighlights.filter((h) => h.page === currentPage);
  }, [allPageHighlights, currentPage]);

  const availablePages = useMemo(() => {
    const pages = pagesArray
      .map((p) => p.pageNumber)
      .filter((p): p is number => typeof p === "number" && Number.isFinite(p));
    return Array.from(new Set(pages)).sort((a, b) => a - b);
  }, [pagesArray]);

  useEffect(() => {
    if (availablePages.length === 0) {
      return;
    }

    if (!availablePages.includes(currentPage)) {
      setCurrentPage(availablePages[0]);
    }
  }, [availablePages, currentPage]);

  const pdfViewerUrl = useMemo(
    () => withPdfPageFragment(pdfUrl, currentPage),
    [pdfUrl, currentPage],
  );

  const currentPageIndex = useMemo(
    () => availablePages.indexOf(currentPage),
    [availablePages, currentPage],
  );

  const previousPage =
    currentPageIndex > 0 ? availablePages[currentPageIndex - 1] : undefined;
  const nextPage =
    currentPageIndex !== -1 && currentPageIndex < availablePages.length - 1
      ? availablePages[currentPageIndex + 1]
      : undefined;

  return (
    <div
      className={
        isModal
          ? ""
          : "mt-6 w-full overflow-hidden rounded-xl border-2 border-violet-200 bg-white shadow-lg"
      }
    >
      {!isModal && (
        <div className="border-b border-gray-200 bg-gradient-to-r from-violet-50 to-indigo-50 px-6 py-4">
          <h3 className="text-lg font-bold text-gray-900">
            Your Graded Submission with AI Feedback
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Review your submission with color-coded highlights and detailed
            feedback
          </p>
        </div>
      )}

      <div className="flex flex-col lg:flex-row">
        {/* PDF Viewer */}
        <div className="flex-1 bg-gray-50 p-4">
          <div
            className={`relative flex flex-col overflow-hidden rounded-lg border-2 border-gray-300 bg-white shadow-md ${isModal ? "h-[75vh]" : "h-[70vh]"}`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => previousPage && setCurrentPage(previousPage)}
                  disabled={!previousPage}
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm disabled:opacity-50"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => nextPage && setCurrentPage(nextPage)}
                  disabled={!nextPage}
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm disabled:opacity-50"
                >
                  Next
                </button>

                {availablePages.length > 0 && (
                  <select
                    value={currentPage}
                    onChange={(e) => setCurrentPage(Number(e.target.value))}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs font-semibold text-gray-700 shadow-sm"
                    aria-label="Select page"
                  >
                    {availablePages.map((pageNum) => (
                      <option key={pageNum} value={pageNum}>
                        Page {pageNum}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <a
                href={pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-violet-700 hover:text-violet-900"
              >
                Open PDF
              </a>
            </div>

            <iframe
              title="Annotated PDF with AI feedback"
              src={pdfViewerUrl}
              className="w-full flex-1 bg-gray-100"
            />
          </div>
          <div className=" flex flex-wrap justify-center gap-2 rounded-lg bg-white/95 p-2 shadow-lg ring-1 ring-gray-300 backdrop-blur">
            {(Object.keys(highlightClass) as HighlightLevel[]).map((level) => (
              <span
                key={level}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${highlightClass[level]}`}
              >
                {highlightIcon[level]}
                <span>
                  {highlightLabel[level]} ({legendCounts[level] ?? 0})
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Feedback Sidebar */}
        <div className="w-full border-t border-gray-200 lg:w-96 lg:border-l lg:border-t-0">
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab("currentPage")}
              className={`flex-1 px-3 py-3 text-sm font-semibold transition ${
                activeTab === "currentPage"
                  ? "border-b-2 border-violet-600 bg-white text-violet-700"
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              Page {currentPage}
            </button>
            <button
              onClick={() => setActiveTab("highlights")}
              className={`flex-1 px-3 py-3 text-sm font-semibold transition ${
                activeTab === "highlights"
                  ? "border-b-2 border-violet-600 bg-white text-violet-700"
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setActiveTab("feedback")}
              className={`flex-1 px-3 py-3 text-sm font-semibold transition ${
                activeTab === "feedback"
                  ? "border-b-2 border-violet-600 bg-white text-violet-700"
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              Summary
            </button>
          </div>

          <div
            className={`space-y-3 overflow-y-auto p-4 ${isModal ? "max-h-[75vh]" : "max-h-[70vh]"}`}
          >
            {activeTab === "currentPage" ? (
              <div className="space-y-2">
                <div className="mb-3 rounded-lg bg-violet-50 p-3 border border-violet-200">
                  <p className="text-sm font-semibold text-violet-900">
                    Page {currentPage} Feedback
                  </p>
                  <p className="text-xs text-violet-700 mt-1">
                    {currentPageHighlights.length} comment
                    {currentPageHighlights.length !== 1 ? "s" : ""} on this page
                  </p>
                </div>
                {currentPageHighlights.length > 0 ? (
                  currentPageHighlights.map((highlight, index) =>
                    renderHighlightCard(
                      highlight,
                      index,
                      highlightClass,
                      highlightIcon,
                      highlightLabel,
                      false,
                    ),
                  )
                ) : (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 py-12 text-center">
                    <p className="text-sm text-gray-500">
                      No feedback on this page
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Use the page selector to view other pages
                    </p>
                  </div>
                )}
              </div>
            ) : activeTab === "feedback" ? (
              <>
                {/* Strengths */}
                {strengths.length > 0 && (
                  <div className="rounded-lg border border-green-200 bg-white p-3 shadow-sm">
                    <div className="mb-2 flex items-center gap-2">
                      <CheckCircleIcon className="h-5 w-5 text-green-600" />
                      <p className="text-sm font-semibold text-gray-900">
                        What you did well
                      </p>
                    </div>
                    <ul className="space-y-1.5 text-sm text-gray-700">
                      {strengths.map((item, index) => (
                        <li
                          key={`strength-${index}`}
                          className="flex items-start gap-2"
                        >
                          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500" />
                          <span className="leading-relaxed">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Needs Work */}
                {needsWork.length > 0 && (
                  <div className="rounded-lg border border-rose-200 bg-white p-3 shadow-sm">
                    <div className="mb-2 flex items-center gap-2">
                      <XCircleIcon className="h-5 w-5 text-rose-600" />
                      <p className="text-sm font-semibold text-gray-900">
                        Needs more work
                      </p>
                    </div>
                    <ul className="space-y-1.5 text-sm text-gray-700">
                      {needsWork.map((item, index) => (
                        <li
                          key={`needs-${index}`}
                          className="flex items-start gap-2"
                        >
                          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-rose-500" />
                          <span className="leading-relaxed">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Guidance */}
                {guidance.length > 0 && (
                  <div className="rounded-lg border border-blue-200 bg-white p-3 shadow-sm">
                    <div className="mb-2 flex items-center gap-2">
                      <ExclamationTriangleIcon className="h-5 w-5 text-blue-600" />
                      <p className="text-sm font-semibold text-gray-900">
                        Next steps
                      </p>
                    </div>
                    <ul className="space-y-1.5 text-sm text-gray-700">
                      {guidance.map((item, index) => (
                        <li
                          key={`guide-${index}`}
                          className="flex items-start gap-2"
                        >
                          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                          <span className="leading-relaxed">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Score Rationale */}
                {scoreRationale && (
                  <div className="rounded-lg border border-gray-300 bg-gradient-to-br from-gray-50 to-white p-3 shadow-sm">
                    <p className="mb-1.5 text-sm font-semibold text-gray-900">
                      Score explanation
                    </p>
                    <p className="text-sm leading-relaxed text-gray-700">
                      {scoreRationale}
                    </p>
                  </div>
                )}

                {strengths.length === 0 &&
                  needsWork.length === 0 &&
                  guidance.length === 0 &&
                  !scoreRationale && (
                    <div className="py-8 text-center">
                      <p className="text-sm italic text-gray-500">
                        No detailed feedback available
                      </p>
                    </div>
                  )}
              </>
            ) : (
              <div className="space-y-2">
                {allPageHighlights.length > 0 ? (
                  allPageHighlights.map((highlight, index) =>
                    renderHighlightCard(
                      highlight,
                      index,
                      highlightClass,
                      highlightIcon,
                      highlightLabel,
                      true,
                    ),
                  )
                ) : (
                  <div className="py-8 text-center">
                    <p className="text-sm italic text-gray-500">
                      No highlights available
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
