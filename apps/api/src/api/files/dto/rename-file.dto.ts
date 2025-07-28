import { IsOptional, IsString } from "class-validator";

export class RenameFileDto {
  @IsOptional()
  @IsString()
  fileId?: string;

  @IsString()
  uploadType: string;

  @IsOptional()
  @IsString()
  sourceKey?: string;

  @IsString()
  newFileName: string;

  @IsOptional()
  @IsString()
  bucket?: string;
}
