export class FileMetadataDto {
  cosKey: string;
  cosBucket: string;
  fileName: string;
  fileType: string;
  contentType: string;
}

export class FileResponseDto {
  id: string;
  fileName: string;
  fileType: string;
  cosKey: string;
  cosBucket: string;
  fileSize?: number;
  createdAt: string;
  path: string;
}

export class FolderListingDto {
  folder: string;
  files: Array<{ key?: string; size?: number; lastModified?: Date }>;
  subfolders: string[];
}
