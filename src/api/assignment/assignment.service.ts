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

  async clone(id: number): Promise<BaseAssignmentResponseDto> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: id },
      include: { questions: true },
    });

    if (!assignment) {
      throw new NotFoundException(`Assignment with ID ${id} not found.`);
    }

    // Prepare data for new assignment (excluding id)
    const newAssignmentData = {
      ...assignment,
      id: undefined,
      questions: {
        createMany: {
          data: assignment.questions.map((question) => ({
            ...question,
            id: undefined,
            assignment: undefined,
            assignmentId: undefined,
            scoring: question.scoring ? { set: question.scoring } : undefined,
            choices: question.choices ? { set: question.choices } : undefined,
          })),
        },
      },
    };

    // Create new assignment and questions in a single transaction
    const newAssignment = await this.prisma.assignment.create({
      data: newAssignmentData,
      include: { questions: true },
    });

    return {
      id: newAssignment.id,
      success: true,
    };
  }

  private createEmptyDto(): CreateUpdateAssignmentRequestDto {
    /* eslint-disable unicorn/no-null */
    return {
      name: null,
      type: null,
      numAttempts: null,
      allotedTime: null,
      passingGrade: null,
      displayOrder: null,
    };
    /* eslint-enable unicorn/no-null */
  }
}
