"use client";

import { ResponseHighlighting } from "@/config/types";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon, XCircleIcon } from "@heroicons/react/24/outline";
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
