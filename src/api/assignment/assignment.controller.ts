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
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { AssignmentService } from "./assignment.service";
import { BaseAssignmentResponseDto } from "./dto/base.assignment.response.dto";
import { CreateUpdateAssignmentRequestDto } from "./dto/create.update.assignment.request.dto";
import { GetAssignmentResponseDto } from "./dto/get.assignment.response.dto";

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
  createAssignment(): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.create();
  }

  @Get(":id")
  @Version("1")
  getAssignment(@Param("id") id: number): Promise<GetAssignmentResponseDto> {
    return this.assignmentService.findOne(Number(id));
  }

  @Patch(":id")
  @Version("1")
  replaceAssignment(
    @Param("id") id: number,
    @Body() updateAssignmentRequestDto: CreateUpdateAssignmentRequestDto
  ) {
    return this.assignmentService.update(
      Number(id),
      updateAssignmentRequestDto
    );
  }

  @Put(":id")
  @Version("1")
  updateAssignment(
    @Param("id") id: number,
    @Body() updateAssignmentRequestDto: CreateUpdateAssignmentRequestDto
  ) {
    return this.assignmentService.replace(
      Number(id),
      updateAssignmentRequestDto
    );
  }

  @Delete(":id")
  @Version("1")
  deleteAssignment(@Param("id") id: number) {
    return this.assignmentService.remove(Number(id));
  }
}
