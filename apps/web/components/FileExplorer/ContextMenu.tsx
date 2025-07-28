// Updated ContextMenu.tsx
import React, { useRef, useEffect, useState } from "react";
import {
  IconEye,
  IconDownload,
  IconEdit,
  IconTrash,
  IconClipboard,
  IconInfoCircle,
} from "@tabler/icons-react";
import { getFileIcon } from "./FileExplorer";
import { FileObject } from "../../stores/fileStore";

interface ContextMenuAction {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  color?: string;
  divider?: boolean;
}

interface ContextMenuProps {
  file: FileObject;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onPreview?: () => void;
  onDownload?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onShowInfo?: () => void;
  onCopyPath?: () => void;
  readOnly?: boolean;
}

const ContextMenu: React.FC<ContextMenuProps> = ({
  file,
  position,
  onClose,
  onPreview,
  onDownload,
  onRename,
  onDelete,
  onShowInfo,
  onCopyPath,
  readOnly = false,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [left, setLeft] = useState(0);
  const [menuDimensions, setMenuDimensions] = useState({ width: 0, height: 0 });

  // Handle clicking outside to close menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    // Close on escape key
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Get menu dimensions after render
  useEffect(() => {
    if (menuRef.current) {
      // Get actual dimensions of the rendered menu
      const rect = menuRef.current.getBoundingClientRect();
      setMenuDimensions({
        width: rect.width,
        height: rect.height,
      });
    }
  }, []);

  // Adjust position to keep menu in viewport
  useEffect(() => {
    if (!position) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Use the actual menu dimensions if available, or estimated dimensions
    const menuWidth = menuDimensions.width || 180; // Default minimum width
    const menuHeight = menuDimensions.height || 200; // Estimated height

    // Calculate adjusted positions
    let calculatedTop = position.y;
    let calculatedLeft = position.x;

    // Adjust horizontally if needed
    if (position.x + menuWidth > viewportWidth) {
      calculatedLeft = Math.max(10, position.x - menuWidth);
    }

    // Adjust vertically if needed
    if (position.y + menuHeight > viewportHeight) {
      calculatedTop = Math.max(10, viewportHeight - menuHeight - 10);
    }

    // Update state with calculated positions
    setTop(calculatedTop);
    setLeft(calculatedLeft);
  }, [position, menuDimensions]);

  // Define available actions
  const getActions = (): ContextMenuAction[] => {
    const actions: ContextMenuAction[] = [];

    // Preview action
    if (onPreview) {
      actions.push({
        icon: <IconEye size={18} />,
        label: "Preview",
        onClick: onPreview,
      });
    }

    // Download action
    if (onDownload) {
      actions.push({
        icon: <IconDownload size={18} />,
        label: "Download",
        onClick: onDownload,
      });
    }

    // Copy path action
    if (onCopyPath) {
      actions.push({
        icon: <IconClipboard size={18} />,
        label: "Copy Path",
        onClick: onCopyPath,
        divider: !readOnly,
      });
    }

    // File info
    if (onShowInfo) {
      actions.push({
        icon: <IconInfoCircle size={18} />,
        label: "Properties",
        onClick: onShowInfo,
        divider: !readOnly,
      });
    }

    // Edit actions (not available in read-only mode)
    if (!readOnly) {
      // Rename action
      if (onRename) {
        actions.push({
          icon: <IconEdit size={18} />,
          label: "Rename",
          onClick: onRename,
        });
      }

      // Delete action
      if (onDelete) {
        actions.push({
          icon: <IconTrash size={18} />,
          label: "Delete",
          onClick: onDelete,
          color: "text-red-600",
        });
      }
    }

    return actions;
  };

  if (!position) return null;

  const actions = getActions();

  if (actions.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] bg-white rounded-md shadow-lg border border-gray-200 py-1"
      style={{ top, left }}
    >
      {/* File header */}
      <div className="px-3 py-2 border-b border-gray-200 mb-1">
        <div className="flex items-center">
          {getFileIcon(file, 20)}
          <span className="ml-2 font-medium truncate text-sm">
            {file.fileName}
          </span>
        </div>
      </div>

      {/* Menu actions */}
      {actions.map((action, index) => (
        <React.Fragment key={index}>
          <button
            className={`w-full text-left px-3 py-2 hover:bg-gray-100 flex items-center ${
              action.color || "text-gray-700"
            }`}
            onClick={() => {
              action.onClick();
              onClose();
            }}
          >
            <span className="mr-2">{action.icon}</span>
            <span className="text-sm">{action.label}</span>
          </button>
          {action.divider && <div className="border-t border-gray-100 my-1" />}
        </React.Fragment>
      ))}
    </div>
  );
};

export default ContextMenu;
