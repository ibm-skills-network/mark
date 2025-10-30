import React, { useRef, useEffect } from "react";
import {
  IconFolder,
  IconFolderPlus,
  IconClipboard,
  IconFolderX,
  IconFolderUp,
  IconUpload,
} from "@tabler/icons-react";

interface FolderContextMenuAction {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  color?: string;
  divider?: boolean;
}

interface FolderContextMenuProps {
  folderName: string;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onNavigate: () => void;
  onCreateSubfolder?: () => void;
  onDeleteFolder?: () => void;
  onUploadToFolder?: () => void;
  onCopyPath?: () => void;
  isRootFolder: boolean;
  readOnly?: boolean;
}

const FolderContextMenu: React.FC<FolderContextMenuProps> = ({
  folderName,
  position,
  onClose,
  onNavigate,
  onCreateSubfolder,
  onDeleteFolder,
  onUploadToFolder,
  onCopyPath,
  isRootFolder,
  readOnly = false,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

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

  const adjustedPosition = () => {
    if (!position || !menuRef.current) return { top: 0, left: 0 };

    const { x, y } = position;
    const menuRect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = menuRect.width || 180;
    const menuHeight = menuRect.height || 200;

    let left = x;
    let top = y;

    if (x + menuWidth > viewportWidth) {
      left = Math.max(10, x - menuWidth);
    }

    if (y + menuHeight > viewportHeight) {
      top = Math.max(10, viewportHeight - menuHeight - 10);
    }

    return { top, left };
  };

  const getActions = (): FolderContextMenuAction[] => {
    const actions: FolderContextMenuAction[] = [];

    actions.push({
      icon: <IconFolder size={18} />,
      label: "Open",
      onClick: onNavigate,
    });

    if (!readOnly) {
      if (onUploadToFolder) {
        actions.push({
          icon: <IconUpload size={18} />,
          label: "Upload here",
          onClick: onUploadToFolder,
        });
      }

      if (onCreateSubfolder) {
        actions.push({
          icon: <IconFolderPlus size={18} />,
          label: "Create subfolder",
          onClick: onCreateSubfolder,
          divider: true,
        });
      }
    }

    if (onCopyPath) {
      actions.push({
        icon: <IconClipboard size={18} />,
        label: "Copy path",
        onClick: onCopyPath,
      });
    }

    if (!isRootFolder && !readOnly && onDeleteFolder) {
      actions.push({
        icon: <IconFolderX size={18} />,
        label: "Delete folder",
        onClick: onDeleteFolder,
        color: "text-red-600",
      });
    }

    return actions;
  };

  if (!position) return null;

  const { top, left } = adjustedPosition();
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
          <IconFolder size={20} className="text-yellow-500 mr-2" />
          <span className="font-medium truncate text-sm">
            {folderName || "Root"}
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

export default FolderContextMenu;
