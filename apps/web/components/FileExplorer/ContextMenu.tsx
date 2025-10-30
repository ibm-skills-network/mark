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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

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

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      setMenuDimensions({
        width: rect.width,
        height: rect.height,
      });
    }
  }, []);

  useEffect(() => {
    if (!position) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const menuWidth = menuDimensions.width || 180;
    const menuHeight = menuDimensions.height || 200;

    let calculatedTop = position.y;
    let calculatedLeft = position.x;

    if (position.x + menuWidth > viewportWidth) {
      calculatedLeft = Math.max(10, position.x - menuWidth);
    }

    if (position.y + menuHeight > viewportHeight) {
      calculatedTop = Math.max(10, viewportHeight - menuHeight - 10);
    }

    setTop(calculatedTop);
    setLeft(calculatedLeft);
  }, [position, menuDimensions]);

  const getActions = (): ContextMenuAction[] => {
    const actions: ContextMenuAction[] = [];

    if (onPreview) {
      actions.push({
        icon: <IconEye size={18} />,
        label: "Preview",
        onClick: onPreview,
      });
    }

    if (onDownload) {
      actions.push({
        icon: <IconDownload size={18} />,
        label: "Download",
        onClick: onDownload,
      });
    }

    if (onCopyPath) {
      actions.push({
        icon: <IconClipboard size={18} />,
        label: "Copy Path",
        onClick: onCopyPath,
        divider: !readOnly,
      });
    }

    if (onShowInfo) {
      actions.push({
        icon: <IconInfoCircle size={18} />,
        label: "Properties",
        onClick: onShowInfo,
        divider: !readOnly,
      });
    }

    if (!readOnly) {
      if (onRename) {
        actions.push({
          icon: <IconEdit size={18} />,
          label: "Rename",
          onClick: onRename,
        });
      }

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
      <div className="px-3 py-2 border-b border-gray-200 mb-1">
        <div className="flex items-center">
          {getFileIcon(file, 20)}
          <span className="ml-2 font-medium truncate text-sm">
            {file.fileName}
          </span>
        </div>
      </div>

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
