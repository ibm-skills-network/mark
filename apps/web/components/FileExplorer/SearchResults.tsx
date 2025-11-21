import React from "react";
import {
  IconSearch,
  IconEye,
  IconDownload,
  IconEdit,
  IconTrash,
} from "@tabler/icons-react";
import { FileObject } from "@/stores/fileStore";
import { formatFileSize } from "./utils/fileUtils";
import { getFileIcon } from "./FileExplorer";
import { EnhancedFileObject } from "@/config/types";

interface SearchResultsProps {
  searchTerm: string;
  results: FileObject[];
  selectedFiles: FileObject[];
  onFileSelect: (file: FileObject) => void;
  onNavigateToFolder: (path: string) => void;
  onPreview: (file: FileObject) => void;
  onDownload: (file: EnhancedFileObject) => void;
  onRename?: (file: FileObject) => void;
  onDelete?: (file: FileObject) => void;
  readOnly?: boolean;
}

const SearchResults: React.FC<SearchResultsProps> = ({
  searchTerm,
  results,
  selectedFiles,
  onFileSelect,
  onNavigateToFolder,
  onPreview,
  onDownload,
  onRename,
  onDelete,
  readOnly = false,
}) => {
  if (!searchTerm) {
    return null;
  }

  if (results.length === 0) {
    return (
      <div className="text-gray-500 p-8 text-center rounded-lg border border-gray-200 bg-gray-50">
        <IconSearch size={40} className="mx-auto mb-2 text-gray-400" />
        <p className="font-medium">No files found matching "{searchTerm}"</p>
        <p className="text-sm mt-1">
          Try adjusting your search term or browse folders instead.
        </p>
      </div>
    );
  }

  return (
    <div className="search-results">
      <h3 className="text-sm font-medium text-gray-500 mb-2">
        Search Results for "{searchTerm}" ({results.length} files found)
      </h3>

      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Location
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Size
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {results.map((file) => {
              const isSelected = selectedFiles.some((f) => f.id === file.id);
              return (
                <tr
                  key={file.id}
                  className={`hover:bg-gray-50 ${
                    isSelected ? "bg-purple-50" : ""
                  }`}
                  onClick={() => onFileSelect(file)}
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {getFileIcon(file)}
                      <span
                        title={file.fileName}
                        className="ml-2 truncate max-w-[150px]"
                      >
                        {file.fileName}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span
                      className="cursor-pointer hover:text-purple-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateToFolder(file.path || "/");
                      }}
                      title="Navigate to this folder"
                    >
                      {file.path || "/"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatFileSize(file.fileSize)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end space-x-2">
                      <button
                        className="text-purple-600 hover:text-purple-900"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPreview(file);
                        }}
                        title="Preview"
                      >
                        <IconEye size={18} />
                      </button>
                      <button
                        className="text-indigo-600 hover:text-indigo-900"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDownload(file as unknown as EnhancedFileObject);
                        }}
                        title="Download"
                      >
                        <IconDownload size={18} />
                      </button>
                      {!readOnly && onRename && onDelete && (
                        <>
                          <button
                            className="text-gray-600 hover:text-gray-900"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRename(file);
                            }}
                            title="Rename"
                          >
                            <IconEdit size={18} />
                          </button>
                          <button
                            className="text-red-600 hover:text-red-900"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(file);
                            }}
                            title="Delete"
                          >
                            <IconTrash size={18} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SearchResults;
