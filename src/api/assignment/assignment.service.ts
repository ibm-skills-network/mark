import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import { BaseAssignmentResponseDto } from "./dto/base.assignment.response.dto";
import { CreateUpdateAssignmentRequestDto } from "./dto/create.update.assignment.request.dto";
import { GetAssignmentResponseDto } from "./dto/get.assignment.response.dto";

@Injectable()
export class AssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(): Promise<BaseAssignmentResponseDto> {
    const result = await this.prisma.assignment.create({
      data: {},
    });

    return {
      id: result.id,
      success: true,
    };
  }

  async findOne(id: number): Promise<GetAssignmentResponseDto> {
    const result = await this.prisma.assignment.findUnique({
      where: { id },
      include: { questions: true },
    });

    if (!result) {
      throw new NotFoundException(`Assignment with ID ${id} not found.`);
    }

    return {
      ...result,
      success: true,
    };
  }

  async replace(
    id: number,
    updateAssignmentDto: CreateUpdateAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    const result = await this.prisma.assignment.update({
      where: { id },
      data: {
        ...this.createEmptyDto(),
        ...updateAssignmentDto,
      },
    });

    return {
      id: result.id,
      success: true,
    };
  }

  async update(
    id: number,
    updateAssignmentDto: CreateUpdateAssignmentRequestDto
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

  private createEmptyDto(): CreateUpdateAssignmentRequestDto {
    /* eslint-disable unicorn/no-null */
    return {
      name: null,
      type: null,
      numRetries: null,
      numAttempts: null,
      allotedTime: null,
      passingGrade: null,
      displayOrder: null,
    };
    /* eslint-enable unicorn/no-null */
  }
}
