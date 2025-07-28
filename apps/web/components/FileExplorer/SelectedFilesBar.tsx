// src/components/FileExplorer/SelectedFilesBar.tsx
import React from "react";
import { IconX, IconTrash } from "@tabler/icons-react";
import { FileObject } from "@/stores/fileStore";
import { getFileIcon } from "./FileExplorer";

interface SelectedFilesBarProps {
  selectedFiles: FileObject[];
  onClearSelection: () => void;
  onRemoveFile: (file: FileObject) => void;
  onDeleteSelected?: () => void;
  onContinue: () => void;
}

const SelectedFilesBar: React.FC<SelectedFilesBarProps> = ({
  selectedFiles,
  onClearSelection,
  onRemoveFile,
  onDeleteSelected,
  onContinue,
}) => {
  if (selectedFiles.length === 0) {
    return null;
  }

  return (
    <div className="selected-files-bar mt-4 p-4 rounded-md flex flex-wrap items-center justify-between gap-2 w-full">
      <div className="flex items-center overflow-x-auto flex-grow">
        <span className="text-sm font-medium text-gray-700 mr-3 whitespace-nowrap">
          {selectedFiles.length} {selectedFiles.length === 1 ? "file" : "files"}{" "}
          selected
        </span>
        <div className="flex space-x-3 overflow-x-auto">
          {/* Show first 3 files, then a "+X more" indicator */}
          {selectedFiles.slice(0, 3).map((file) => (
            <div
              key={file.id}
              className="flex items-center space-x-2 bg-white px-2 py-1 rounded-md border border-gray-200 whitespace-nowrap"
            >
              {getFileIcon(file)}
              <span
                title={file.fileName}
                className="truncate max-w-[120px] text-sm"
              >
                {file.fileName}
              </span>
              <button
                className="text-gray-400 hover:text-gray-600"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFile(file);
                }}
                aria-label={`Remove ${file.fileName} from selection`}
              >
                <IconX size={14} />
              </button>
            </div>
          ))}
          {selectedFiles.length > 3 && (
            <span className="text-sm text-gray-500 py-1 whitespace-nowrap">
              +{selectedFiles.length - 3} more
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {onDeleteSelected && (
          <button
            className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 flex items-center"
            onClick={onDeleteSelected}
          >
            <IconTrash size={16} className="mr-1" />
            Delete
          </button>
        )}

        <button
          className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          onClick={onClearSelection}
        >
          Clear
        </button>

        <button
          className="px-4 py-1 text-sm bg-purple-600 text-white rounded hover:bg-purple-700"
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </div>
  );
};

export default SelectedFilesBar;
