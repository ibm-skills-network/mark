import React, { useState, useRef, useEffect } from "react";
import {
  IconHome,
  IconChevronRight,
  IconDotsCircleHorizontal,
} from "@tabler/icons-react";
import { Breadcrumb } from "./utils/fileUtils";

interface BreadcrumbNavProps {
  breadcrumbs: Breadcrumb[];
  onNavigate: (path: string) => void;
}

export const BreadcrumbNav: React.FC<BreadcrumbNavProps> = ({
  breadcrumbs,
  onNavigate,
}) => {
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkOverflow = () => {
      if (containerRef.current) {
        const isScrollable =
          containerRef.current.scrollWidth > containerRef.current.clientWidth;
        setIsOverflowing(isScrollable);

        if (isScrollable) {
          containerRef.current.scrollLeft = containerRef.current.scrollWidth;
        }
      }
    };

    checkOverflow();
    window.addEventListener("resize", checkOverflow);

    return () => {
      window.removeEventListener("resize", checkOverflow);
    };
  }, [breadcrumbs]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const getVisibleBreadcrumbs = () => {
    if (!isOverflowing || breadcrumbs.length <= 2) {
      return { visible: breadcrumbs, hidden: [] };
    }

    const hidden = breadcrumbs.slice(1, -1);
    const visible = [breadcrumbs[0], ...breadcrumbs.slice(-1)];

    return { visible, hidden };
  };

  const { visible, hidden } = getVisibleBreadcrumbs();

  return (
    <div className="breadcrumbs-container relative">
      <div
        ref={containerRef}
        className="flex items-center overflow-x-auto whitespace-nowrap scrollbar-hide"
      >
        {visible.map((crumb, index) => (
          <React.Fragment key={crumb.path}>
            {index > 0 && (
              <>
                {hidden.length > 0 && index === 1 && (
                  <div className="relative mx-1">
                    <button
                      onClick={() => setShowDropdown(!showDropdown)}
                      className="flex items-center justify-center h-6 w-6 rounded-full hover:bg-gray-100 focus:outline-none"
                    >
                      <IconDotsCircleHorizontal
                        size={16}
                        className="text-gray-400"
                      />
                    </button>

                    {showDropdown && (
                      <div
                        ref={dropdownRef}
                        className="absolute left-0 top-7 z-10 bg-white rounded-md shadow-lg border border-gray-200 py-1 min-w-[180px]"
                      >
                        {hidden.map((hiddenCrumb) => (
                          <button
                            key={hiddenCrumb.path}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 truncate"
                            onClick={() => {
                              onNavigate(hiddenCrumb.path);
                              setShowDropdown(false);
                            }}
                          >
                            {hiddenCrumb.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <IconChevronRight
                  size={16}
                  className="mx-1 text-gray-400 flex-shrink-0"
                />
              </>
            )}

            <button
              className={`flex items-center px-2 py-1 rounded-md text-sm ${
                index === visible.length - 1
                  ? "font-medium text-purple-600 bg-purple-50"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
              onClick={() => onNavigate(crumb.path)}
            >
              {index === 0 ? (
                <>
                  <IconHome size={16} className="mr-1" />
                  <span className="md:hidden">Root</span>
                  <span className="hidden md:inline">Home</span>
                </>
              ) : (
                <span className="truncate max-w-[150px]">{crumb.name}</span>
              )}
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
