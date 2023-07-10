import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import { BaseAssignmentResponseDto } from "./dto/base.assignment.response.dto";
import { CreateAssignmentRequestDto } from "./dto/create.assignment.request.dto";
import { GetAssignmentResponseDto } from "./dto/get.assignment.response.dto";
import { UpdateAssignmentRequestDto } from "./dto/update.assignment.request.dto";

@Injectable()
export class AssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    createAssignmentDto: CreateAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    const result = await this.prisma.assignment.create({
      data: createAssignmentDto,
    });

    return {
      id: result.id,
      success: true,
    };
  }

  async findOne(id: number): Promise<GetAssignmentResponseDto> {
    const result = await this.prisma.assignment.findUnique({
      where: { id },
    });

    if (!result) {
      throw new NotFoundException(`Assignment with ID ${id} not found.`);
    }

    return {
      ...result,
      success: true,
    };
  }

  async update(
    id: number,
    updateAssignmentDto: UpdateAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    const result = await this.prisma.assignment.update({
      where: { id },
      data: updateAssignmentDto,
    });

    return {
      id: result.id,
      success: true,
    };
  }

  async remove(id: number): Promise<BaseAssignmentResponseDto> {
    const result = await this.prisma.assignment.delete({
      where: { id },
    });

    return {
      id: result.id,
      success: true,
    };
  }
}
