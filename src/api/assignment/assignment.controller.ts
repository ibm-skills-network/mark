import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
  Put,
  Version,
} from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { AssignmentService } from "./assignment.service";
import { BaseAssignmentResponseDto } from "./dto/base.assignment.response.dto";
import { CreateAssignmentRequestDto } from "./dto/create.assignment.request.dto";
import { GetAssignmentResponseDto } from "./dto/get.assignment.response.dto";
import { UpdateAssignmentRequestDto } from "./dto/update.assignment.request.dto";

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
  create(
    @Body() createAssignmentRequestDto: CreateAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.create(createAssignmentRequestDto);
  }

  @Get(":id")
  findOne(@Param("id") id: number): Promise<GetAssignmentResponseDto> {
    return this.assignmentService.findOne(id);
  }

  @Put(":id")
  update(
    @Param("id") id: number,
    @Body() updateAssignmentRequestDto: UpdateAssignmentRequestDto
  ) {
    return this.assignmentService.update(id, updateAssignmentRequestDto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.assignmentService.remove(+id);
  }
}
