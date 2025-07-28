// src/components/FileExplorer/RenameDialog.tsx
import React, { useState, useEffect, useRef } from "react";
import { IconX } from "@tabler/icons-react";
import { FileObject } from "@/stores/fileStore";

interface RenameDialogProps {
  file: FileObject;
  onRename: (file: FileObject, newName: string) => void;
  onCancel: () => void;
}

const RenameDialog: React.FC<RenameDialogProps> = ({
  file,
  onRename,
  onCancel,
}) => {
  const [newFileName, setNewFileName] = useState<string>(file.fileName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();

      // Select filename without extension
      const lastDotIndex = file.fileName.lastIndexOf(".");
      if (lastDotIndex > 0) {
        inputRef.current.setSelectionRange(0, lastDotIndex);
      } else {
        inputRef.current.select();
      }
    }
  }, [file.fileName]);

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate new filename
    if (!newFileName || newFileName.trim() === "") {
      return; // Don't allow empty names
    }

    // Check if name actually changed
    if (newFileName === file.fileName) {
      onCancel();
      return;
    }

    onRename(file, newFileName);
  };

  // Handle key press
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black bg-opacity-50"
      onClick={onCancel}
    >
      <div
        className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Rename File</h3>
          <button
            className="text-gray-400 hover:text-gray-600"
            onClick={onCancel}
          >
            <IconX size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-purple-500 focus:border-purple-500"
          />

          <div className="flex justify-end space-x-3 mt-4">
            <button
              type="button"
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
            >
              Rename
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RenameDialog;
