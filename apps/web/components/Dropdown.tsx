"use client";

import Tooltip from "@/components/Tooltip";
import { cn } from "@/lib/strings";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface DropdownProps<T> {
  selectedItem: T;
  setSelectedItem: (value: T) => void;
  items: { value: T; label: string; description?: string }[];
  placeholder?: string;
  disableUiTranslation?: boolean;
  disabled?: boolean;
  disabledTooltip?: string;
  [key: string]: unknown;
}

function Dropdown<T>({
  selectedItem,
  setSelectedItem,
  items,
  placeholder = "Select an item",
  disableUiTranslation = false,
  disabled = false,
  disabledTooltip,
  ...rest
}: DropdownProps<T>) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [portalContainer, setPortalContainer] = useState<Element | null>(null);

  useEffect(() => {
    let container = document.getElementById("dropdown-portal");
    if (!container) {
      container = document.createElement("div");
      container.id = "dropdown-portal";
      document.body.appendChild(container);
    }
    setPortalContainer(container);

    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, []);

  const toggleDropdown = () => {
    if (disabled) return;
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
    if (disabled) return;
    setSelectedItem(newItem);
    setIsOpen(false);
  };

  const menu = (
    <div
      data-no-ui-translate={disableUiTranslation ? "true" : undefined}
      className={cn(
        "pb-1 mt-1 absolute w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-300 dark:border-gray-600 origin-top duration-150 z-[9999] ease-out transform-gpu",
        isOpen
          ? "scale-100 opacity-100"
          : "scale-90 opacity-0 pointer-events-none",
        "max-h-60 overflow-y-auto",
      )}
      style={{
        top: dropdownRef.current
          ? dropdownRef.current.getBoundingClientRect().bottom + window.scrollY
          : 0,
        left: dropdownRef.current
          ? dropdownRef.current.getBoundingClientRect().left + window.scrollX
          : 0,
        width: dropdownRef.current
          ? dropdownRef.current.getBoundingClientRect().width
          : "100%",
      }}
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
                : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700",
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
  );

  const triggerButton = (
    <button
      type="button"
      onClick={toggleDropdown}
      disabled={disabled}
      className={cn(
        "rounded-lg w-full transition-all flex justify-between items-center pl-4 px-3 py-2 text-left border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:border-transparent focus:ring-1 focus:ring-violet-600 disabled:opacity-50 disabled:cursor-not-allowed",
        isOpen ? "ring-violet-600 ring-1" : "",
      )}
      {...rest}
    >
      <p
        className={cn(
          "whitespace-nowrap overflow-hidden overflow-ellipsis w-full text-sm transition-colors",
          selectedItem
            ? "font-medium text-gray-700 dark:text-gray-200"
            : "text-gray-500 dark:text-gray-400",
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
  );

  const showDisabledTooltip = disabled && Boolean(disabledTooltip);

  return (
    <div
      className="relative w-full"
      ref={dropdownRef}
      data-no-ui-translate={disableUiTranslation ? "true" : undefined}
    >
      {showDisabledTooltip ? (
        <Tooltip content={disabledTooltip} disabled={false}>
          {triggerButton}
        </Tooltip>
      ) : (
        <Tooltip distance={0} content="" disabled={true}>
          {triggerButton}
        </Tooltip>
      )}

      {isOpen && portalContainer ? createPortal(menu, portalContainer) : null}
    </div>
  );
}

export default Dropdown;
