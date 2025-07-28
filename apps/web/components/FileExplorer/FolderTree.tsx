// Completely rewritten FolderTree.tsx with isolated chevron click handling
import React, { useState } from "react";
import {
  IconFolder,
  IconFolderOpen,
  IconChevronDown,
  IconChevronRight,
  IconDotsVertical,
} from "@tabler/icons-react";
import { FolderStructure } from "./utils/fileUtils";
import { FileObject } from "@/stores/fileStore";
import { getFileIcon } from "./FileExplorer";
import FolderContextMenu from "./FolderContextMenu";

interface FolderTreeProps {
  folderStructure: FolderStructure;
  currentPath: string;
  onFolderClick: (path: string) => void;
  onFileClick: (file: FileObject) => void;
  onToggleFolder: (path: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onDeleteFolder?: (path: string) => void;
  onDragStart?: (file: FileObject) => void;
  onDragEnd?: () => void;
  onFolderDragOver?: (e: React.DragEvent, path: string) => void;
  onFolderDragLeave?: () => void;
  onFolderDrop?: (e: React.DragEvent, path: string) => void;
  onUploadToFolder?: (path: string) => void;
  readOnly?: boolean;
  dropTarget?: string | null;
}

// This is a completely separate chevron component to fully isolate the toggle behavior
const ChevronToggle: React.FC<{
  isExpanded: boolean;
  onClick: (e: React.MouseEvent) => void;
  visible: boolean;
}> = ({ isExpanded, onClick, visible }) => {
  if (!visible) {
    return <div className="w-5 flex-shrink-0"></div>;
  }

  return (
    <div
      className="w-5 flex-shrink-0 flex items-center justify-center cursor-pointer"
      onClick={onClick}
    >
      {isExpanded ? (
        <IconChevronDown size={18} className="text-gray-500" />
      ) : (
        <IconChevronRight size={18} className="text-gray-500" />
      )}
    </div>
  );
};

// Isolated folder component to prevent re-renders affecting other folders
const FolderItem: React.FC<{
  folder: FolderStructure;
  depth: number;
  currentPath: string;
  onFolderClick: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, folder: FolderStructure) => void;
  onDotsClick: (e: React.MouseEvent, folder: FolderStructure) => void;
  isDropTarget: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}> = ({
  folder,
  depth,
  currentPath,
  onFolderClick,
  onToggleFolder,
  onContextMenu,
  onDotsClick,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
}) => {
  // Local state to avoid dependencies on outside renders
  const [lastClickTime, setLastClickTime] = useState(0);

  const isCurrentFolder = folder.path === currentPath;
  const isExpanded = !!folder.expanded;
  const hasContent =
    (folder.folders && folder.folders.length > 0) ||
    (folder.files && folder.files.length > 0) ||
    !!folder.isEmpty;

  // Dedicated handler for chevron clicks with debounce
  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // Debounce to prevent multiple rapid clicks
    const now = Date.now();
    if (now - lastClickTime < 300) {
      return;
    }
    setLastClickTime(now);

    onToggleFolder(folder.path);
  };

  // Separate handler for folder clicks to navigate
  const handleFolderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFolderClick(folder.path);
  };

  return (
    <div
      className="folder-item"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        style={{ marginLeft: `${depth * 16}px` }}
        className={`flex items-center py-1.5 px-2 rounded cursor-pointer hover:bg-gray-100 group ${
          isCurrentFolder ? "bg-purple-100" : ""
        } ${isDropTarget ? "bg-purple-50 border border-purple-300" : ""}`}
        onContextMenu={(e) => onContextMenu(e, folder)}
      >
        {/* Completely separate chevron component */}
        <ChevronToggle
          isExpanded={isExpanded}
          onClick={handleChevronClick}
          visible={hasContent}
        />

        {/* Folder icon and label */}
        <div
          className="flex items-center flex-1 truncate py-0.5 ml-1"
          onClick={handleFolderClick}
        >
          <div className="mr-1.5">
            {isExpanded ? (
              <IconFolderOpen size={18} className="text-yellow-500" />
            ) : (
              <IconFolder size={18} className="text-yellow-500" />
            )}
          </div>

          <span className="truncate text-sm" title={folder.name || "Root"}>
            {folder.name || "Root"}
          </span>
        </div>

        {/* Context menu trigger (dots menu) */}
        <div className="opacity-0 group-hover:opacity-100 ml-1">
          <button
            className="p-1 text-gray-400 hover:text-gray-700 rounded-full hover:bg-gray-200"
            onClick={(e) => {
              e.stopPropagation();
              onDotsClick(e, folder);
            }}
          >
            <IconDotsVertical size={14} />
          </button>
        </div>

        {/* Count badge */}
        {hasContent && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs">
            {(folder.folders?.length || 0) +
              (folder.files?.length || 0) +
              (folder.isEmpty ? 1 : 0)}
          </span>
        )}
      </div>
    </div>
  );
};

const FolderTree: React.FC<FolderTreeProps> = ({
  folderStructure,
  currentPath,
  onFolderClick,
  onFileClick,
  onToggleFolder,
  onCreateFolder,
  onDeleteFolder,
  onDragStart,
  onDragEnd,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  onUploadToFolder,
  readOnly = false,
  dropTarget = null,
}) => {
  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
    path: string;
    name: string;
  } | null>(null);

  // Show context menu for folder
  const handleFolderContextMenu = (
    e: React.MouseEvent,
    folder: FolderStructure,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPos({
      x: e.clientX,
      y: e.clientY,
      path: folder.path,
      name: folder.name,
    });
  };

  // Handle when dots menu is clicked
  const handleDotsClick = (e: React.MouseEvent, folder: FolderStructure) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenuPos({
      x: rect.right,
      y: rect.top,
      path: folder.path,
      name: folder.name,
    });
  };

  // Copy folder path
  const handleCopyPath = (path: string) => {
    void navigator.clipboard.writeText(path);
  };

  // Handle folder deletion with confirmation
  const handleDeleteFolder = (path: string) => {
    if (
      window.confirm(
        `Are you sure you want to delete the folder "${path}" and ALL its contents? This cannot be undone.`,
      )
    ) {
      onDeleteFolder?.(path);
    }
  };

  // Recursive function to render folder tree with isolated components
  const renderTree = (folder: FolderStructure, depth = 0) => {
    const isExpanded = !!folder.expanded;

    return (
      <div key={folder.path} className="folder-tree-item">
        <FolderItem
          folder={folder}
          depth={depth}
          currentPath={currentPath}
          onFolderClick={onFolderClick}
          onToggleFolder={onToggleFolder}
          onContextMenu={handleFolderContextMenu}
          onDotsClick={handleDotsClick}
          isDropTarget={dropTarget === folder.path}
          onDragOver={
            onFolderDragOver
              ? (e) => onFolderDragOver(e, folder.path)
              : undefined
          }
          onDragLeave={onFolderDragLeave}
          onDrop={
            onFolderDrop ? (e) => onFolderDrop(e, folder.path) : undefined
          }
        />

        {/* Render children only if expanded */}
        {isExpanded && (
          <div className="folder-contents">
            {/* Recurse for subfolders */}
            {folder.folders &&
              folder.folders.map((subFolder) =>
                renderTree(subFolder, depth + 1),
              )}

            {/* Render files in this folder */}
            {folder.files &&
              folder.files.map((file) => (
                <div
                  key={file.id}
                  style={{ paddingLeft: `${(depth + 1) * 16 + 24}px` }}
                  className="flex items-center py-1.5 rounded hover:bg-gray-100 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFileClick(file);
                  }}
                  draggable={!readOnly && !!onDragStart}
                  onDragStart={
                    onDragStart ? () => onDragStart(file) : undefined
                  }
                  onDragEnd={onDragEnd}
                >
                  {getFileIcon(file)}
                  <span
                    title={file.fileName}
                    className="ml-2 truncate text-sm text-gray-700"
                  >
                    {file.fileName}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="folder-tree">
      {renderTree(folderStructure)}

      {/* Context Menu */}
      {contextMenuPos && (
        <FolderContextMenu
          folderName={contextMenuPos.name}
          position={{ x: contextMenuPos.x, y: contextMenuPos.y }}
          onClose={() => setContextMenuPos(null)}
          onNavigate={() => {
            onFolderClick(contextMenuPos.path);
            setContextMenuPos(null);
          }}
          onCreateSubfolder={
            onCreateFolder
              ? () => onCreateFolder(contextMenuPos.path)
              : undefined
          }
          onDeleteFolder={
            onDeleteFolder && contextMenuPos.path !== "/"
              ? () => handleDeleteFolder(contextMenuPos.path)
              : undefined
          }
          onUploadToFolder={
            onUploadToFolder
              ? () => onUploadToFolder(contextMenuPos.path)
              : undefined
          }
          onCopyPath={() => handleCopyPath(contextMenuPos.path)}
          isRootFolder={contextMenuPos.path === "/"}
          readOnly={readOnly}
        />
      )}
    </div>
  );
};

export default FolderTree;
