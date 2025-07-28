import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import { AdminAddAssignmentToGroupResponseDto } from "./dto/assignment/add.assignment.to.group.response.dto";
import { BaseAssignmentResponseDto } from "./dto/assignment/base.assignment.response.dto";
import {
  AdminCreateAssignmentRequestDto,
  AdminReplaceAssignmentRequestDto,
} from "./dto/assignment/create.replace.assignment.request.dto";
import { AdminGetAssignmentResponseDto } from "./dto/assignment/get.assignment.response.dto";
import { AdminUpdateAssignmentRequestDto } from "./dto/assignment/update.assignment.request.dto";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async cloneAssignment(
    id: number,
    groupId: string,
  ): Promise<BaseAssignmentResponseDto> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: id },
      include: { questions: true },
    });

    if (!assignment) {
      throw new NotFoundException(`Assignment with Id ${id} not found.`);
    }

    const newAssignmentData = {
      ...assignment,
      id: undefined,
      published: false,
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
      groups: {
        create: [
          {
            group: {
              connectOrCreate: {
                where: {
                  id: groupId,
                },
                create: {
                  id: groupId,
                },
              },
            },
          },
        ],
      },
    };

    const newAssignment = await this.prisma.assignment.create({
      data: newAssignmentData,
      include: { questions: true, groups: true },
    });

    return {
      id: newAssignment.id,
      success: true,
    };
  }

  async addAssignmentToGroup(
    assignmentId: number,
    groupId: string,
  ): Promise<AdminAddAssignmentToGroupResponseDto> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with Id ${assignmentId} not found.`,
      );
    }

    const assignmentGroup = await this.prisma.assignmentGroup.findFirst({
      where: {
        assignmentId: assignmentId,
        groupId: groupId,
      },
    });

    if (assignmentGroup) {
      return {
        assignmentId: assignmentId,
        groupId: groupId,
        success: true,
      };
    }

    await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        groups: {
          create: [
            {
              group: {
                connectOrCreate: {
                  where: {
                    id: groupId,
                  },
                  create: {
                    id: groupId,
                  },
                },
              },
            },
          ],
        },
      },
    });

    return {
      assignmentId: assignmentId,
      groupId: groupId,
      success: true,
    };
  }

  async createAssignment(
    createAssignmentRequestDto: AdminCreateAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    const assignment = await this.prisma.assignment.create({
      data: {
        name: createAssignmentRequestDto.name,
        type: createAssignmentRequestDto.type,
        published: false,
        groups: {
          create: [
            {
              group: {
                connectOrCreate: {
                  where: {
                    id: createAssignmentRequestDto.groupId,
                  },
                  create: {
                    id: createAssignmentRequestDto.groupId,
                  },
                },
              },
            },
          ],
        },
      },
    });

    return {
      id: assignment.id,
      success: true,
    };
  }

  async getAssignment(id: number): Promise<AdminGetAssignmentResponseDto> {
    const result = await this.prisma.assignment.findUnique({
      where: { id },
    });

    if (!result) {
      throw new NotFoundException(`Assignment with Id ${id} not found.`);
    }
    return {
      id: result.id,
      name: result.name,
      type: result.type,
      success: true,
    };
  }

  async updateAssignment(
    id: number,
    updateAssignmentDto: AdminUpdateAssignmentRequestDto,
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

  async replaceAssignment(
    id: number,
    updateAssignmentDto: AdminReplaceAssignmentRequestDto,
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

  async removeAssignment(id: number): Promise<BaseAssignmentResponseDto> {
    await this.prisma.questionResponse.deleteMany({
      where: { assignmentAttempt: { assignmentId: id } },
    });

    await this.prisma.assignmentAttemptQuestionVariant.deleteMany({
      where: { assignmentAttempt: { assignmentId: id } },
    });

    await this.prisma.assignmentAttempt.deleteMany({
      where: { assignmentId: id },
    });

    await this.prisma.assignmentGroup.deleteMany({
      where: { assignmentId: id },
    });

    await this.prisma.assignmentFeedback.deleteMany({
      where: { assignmentId: id },
    });

    await this.prisma.regradingRequest.deleteMany({
      where: { assignmentId: id },
    });

    await this.prisma.report.deleteMany({
      where: { assignmentId: id },
    });

    await this.prisma.assignmentTranslation.deleteMany({
      where: { assignmentId: id },
    });

    await this.prisma.aIUsage.deleteMany({
      where: { assignmentId: id },
    });

    await this.prisma.question.deleteMany({
      where: { assignmentId: id },
    });

    const assignmentExists = await this.prisma.assignment.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!assignmentExists) {
      throw new NotFoundException(`Assignment with Id ${id} not found.`);
    }

    await this.prisma.assignment.delete({
      where: { id },
    });

    return {
      id: id,
      success: true,
    };
  }
}
