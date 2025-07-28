"use client";

import Tooltip from "@/components/Tooltip";
import { cn } from "@/lib/strings";
import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FC,
} from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  value: number;
  setAllotedTimeMinutes: (value: number | null) => void;
}

const Component: FC<Props> = (props) => {
  const { value, setAllotedTimeMinutes } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [tempValue, setTempValue] = useState<number | null>(value);
  const parentRef = useRef<HTMLDivElement>(null);
  const handleClickOutside = (event: MouseEvent) => {
    if (
      parentRef.current &&
      !parentRef.current.contains(event.target as Node)
    ) {
      setIsOpen(false);
    }
  };

  useEffect(() => {
    document.addEventListener("click", handleClickOutside);

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, []);

  const toggleDropdown = () => {
    setIsOpen((prevState) => !prevState);
  };

  return (
    <div className="max-w-full relative" ref={parentRef}>
      <Tooltip distance={0} content="" disabled={true}>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className={cn(
            "w-full transition-all flex gap-x-2 justify-between items-center border relative border-gray-300 rounded-md h-12 pl-4 pr-3 py-2 focus:outline-none focus:border-transparent focus:ring-1 focus:ring-purple-600",
            isOpen ? "rounded-t-md ring-purple-600 ring-1" : "rounded-md",
          )}
        >
          {value ? (
            isOpen ? (
              <input
                type="number"
                placeholder="ex. 60"
                min={0}
                step={5}
                value={tempValue ?? ""}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                    toggleDropdown();
                  }
                }}
                onChange={(e) => setTempValue(Number(e.target.value) || null)}
                onBlur={() => setAllotedTimeMinutes(tempValue || null)}
                className="w-full h-full bg-gray-100 rounded-t-[0.25rem] border-0 border-b border-b-gray-400 outline-none transition focus:border-b-black !ring-0"
              />
            ) : (
              <p className="whitespace-nowrap overflow-hidden overflow-ellipsis w-full text-sm text-left leading-5 transition-colors font-medium text-gray-700">
                {value} minute{value > 1 ? "s" : ""}
              </p>
            )
          ) : (
            "No time limit"
          )}

          <svg
            className={cn("transition", isOpen ? "rotate-180" : "")}
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeWidth={2}
              d="M6 9L10 13L14 9"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </Tooltip>

      <div
        className={cn(
          "absolute w-full bg-white rounded-b-md shadow-lg border border-gray-300 origin-top duration-150 z-10",
          isOpen ? "scale-100" : "scale-0",
        )}
      >
        {value ? (
          <div
            className="w-full  h-12 outline-none hover:bg-gray-100 transition cursor-pointer text-left flex items-center px-4 py-2"
            onClick={() => {
              setAllotedTimeMinutes(null);
              setIsOpen(false);
              setTempValue(null);
            }}
          >
            No time limit
          </div>
        ) : (
          <div className="px-4 py-2">
            <input
              type="number"
              placeholder="Set a time limit here"
              min={0}
              step={5}
              value={tempValue ?? ""}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              onChange={(e) => setTempValue(Number(e.target.value) || null)}
              onBlur={() => setAllotedTimeMinutes(tempValue || null)}
              className="w-full h-full bg-gray-100 rounded-t-[0.25rem] border-0 border-b border-b-gray-400 outline-none transition focus:border-b-black !ring-0"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default Component;
