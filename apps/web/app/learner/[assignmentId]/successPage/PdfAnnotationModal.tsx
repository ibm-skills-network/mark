"use client";

import { HighlightLevel, ResponseHighlighting } from "@/config/types";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import {
  XMarkIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";

const PdfFeedbackViewer = dynamic(
  () => import("@/components/PdfFeedbackViewer"),
  { ssr: false },
);

interface PdfAnnotationModalProps {
  open: boolean;
  onClose: () => void;
  pdfUrl?: string;
  highlighting?: ResponseHighlighting;
  strengths?: string[];
  needsWork?: string[];
  guidance?: string[];
  scoreRationale?: string;
  title?: string;
}

const highlightClass: Record<HighlightLevel, string> = {
  [HighlightLevel.CORRECT]:
    "bg-green-100 text-green-800 border border-green-400",
  [HighlightLevel.PARTIAL]:
    "bg-amber-100 text-amber-800 border border-amber-400",
  [HighlightLevel.INCORRECT]:
    "bg-rose-100 text-rose-800 border border-rose-400",
  [HighlightLevel.NEUTRAL]: "bg-gray-100 text-gray-700 border border-gray-300",
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

const FeedbackSection = ({
  title,
  items,
  emptyText,
  icon,
  color,
}: {
  title: string;
  items: string[];
  emptyText: string;
  icon: JSX.Element;
  color: string;
}) => (
  <div className={`rounded-lg border ${color} bg-white p-4 shadow-sm`}>
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <p className="text-sm font-semibold text-gray-900">{title}</p>
    </div>
    {items.length > 0 ? (
      <ul className="space-y-2 text-sm text-gray-700">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
            <span className="leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-gray-500 italic">{emptyText}</p>
    )}
  </div>
);

export default function PdfAnnotationModal({
  open,
  onClose,
  pdfUrl,
  highlighting,
  strengths = [],
  needsWork = [],
  guidance = [],
  scoreRationale,
  title = "Your Graded Submission",
}: PdfAnnotationModalProps) {
  return (
    <Dialog as="div" className="relative z-50" open={open} onClose={onClose}>
      <div className="fixed inset-0 bg-black/70" aria-hidden="true" />
      <div className="fixed inset-0 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <DialogPanel className="w-full max-w-7xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-gray-200 bg-gradient-to-r from-violet-50 to-indigo-50 px-6 py-4">
              <div>
                <DialogTitle className="text-xl font-bold text-gray-900">
                  {title}
                </DialogTitle>
                <p className="mt-1 text-sm text-gray-600">
                  Review your submission with AI feedback and color-coded
                  highlights
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-2 text-gray-600 transition hover:bg-white/50"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="flex flex-col gap-4 p-6 lg:flex-row">
              <div className="flex-1">
                {pdfUrl ? (
                  <PdfFeedbackViewer
                    pdfUrl={pdfUrl}
                    highlighting={highlighting}
                    strengths={strengths}
                    needsWork={needsWork}
                    guidance={guidance}
                    scoreRationale={scoreRationale}
                    isModal={true}
                  />
                ) : (
                  <div className="flex h-[75vh] flex-col items-center justify-center gap-3 rounded-xl border-2 border-gray-200 bg-gray-50 text-gray-600 shadow-lg">
                    <XCircleIcon className="h-12 w-12 text-gray-400" />
                    <p className="text-lg font-semibold">
                      Annotated PDF not available
                    </p>
                    <p className="text-sm text-gray-500">
                      No PDF was generated for this feedback
                    </p>
                  </div>
                )}
              </div>
            </div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
