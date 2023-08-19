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
import { CreateUpdateAssignmentRequestDto } from "./dto/create.update.assignment.request.dto";
import {
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "./dto/get.assignment.response.dto";
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

  @Post()
  @Roles(UserRole.ADMIN, UserRole.AUTHOR)
  @ApiOperation({ summary: "Create assignment" })
  @ApiBody({ type: CreateUpdateAssignmentRequestDto })
  @ApiResponse({ status: 201, type: BaseAssignmentResponseDto })
  createAssignment(
    @Req() request: UserRequest
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.create(request.user);
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.AUTHOR, UserRole.LEARNER)
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
  async getAssignment(
    @Param("id") id: number,
    @Req() request: UserRequest
  ): Promise<GetAssignmentResponseDto | LearnerGetAssignmentResponseDto> {
    return this.assignmentService.findOne(Number(id), request.user);
  }

  @Patch(":id")
  @Roles(UserRole.ADMIN, UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
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
  @Roles(UserRole.ADMIN, UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
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
  @Roles(UserRole.ADMIN, UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Delete assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  deleteAssignment(
    @Param("id") id: number
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.remove(Number(id));
  }

  @Post(":id/clone")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Clone an assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  cloneAssignment(
    @Param("id") id: number,
    @Req() request: UserRequest
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.clone(Number(id), request.user);
  }
}
