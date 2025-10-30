"use client";

import { cn } from "@/lib/strings";
import { useAppConfig } from "@/stores/appConfig";
import { TagIcon, XMarkIcon } from "@heroicons/react/24/outline";
import {
  ArrowRightIcon,
  LanguageIcon,
  TagIcon as SolidTagIcon,
} from "@heroicons/react/24/solid";
import React, { useEffect, useState } from "react";

function TipsView() {
  const { setTips, persistTips, setPersistTips } = useAppConfig((state) => ({
    setTips: state.setTips,
    persistTips: state.persistTips,
    setPersistTips: state.setPersistTips,
  }));

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < 768);
    }
    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
        <div className="mx-auto w-full max-w-xs sm:max-w-sm bg-white border border-gray-300 rounded-lg shadow hover:shadow-mdflex flex-col gap-y-3 p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-gray-800 text-lg">Tips</h1>
            <XMarkIcon
              className="h-6 w-6 text-gray-600 cursor-pointer"
              onClick={() => setTips(false)}
            />
          </div>
          <div className="flex flex-col gap-y-2 border-y py-2">
            <h1 className="text-gray-800 text-lg pb-2">Language Assistance</h1>
            <p className="text-gray-600 leading-tight">
              Unsure about a question? Toggle between translations in your
              chosen language.
            </p>
            <div className="flex items-center gap-x-2 mt-2 px-4">
              <LanguageIcon className="h-6 w-6 text-gray-600" />
              <div
                className={cn(
                  "relative inline-flex h-5 w-10 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none bg-gray-200",
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
            <p className="text-gray-600 text-xs">
              * TRANSLATIONS ARE MACHINE GENERATED
            </p>
          </div>
          <div className="flex flex-col gap-y-2 border-b pb-2">
            <h1 className="text-gray-800 text-lg">Tags</h1>
            <p className="text-gray-600 leading-tight">
              Wanted to come back to this question later? tag the question!
            </p>
            <div className="flex items-center gap-x-2 px-4">
              <div className="flex items-center gap-x-1">
                <TagIcon className="h-6 w-6 text-violet-600" />
                <p className="text-gray-600 text-xs">UNTAGGED</p>
              </div>
              <div className="flex items-center gap-x-1">
                <SolidTagIcon className="h-6 w-6 text-violet-600" />
                <p className="text-gray-600 text-xs">TAGGED</p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-x-2 cursor-pointer">
            <input
              type="checkbox"
              className="text-violet-600 h-4 w-4"
              onChange={() => setPersistTips(!persistTips)}
              checked={persistTips}
            />

            <p className="text-gray-600 text-sm">Don't Show This Again</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 border border-gray-300 rounded-lg flex flex-col gap-y-3 w-full md:w-[250px] bg-white shadow hover:shadow-md">
      <div className="flex items-center justify-between ">
        <h1 className="text-gray-800 text-lg">Tips</h1>
        <XMarkIcon
          className="h-6 w-6 text-gray-600 cursor-pointer hover:cursor-pointer"
          onClick={() => setTips(false)}
        />
      </div>
      <div className="flex flex-col gap-y-2 border-y py-2">
        <h1 className="text-gray-800 text-lg pb-2">Language Assistance</h1>
        <p className="text-gray-600 leading-tight">
          Unsure about a question? Toggle between translations in your chosen
          language.
        </p>
        <div className="flex items-center gap-x-2 mt-2 px-4">
          <LanguageIcon className="h-6 w-6 text-gray-600" />
          <div
            className={cn(
              "relative inline-flex h-5 w-10 flex-shrink-0  rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none bg-gray-200",
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
        <p className="text-gray-600 text-xs">
          * TRANSLATIONS ARE MACHINE GENERATED
        </p>
      </div>
      <div className="flex flex-col gap-y-2 border-b pb-2">
        <h1 className="text-gray-800 text-lg">Tags</h1>
        <p className="text-gray-600 leading-tight">
          Wanted to come back to this question later? tag the question!
        </p>
        <div className="flex items-center gap-x-2 px-4">
          <div className="flex items-center gap-x-1">
            <TagIcon className="h-6 w-6 text-violet-600" />
          </div>
          <ArrowRightIcon className="h-4 w-4 text-gray-600" />
          <div className="flex items-center gap-x-1">
            <SolidTagIcon className="h-6 w-6 text-violet-600" />
          </div>
          <ArrowRightIcon className="h-4 w-4 text-gray-600" />
          <div className="w-10 h-11 border rounded-md text-center relative  justify-center focus:outline-none flex flex-col items-center bg-violet-100 border-violet-400 text-violet-700">
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
      <div className="flex items-center justify-center gap-x-2 cursor-pointer">
        <input
          type="checkbox"
          className="text-violet-600 h-4 w-4"
          onChange={() => setPersistTips(!persistTips)}
          checked={persistTips}
        />

        <p className="text-gray-600 text-sm">Don't Show This Again</p>
      </div>
    </div>
  );
}

export default TipsView;
