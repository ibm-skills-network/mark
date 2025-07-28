import { ApiProperty } from "@nestjs/swagger";
import { ReportType } from "@prisma/client";
import { IsDefined, IsEnum, IsString } from "class-validator";

export class ReportRequestDTO {
  @ApiProperty({
    description: "Issue Type",
    enum: ReportType,
    enumName: "ReportType",
    required: true,
  })
  @IsEnum(ReportType)
  @IsDefined()
  issueType: ReportType;

  @ApiProperty({
    description: "The description of the issue.",
  })
  @IsString()
  description: string;
}
