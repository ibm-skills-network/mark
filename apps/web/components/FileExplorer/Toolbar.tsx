// src/components/FileExplorer/Toolbar.tsx
import React from "react";
import {
  IconListDetails,
  IconLayoutGrid,
  IconRefresh,
  IconFolderPlus,
  IconCloudUpload,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";

interface ToolbarProps {
  viewMode: "list" | "grid";
  setViewMode: (mode: "list" | "grid") => void;
  onRefresh: () => void;
  onCreateFolder?: () => void;
  onToggleUploader?: () => void;
  onToggleSidebar?: () => void;
  showSidebar?: boolean;
  readOnly?: boolean;
}

const Toolbar: React.FC<ToolbarProps> = ({
  viewMode,
  setViewMode,
  onRefresh,
  onCreateFolder,
  onToggleUploader,
  onToggleSidebar,
  showSidebar = true,
  readOnly = false,
}) => {
  return (
    <div className="actions-toolbar flex space-x-2">
      {/* View mode toggles */}
      <button
        className={`p-2 rounded-md ${
          viewMode === "list"
            ? "bg-gray-100 text-purple-600"
            : "text-gray-600 hover:bg-gray-100"
        }`}
        onClick={() => setViewMode("list")}
        title="List view"
      >
        <IconListDetails size={20} />
      </button>
      <button
        className={`p-2 rounded-md ${
          viewMode === "grid"
            ? "bg-gray-100 text-purple-600"
            : "text-gray-600 hover:bg-gray-100"
        }`}
        onClick={() => setViewMode("grid")}
        title="Grid view"
      >
        <IconLayoutGrid size={20} />
      </button>

      {/* Refresh button */}
      <button
        className="p-2 text-gray-600 hover:text-purple-500 rounded-md hover:bg-gray-100"
        onClick={onRefresh}
        title="Refresh"
      >
        <IconRefresh size={20} />
      </button>

      {/* Actions available when not in read-only mode */}
      {!readOnly && (
        <>
          {onCreateFolder && (
            <button
              className="p-2 text-gray-600 hover:text-purple-500 rounded-md hover:bg-gray-100"
              onClick={onCreateFolder}
              title="Create folder"
            >
              <IconFolderPlus size={20} />
            </button>
          )}

          {onToggleUploader && (
            <button
              className="p-2 text-gray-600 hover:text-purple-500 rounded-md hover:bg-gray-100"
              onClick={onToggleUploader}
              title="Upload files"
            >
              <IconCloudUpload size={20} />
            </button>
          )}
        </>
      )}

      {/* Toggle sidebar button (only on mobile) */}
      {onToggleSidebar && (
        <button
          className="p-2 text-gray-600 hover:text-purple-500 rounded-md hover:bg-gray-100 md:hidden"
          onClick={onToggleSidebar}
          title={showSidebar ? "Hide sidebar" : "Show sidebar"}
        >
          {showSidebar ? (
            <IconChevronLeft size={20} />
          ) : (
            <IconChevronRight size={20} />
          )}
        </button>
      )}
    </div>
  );
};

export default Toolbar;
