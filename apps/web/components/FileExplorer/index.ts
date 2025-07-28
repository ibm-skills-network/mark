// src/components/FileExplorer/index.ts

// Main component
export { default as FileExplorer } from "./FileExplorer";

// Sub-components
export { BreadcrumbNav } from "./BreadcrumbNav";
export { default as SearchBar } from "./SearchBar";
export { default as Toolbar } from "./Toolbar";
export { default as FolderTree } from "./FolderTree";
export { default as FileList } from "./FileList";
export { default as FilePreview } from "./FilePreview";
export { default as RenameDialog } from "./RenameDialog";
export { default as SearchResults } from "./SearchResults";
export { default as SelectedFilesBar } from "./SelectedFilesBar";

// Store and utilities
export * from "../../stores/fileStore";
export * from "./utils/fileUtils";
export * from "./utils/fileActions";
