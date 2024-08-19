"use client";

import Tooltip from "@/components/Tooltip";
import { cn } from "@/lib/strings";
import { useEffect, useRef, useState } from "react";

interface DropdownProps<T> {
  selectedItem: T;
  setSelectedItem: (value: T) => void;
  items: { value: T; label: string; description?: string }[];
  placeholder?: string;
  [key: string]: unknown;
}

function Dropdown<T>({
  selectedItem,
  setSelectedItem,
  items,
  placeholder = "Select an item",
  ...rest
}: DropdownProps<T>) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const toggleDropdown = () => {
    setIsOpen((prevState) => !prevState);
  };

  const handleClickOutside = (event: MouseEvent) => {
    if (
      dropdownRef.current &&
      !dropdownRef.current.contains(event.target as Node)
    ) {
      setIsOpen(false);
    }
  };

  const handleSelectItem = (newItem: T) => {
    setSelectedItem(newItem);
    setIsOpen(false);
  };

  useEffect(() => {
    document.addEventListener("click", handleClickOutside);

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <Tooltip distance={0} content="" disabled={true}>
        <button
          type="button"
          onClick={toggleDropdown}
          className={cn(
            "rounded-lg w-full transition-all flex justify-between items-center pl-4 px-3 py-2 text-left border border-gray-300 focus:outline-none focus:border-transparent focus:ring-1 focus:ring-violet-600",
            isOpen ? "ring-violet-600 ring-1" : "",
          )}
          {...rest}
        >
          <p
            className={cn(
              "whitespace-nowrap overflow-hidden overflow-ellipsis w-full text-sm transition-colors",
              selectedItem
                ? "font-medium text-gray-700"
                : "text-gray-500 dark:text-gray-500",
            )}
          >
            {items.find((item) => item.value === selectedItem)?.label ??
              placeholder}
          </p>

          <svg
            className={cn("transition", isOpen ? "rotate-180" : "")}
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Dropdown Arrow</title>
            <path
              strokeWidth={1}
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
          "pb-1 mt-1 absolute w-full bg-white rounded-lg shadow-lg border border-gray-300 origin-top duration-150 z-10 ease-out transform-gpu",
          isOpen
            ? "scale-100 opacity-100"
            : "scale-90 opacity-0 pointer-events-none",
        )}
      >
        {items.map((item) => (
          <Tooltip
            key={item.value as unknown as string}
            content={item.description}
            disabled={true}
          >
            <li
              className={cn(
                "block px-4 py-3 text-sm cursor-pointer transition",
                selectedItem === item.value
                  ? "hover:bg-violet-700 bg-violet-600 text-white"
                  : "hover:bg-gray-100",
              )}
              onClick={() => handleSelectItem(item.value)}
              onKeyUp={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  handleSelectItem(item.value);
                }
              }}
            >
              {item.label}
            </li>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

export default Dropdown;
