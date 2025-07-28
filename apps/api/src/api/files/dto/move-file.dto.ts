import { IsEnum, IsOptional, IsString } from "class-validator";
import { UploadType } from "./upload.dto";

export class MoveFileDto {
  @IsOptional()
  @IsString()
  fileId?: string;

  @IsEnum(UploadType)
  uploadType: UploadType;

  @IsOptional()
  @IsString()
  sourceKey?: string;

  @IsString()
  targetPath: string;

  @IsOptional()
  @IsString()
  bucket?: string;
}
