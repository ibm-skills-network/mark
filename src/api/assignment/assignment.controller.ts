import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Put,
  Version,
} from "@nestjs/common";
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { AssignmentService } from "./assignment.service";
import { ASSIGNMENT_SCHEMA_URL } from "./constants";
import { BaseAssignmentResponseDto } from "./dto/base.assignment.response.dto";
import { CreateUpdateAssignmentRequestDto } from "./dto/create.update.assignment.request.dto";
import { GetAssignmentResponseDto } from "./dto/get.assignment.response.dto";

@ApiTags(
  "Assignments (All the endpoints use a JWT Cookie named 'authentication' for authorization)"
)
@Injectable()
@Controller("assignments")
export class AssignmentController {
  private logger;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
    private readonly assignmentService: AssignmentService
  ) {
    this.logger = parentLogger.child({ context: AssignmentController.name });
  }

  @Post()
  @Version("1")
  @ApiOperation({ summary: "Create assignment" })
  @ApiBody({ type: CreateUpdateAssignmentRequestDto })
  @ApiResponse({ status: 201, type: BaseAssignmentResponseDto })
  createAssignment(): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.create();
  }

  @Get(":id")
  @Version("1")
  @ApiOperation({ summary: "Get assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: GetAssignmentResponseDto })
  getAssignment(@Param("id") id: number): Promise<GetAssignmentResponseDto> {
    return this.assignmentService.findOne(Number(id));
  }

  @Patch(":id")
  @Version("1")
  @ApiOperation({ summary: "Update assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({
    type: CreateUpdateAssignmentRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  updateAssignment(
    @Param("id") id: number,
    @Body() updateAssignmentRequestDto: CreateUpdateAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.update(
      Number(id),
      updateAssignmentRequestDto
    );
  }

  @Put(":id")
  @Version("1")
  @ApiOperation({ summary: "Replace assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({
    type: CreateUpdateAssignmentRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  replaceAssignment(
    @Param("id") id: number,
    @Body() updateAssignmentRequestDto: CreateUpdateAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.replace(
      Number(id),
      updateAssignmentRequestDto
    );
  }

  @Delete(":id")
  @Version("1")
  @ApiOperation({ summary: "Delete assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  deleteAssignment(
    @Param("id") id: number
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.remove(Number(id));
  }
}
