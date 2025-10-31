import React from "react";
import {
  IconFolder,
  IconSortAscending,
  IconSortDescending,
  IconArrowsSort,
  IconEye,
  IconDownload,
  IconEdit,
  IconTrash,
  IconCheck,
  IconFile,
} from "@tabler/icons-react";
import { formatFileSize, getFileExtension } from "./utils/fileUtils";
import { SortField, SortDirection, FileObject } from "@/stores/fileStore";
import { getFileIcon } from "./FileExplorer";
import { EnhancedFileObject } from "@/config/types";

interface FileListProps {
  files: FileObject[];
  folders: { name: string; path: string }[];
  selectedFiles: FileObject[];
  sortField: SortField;
  sortDirection: SortDirection;
  viewMode: "list" | "grid";
  onFileSelect: (file: FileObject) => void;
  onFolderSelect: (path: string) => void;
  onPreview: (file: FileObject) => void;
  onSortDirectionChange: (direction: SortDirection) => void;
  onDownload: (file: EnhancedFileObject) => void;
  onRename?: (file: FileObject) => void;
  onDelete?: (file: FileObject) => void;
  onSort: (field: SortField) => void;
  onDragStart?: (file: FileObject) => void;
  onDragEnd?: () => void;
  onFolderDragOver?: (e: React.DragEvent, path: string) => void;
  onFolderDragLeave?: () => void;
  onFolderDrop?: (e: React.DragEvent, path: string) => void;
  readOnly?: boolean;
  dropTarget?: string | null;
}

const FileList: React.FC<FileListProps> = ({
  files,
  folders,
  selectedFiles,
  sortField,
  sortDirection,
  viewMode,
  onFileSelect,
  onFolderSelect,
  onPreview,
  onDownload,
  onRename,
  onDelete,
  onSort,
  onDragStart,
  onDragEnd,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  onSortDirectionChange,
  readOnly = false,
  dropTarget = null,
}) => {
  if (files.length === 0 && folders.length === 0) {
    return (
      <div className="text-gray-500 p-8 text-center rounded-lg border border-gray-200 bg-gray-50">
        <div className="mb-4">
          <IconFile size={40} className="mx-auto text-gray-400" />
        </div>
        <p className="font-medium">This folder is empty</p>
        <p className="text-sm mt-1 mb-4">
          Upload files or create subfolders to organize your content.
        </p>
      </div>
    );
  }

  const renderFolders = () => {
    if (folders.length === 0) return null;

    return (
      <div className="folder-section mb-6">
        <h3 className="text-sm font-medium text-gray-500 mb-3">Folders</h3>
        <div
          className={
            viewMode === "grid"
              ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
              : "flex flex-col divide-y divide-gray-100"
          }
        >
          {folders.map((folder) => (
            <div
              key={folder.path}
              className={`folder-item flex items-center ${
                viewMode === "grid"
                  ? "p-3 border border-gray-200 rounded-md hover:bg-gray-50 hover:border-gray-300 transition-colors"
                  : "p-3 hover:bg-gray-50 transition-colors"
              } cursor-pointer ${
                dropTarget === folder.path
                  ? "bg-purple-50 border-purple-300"
                  : ""
              }`}
              onClick={() => onFolderSelect(folder.path)}
              onDragOver={
                onFolderDragOver
                  ? (e) => onFolderDragOver(e, folder.path)
                  : undefined
              }
              onDragLeave={onFolderDragLeave}
              onDrop={
                onFolderDrop ? (e) => onFolderDrop(e, folder.path) : undefined
              }
            >
              <IconFolder
                size={viewMode === "grid" ? 24 : 20}
                className="text-yellow-500 mr-3 flex-shrink-0"
              />

              <span className="truncate font-medium text-gray-700">
                {folder.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFilesGrid = () => {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {files.map((file) => {
          const isSelected = selectedFiles.some((f) => f.id === file.id);
          return (
            <div
              key={file.id}
              className={`file-card border rounded-md p-3 ${
                isSelected
                  ? "bg-purple-50 border-purple-300 ring-2 ring-purple-300 ring-opacity-50"
                  : "border-gray-200"
              } hover:shadow-sm transition-all duration-200 relative`}
              onClick={() => onFileSelect(file)}
              draggable={!readOnly && !!onDragStart}
              onDragStart={onDragStart ? () => onDragStart(file) : undefined}
              onDragEnd={onDragEnd}
            >
              {isSelected && (
                <div className="absolute top-2 right-2 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
                  <IconCheck size={14} className="text-white" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <h4
                  className="text-sm font-medium text-gray-800 truncate"
                  title={file.fileName}
                >
                  {file.fileName}
                </h4>
                {file.fileName.length > 20 && (
                  <p
                    className="text-xs text-gray-500 truncate"
                    title={file.fileName}
                  >
                    {file.fileName.substring(0, 8)}...
                    {file.fileName.substring(file.fileName.length - 8)}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  {formatFileSize(file.fileSize)}
                </p>
              </div>

              <div className="text-xs text-gray-500 flex justify-between items-center">
                <span>{new Date(file.createdAt).toLocaleDateString()}</span>

                <div className="flex space-x-1">
                  <button
                    className="p-1 text-gray-400 hover:text-purple-600 rounded-full hover:bg-gray-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPreview(file);
                    }}
                    title="Preview"
                  >
                    <IconEye size={16} />
                  </button>
                  <button
                    className="p-1 text-gray-400 hover:text-indigo-600 rounded-full hover:bg-gray-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(file as unknown as EnhancedFileObject);
                    }}
                    title="Download"
                  >
                    <IconDownload size={16} />
                  </button>
                  {!readOnly && onRename && onDelete && (
                    <>
                      <button
                        className="p-1 text-gray-400 hover:text-gray-700 rounded-full hover:bg-gray-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRename(file);
                        }}
                        title="Rename"
                      >
                        <IconEdit size={16} />
                      </button>
                      <button
                        className="p-1 text-gray-400 hover:text-red-600 rounded-full hover:bg-gray-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(file);
                        }}
                        title="Delete"
                      >
                        <IconTrash size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderFilesList = () => {
    return (
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => onSort("name")}
              >
                <div className="flex items-center">
                  Name
                  {sortField === "name" &&
                    (sortDirection === "asc" ? (
                      <IconSortAscending size={14} className="ml-1" />
                    ) : (
                      <IconSortDescending size={14} className="ml-1" />
                    ))}
                  {sortField !== "name" && (
                    <IconArrowsSort size={14} className="ml-1 opacity-50" />
                  )}
                </div>
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => onSort("type")}
              >
                <div className="flex items-center">
                  Type
                  {sortField === "type" &&
                    (sortDirection === "asc" ? (
                      <IconSortAscending size={14} className="ml-1" />
                    ) : (
                      <IconSortDescending size={14} className="ml-1" />
                    ))}
                  {sortField !== "type" && (
                    <IconArrowsSort size={14} className="ml-1 opacity-50" />
                  )}
                </div>
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => onSort("size")}
              >
                <div className="flex items-center">
                  Size
                  {sortField === "size" &&
                    (sortDirection === "asc" ? (
                      <IconSortAscending size={14} className="ml-1" />
                    ) : (
                      <IconSortDescending size={14} className="ml-1" />
                    ))}
                  {sortField !== "size" && (
                    <IconArrowsSort size={14} className="ml-1 opacity-50" />
                  )}
                </div>
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => onSort("date")}
              >
                <div className="flex items-center">
                  Date
                  {sortField === "date" &&
                    (sortDirection === "asc" ? (
                      <IconSortAscending size={14} className="ml-1" />
                    ) : (
                      <IconSortDescending size={14} className="ml-1" />
                    ))}
                  {sortField !== "date" && (
                    <IconArrowsSort size={14} className="ml-1 opacity-50" />
                  )}
                </div>
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {files.map((file) => {
              const isSelected = selectedFiles.some((f) => f.id === file.id);
              const extension = getFileExtension(file.fileName);
              return (
                <tr
                  key={file.id}
                  className={`hover:bg-gray-50 ${
                    isSelected ? "bg-purple-50" : ""
                  }`}
                  onClick={() => onFileSelect(file)}
                  draggable={!readOnly && !!onDragStart}
                  onDragStart={
                    onDragStart ? () => onDragStart(file) : undefined
                  }
                  onDragEnd={onDragEnd}
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div
                      key={file.id}
                      className="flex items-center space-x-2 bg-white px-2 py-1 rounded-md border border-gray-200"
                    >
                      {getFileIcon(file)}
                      <div className="flex flex-col">
                        <span
                          title={file.fileName}
                          className="truncate max-w-[120px] text-sm"
                        >
                          {file.fileName.length > 15
                            ? `${file.fileName.substring(
                                0,
                                7,
                              )}...${file.fileName.substring(
                                file.fileName.length - 5,
                              )}`
                            : file.fileName}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {extension.toUpperCase()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatFileSize(file.fileSize)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(file.createdAt).toLocaleDateString()}
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
    );
  };

  return (
    <div className="file-list">
      {renderFolders()}

      {files.length > 0 && (
        <div className="files-section">
          {viewMode === "grid" ? renderFilesGrid() : renderFilesList()}
        </div>
      )}
    </div>
  );
};

export default FileList;
