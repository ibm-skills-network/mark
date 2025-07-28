import { IsEnum, IsOptional, IsString } from "class-validator";
import { UploadType } from "./upload.dto";

export class CreateFolderDto {
  @IsString()
  name: string;

  @IsString()
  path: string;

  @IsEnum(UploadType)
  uploadType: UploadType;

  @IsOptional()
  context?: Record<string, unknown>;
}
