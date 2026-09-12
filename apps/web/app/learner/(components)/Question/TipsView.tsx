"use client";

import { cn } from "@/lib/strings";
import { useAppConfig } from "@/stores/appConfig";
import { TagIcon, XMarkIcon } from "@heroicons/react/24/outline";
import {
  ArrowRightIcon,
  LanguageIcon,
  TagIcon as SolidTagIcon,
} from "@heroicons/react/24/solid";
import React, { useCallback, useEffect, useRef, useState } from "react";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function CloseTipsButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close tips"
      onClick={onClose}
      // A 24px icon is not a touch target; the negative margin keeps the
      // 44px hit area from pushing the heading around.
      className="-m-2 flex h-11 w-11 items-center justify-center rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600"
    >
      <XMarkIcon className="h-6 w-6" aria-hidden="true" />
    </button>
  );
}

function DontShowAgain({
  persistTips,
  setPersistTips,
}: {
  persistTips: boolean;
  setPersistTips: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-center gap-x-2 cursor-pointer">
      <input
        type="checkbox"
        className="text-violet-600 h-4 w-4"
        onChange={() => setPersistTips(!persistTips)}
        checked={persistTips}
      />

      <span className="text-gray-600 dark:text-gray-300 text-sm">
        Don&apos;t Show This Again
      </span>
    </label>
  );
}

function TipsView() {
  const { setTips, persistTips, setPersistTips } = useAppConfig((state) => ({
    setTips: state.setTips,
    persistTips: state.persistTips,
    setPersistTips: state.setPersistTips,
  }));

  const [isMobile, setIsMobile] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const closeTips = useCallback(() => setTips(false), [setTips]);

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < 768);
    }
    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // The sheet takes focus while it is up and hands it back on close, so a
  // keyboard or screen-reader user is not left behind an invisible layer.
  useEffect(() => {
    if (!isMobile) return;
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.focus();

    return () => {
      const target = previouslyFocused.current;
      if (target && document.contains(target)) {
        target.focus();
      }
    };
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeTips();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, closeTips]);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (isMobile) {
    return (
      // Positioned against the question area rather than the viewport: a
      // viewport-fixed layer also covered the header, which holds the submit
      // button, so tips left the learner with nothing to tap.
      <div
        data-testid="tips-sheet-backdrop"
        className="absolute inset-0 z-40 flex items-end justify-center bg-black bg-opacity-50 p-4 sm:items-center"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeTips();
          }
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tips-sheet-title"
          tabIndex={-1}
          onKeyDown={handleDialogKeyDown}
          className="mx-auto w-full max-w-xs sm:max-w-sm max-h-full overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow flex flex-col gap-y-3 p-4 focus:outline-none"
        >
          <div className="flex items-center justify-between">
            <h1
              id="tips-sheet-title"
              className="text-gray-800 dark:text-gray-100 text-lg"
            >
              Tips
            </h1>
            <CloseTipsButton onClose={closeTips} />
          </div>
          <div className="flex flex-col gap-y-2 border-y dark:border-gray-700 py-2">
            <h1 className="text-gray-800 dark:text-gray-100 text-lg pb-2">
              Language Assistance
            </h1>
            <p className="text-gray-600 dark:text-gray-300 leading-tight">
              Unsure about a question? Toggle between translations in your
              chosen language.
            </p>
            <div className="flex items-center gap-x-2 mt-2 px-4">
              <LanguageIcon className="h-6 w-6 text-gray-600 dark:text-gray-300" />
              <div
                className={cn(
                  "relative inline-flex h-5 w-10 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none bg-gray-200 dark:bg-gray-600",
                )}
                aria-checked={false}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-0",
                  )}
                />
              </div>
              <LanguageIcon className="h-6 w-6 text-violet-600" />
              <div
                className={cn(
                  "relative inline-flex h-5 w-10 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none bg-violet-600",
                )}
                aria-checked={true}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-5",
                  )}
                />
              </div>
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-xs">
              * TRANSLATIONS ARE MACHINE GENERATED
            </p>
          </div>
          <div className="flex flex-col gap-y-2 border-b dark:border-gray-700 pb-2">
            <h1 className="text-gray-800 dark:text-gray-100 text-lg">Tags</h1>
            <p className="text-gray-600 dark:text-gray-300 leading-tight">
              Wanted to come back to this question later? tag the question!
            </p>
            <div className="flex items-center gap-x-2 px-4">
              <div className="flex items-center gap-x-1">
                <TagIcon className="h-6 w-6 text-violet-600" />
                <p className="text-gray-600 dark:text-gray-400 text-xs">
                  UNTAGGED
                </p>
              </div>
              <div className="flex items-center gap-x-1">
                <SolidTagIcon className="h-6 w-6 text-violet-600" />
                <p className="text-gray-600 dark:text-gray-400 text-xs">
                  TAGGED
                </p>
              </div>
            </div>
          </div>
          <DontShowAgain
            persistTips={persistTips}
            setPersistTips={setPersistTips}
          />
          <button
            type="button"
            onClick={closeTips}
            className="w-full min-h-[44px] rounded-md bg-violet-600 px-4 py-2 font-medium text-white transition hover:bg-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            Got it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 border border-gray-300 dark:border-gray-600 rounded-lg flex flex-col gap-y-3 w-full md:w-[250px] bg-white dark:bg-gray-800 shadow hover:shadow-md">
      <div className="flex items-center justify-between ">
        <h1 className="text-gray-800 dark:text-gray-100 text-lg">Tips</h1>
        <CloseTipsButton onClose={closeTips} />
      </div>
      <div className="flex flex-col gap-y-2 border-y dark:border-gray-700 py-2">
        <h1 className="text-gray-800 dark:text-gray-100 text-lg pb-2">
          Language Assistance
        </h1>
        <p className="text-gray-600 dark:text-gray-300 leading-tight">
          Unsure about a question? Toggle between translations in your chosen
          language.
        </p>
        <div className="flex items-center gap-x-2 mt-2 px-4">
          <LanguageIcon className="h-6 w-6 text-gray-600 dark:text-gray-300" />
          <div
            className={cn(
              "relative inline-flex h-5 w-10 flex-shrink-0  rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none bg-gray-200 dark:bg-gray-600",
            )}
            aria-checked={false}
          >
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-0",
              )}
            />
          </div>
          <LanguageIcon className="h-6 w-6 text-violet-600" />
          <div
            className={cn(
              "relative inline-flex h-5 w-10 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none bg-violet-600",
            )}
            aria-checked={true}
          >
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-5",
              )}
            />
          </div>
        </div>
        <p className="text-gray-600 dark:text-gray-400 text-xs">
          * TRANSLATIONS ARE MACHINE GENERATED
        </p>
      </div>
      <div className="flex flex-col gap-y-2 border-b dark:border-gray-700 pb-2">
        <h1 className="text-gray-800 dark:text-gray-100 text-lg">Tags</h1>
        <p className="text-gray-600 dark:text-gray-300 leading-tight">
          Wanted to come back to this question later? tag the question!
        </p>
        <div className="flex items-center gap-x-2 px-4">
          <div className="flex items-center gap-x-1">
            <TagIcon className="h-6 w-6 text-violet-600" />
          </div>
          <ArrowRightIcon className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          <div className="flex items-center gap-x-1">
            <SolidTagIcon className="h-6 w-6 text-violet-600" />
          </div>
          <ArrowRightIcon className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          <div className="w-10 h-11 border rounded-md text-center relative  justify-center focus:outline-none flex flex-col items-center bg-violet-100 dark:bg-violet-900/30 border-violet-400 dark:border-violet-500 text-violet-700 dark:text-violet-300">
            <div
              className="absolute top-0 right-0 w-4 h-4 bg-violet-500"
              style={{
                clipPath: "polygon(100% 0, 0 0, 100% 100%)",
                borderTopRightRadius: "0.25rem",
              }}
              aria-hidden="true"
            ></div>
            <div className="font-bold text-lg">1</div>
          </div>
        </div>
      </div>
      <DontShowAgain
        persistTips={persistTips}
        setPersistTips={setPersistTips}
      />
    </div>
  );
}

export default TipsView;
