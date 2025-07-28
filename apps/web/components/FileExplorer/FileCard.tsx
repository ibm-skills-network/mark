// Updated FileCard.tsx
import React, { useState } from "react";
import { formatFileSize } from "./utils/fileUtils";
import { getFileIcon } from "./FileExplorer";
import ContextMenu from "./ContextMenu";
import {
  IconDotsVertical,
  IconCheck,
  IconInfoCircle,
} from "@tabler/icons-react";
import { FileObject } from "../../stores/fileStore";

interface FileCardProps {
  file: FileObject;
  isSelected: boolean;
  onSelect: (file: FileObject) => void;
  onDelete?: (file: FileObject) => void;
  onDownload?: (file: FileObject) => void;
  onPreview?: (file: FileObject) => void;
  onRename?: (file: FileObject) => void;
  onShowInfo?: (file: FileObject) => void;
  readOnly?: boolean;
  draggable?: boolean;
  onDragStart?: (file: FileObject) => void;
  onDragEnd?: () => void;
  viewMode?: "list" | "grid";
}

const FileCard: React.FC<FileCardProps> = ({
  file,
  isSelected,
  onSelect,
  onDelete,
  onDownload,
  onPreview,
  onRename,
  onShowInfo,
  readOnly = false,
  draggable = false,
  onDragStart,
  onDragEnd,
  viewMode = "grid",
}) => {
  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();

    // If it's today, show time
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    // If it's this year, show month and day
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }

    // Otherwise show short date
    return date.toLocaleDateString(undefined, {
      year: "2-digit",
      month: "numeric",
      day: "numeric",
    });
  };

  // Handle right click to show context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // Get the position from the event, not hardcoded
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  // Handle when dots menu is clicked (for smaller screens/mobile)
  const handleDotsClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent file selection
    // Get the position based on the dots button
    const rect = e.currentTarget.getBoundingClientRect();
    // Position menu to the right of the button
    setContextMenuPos({
      x: rect.right,
      y: rect.top,
    });
  };

  // Handle copying file path
  const handleCopyPath = () => {
    const pathToCopy = `${file.path === "/" ? "" : file.path}/${file.fileName}`;
    void navigator.clipboard.writeText(pathToCopy);
  };

  if (viewMode === "grid") {
    return (
      <>
        <div
          className={`file-card border rounded-md p-3 transition-all duration-200 ${
            isSelected
              ? "bg-purple-50 border-purple-300 ring-2 ring-purple-300 ring-opacity-50"
              : isHovered
                ? "border-gray-300 shadow-sm bg-gray-50"
                : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
          } relative`}
          onClick={() => onSelect(file)}
          onContextMenu={handleContextMenu}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          draggable={draggable}
          onDragStart={() => onDragStart && onDragStart(file)}
          onDragEnd={onDragEnd}
        >
          {/* Selection indicator */}
          {isSelected && (
            <div className="absolute top-2 right-2 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
              <IconCheck size={14} className="text-white" />
            </div>
          )}

          <div className="flex flex-col">
            {/* File icon */}
            <div className="file-icon-wrapper p-2 bg-gray-50 rounded-md mb-3 flex justify-center">
              {getFileIcon(file, 30)}
            </div>

            {/* File info */}
            <div>
              <h4
                className="text-sm font-medium text-gray-800 truncate mb-1"
                title={file.fileName}
              >
                {file.fileName}
              </h4>
              <div className="flex justify-between items-center text-xs text-gray-500">
                <span>{formatFileSize(file.fileSize)}</span>
                <span>{formatDate(file.createdAt)}</span>
              </div>
            </div>
          </div>

          {/* Quick action button */}
          {isHovered && (
            <button
              className="absolute top-2 right-2 p-1 rounded-full bg-white bg-opacity-80 border border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-opacity-100"
              onClick={handleDotsClick}
            >
              <IconDotsVertical size={16} />
            </button>
          )}
        </div>

        {/* Context Menu */}
        {contextMenuPos && (
          <ContextMenu
            file={file}
            position={contextMenuPos}
            onClose={() => setContextMenuPos(null)}
            onPreview={onPreview ? () => onPreview(file) : undefined}
            onDownload={onDownload ? () => onDownload(file) : undefined}
            onRename={onRename ? () => onRename(file) : undefined}
            onDelete={onDelete ? () => onDelete(file) : undefined}
            onShowInfo={onShowInfo ? () => onShowInfo(file) : undefined}
            onCopyPath={handleCopyPath}
            readOnly={readOnly}
          />
        )}
      </>
    );
  }

  // List view
  return (
    <>
      <div
        className={`file-list-item flex items-center p-2 rounded-md ${
          isSelected
            ? "bg-purple-50"
            : isHovered
              ? "bg-gray-50"
              : "hover:bg-gray-50"
        } cursor-pointer transition-colors`}
        onClick={() => onSelect(file)}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        draggable={draggable}
        onDragStart={() => onDragStart && onDragStart(file)}
        onDragEnd={onDragEnd}
      >
        {/* Selection checkbox */}
        <div className="mr-2">
          <div
            className={`w-5 h-5 rounded border ${
              isSelected
                ? "bg-purple-500 border-purple-500 flex items-center justify-center"
                : "border-gray-300"
            }`}
          >
            {isSelected && <IconCheck size={14} className="text-white" />}
          </div>
        </div>

        {/* File icon and name */}
        <div className="flex items-center flex-1 min-w-0">
          <div className="mr-3">{getFileIcon(file, 22)}</div>
          <div>
            <h4
              className="text-sm font-medium text-gray-800 truncate"
              title={file.fileName}
            >
              {file.fileName}
            </h4>
            <div className="flex text-xs text-gray-500">
              <span className="mr-3">{formatFileSize(file.fileSize)}</span>
              <span>{formatDate(file.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Actions menu */}
        {isHovered && (
          <div className="actions flex items-center space-x-1">
            {onShowInfo && (
              <button
                className="p-1 text-gray-400 hover:text-purple-600 rounded-full hover:bg-gray-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowInfo(file);
                }}
                title="Properties"
              >
                <IconInfoCircle size={18} />
              </button>
            )}
            <button
              className="p-1 text-gray-400 hover:text-gray-800 rounded-full hover:bg-gray-100"
              onClick={handleDotsClick}
            >
              <IconDotsVertical size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenuPos && (
        <ContextMenu
          file={file}
          position={contextMenuPos}
          onClose={() => setContextMenuPos(null)}
          onPreview={onPreview ? () => onPreview(file) : undefined}
          onDownload={onDownload ? () => onDownload(file) : undefined}
          onRename={onRename ? () => onRename(file) : undefined}
          onDelete={onDelete ? () => onDelete(file) : undefined}
          onShowInfo={onShowInfo ? () => onShowInfo(file) : undefined}
          onCopyPath={handleCopyPath}
          readOnly={readOnly}
        />
      )}
    </>
  );
};

export default FileCard;
