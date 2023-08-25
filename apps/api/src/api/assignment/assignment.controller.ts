import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Patch,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  refs,
} from "@nestjs/swagger";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { UserRequest, UserRole } from "../../auth/interfaces/user.interface";
import { Roles } from "../../auth/role/roles.global.guard";
import { AssignmentService } from "./assignment.service";
import { ASSIGNMENT_SCHEMA_URL } from "./constants";
import { BaseAssignmentResponseDto } from "./dto/base.assignment.response.dto";
import {
  AssignmentResponseDto,
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "./dto/get.assignment.response.dto";
import { ReplaceAssignmentRequestDto } from "./dto/replace.assignment.request.dto";
import { UpdateAssignmentRequestDto } from "./dto/update.assignment.request.dto";
import { AssignmentAccessControlGuard } from "./guards/assignment.access.control.guard";

@ApiTags(
  "Assignments (All the endpoints use a JWT Cookie named 'authentication' for authorization)"
)
@Injectable()
@Controller({
  path: "assignments",
  version: "1",
})
export class AssignmentController {
  private logger;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
    private readonly assignmentService: AssignmentService
  ) {
    this.logger = parentLogger.child({ context: AssignmentController.name });
  }

  @Get(":id")
  @Roles(UserRole.AUTHOR, UserRole.LEARNER)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Get assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiExtraModels(GetAssignmentResponseDto, LearnerGetAssignmentResponseDto)
  @ApiResponse({
    status: 200,
    schema: {
      anyOf: refs(GetAssignmentResponseDto, LearnerGetAssignmentResponseDto),
    },
    description:
      "The response structure varies based on the role of the user requesting the assignment i.e. learner/author/admin (see schema).",
  })
  @ApiResponse({ status: 403 })
  async getAssignment(
    @Param("id") id: number,
    @Req() request: UserRequest
  ): Promise<GetAssignmentResponseDto | LearnerGetAssignmentResponseDto> {
    return this.assignmentService.findOne(Number(id), request.user);
  }

  @Get()
  @Roles(UserRole.AUTHOR, UserRole.LEARNER)
  @ApiOperation({ summary: "List Assignments" })
  @ApiResponse({
    status: 200,
    type: [AssignmentResponseDto],
    description:
      "List assignments scoped to the user's role (doest include questions to avoid potentially large queries).",
  })
  @ApiResponse({ status: 403 })
  async listAssignments(
    @Req() request: UserRequest
  ): Promise<AssignmentResponseDto[]> {
    return this.assignmentService.list(request.user);
  }

  @Patch(":id")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Update assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({
    type: UpdateAssignmentRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  updateAssignment(
    @Param("id") id: number,
    @Body() updateAssignmentRequestDto: UpdateAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.update(
      Number(id),
      updateAssignmentRequestDto
    );
  }

  @Put(":id")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Replace assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({
    type: ReplaceAssignmentRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  replaceAssignment(
    @Param("id") id: number,
    @Body() replaceAssignmentRequestDto: ReplaceAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.replace(
      Number(id),
      replaceAssignmentRequestDto
    );
  }
}
