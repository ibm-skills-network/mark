import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
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
    groupID: string
  ): Promise<BaseAssignmentResponseDto> {
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
      groups: {
        create: [
          {
            group: {
              connectOrCreate: {
                where: {
                  id: groupID,
                },
                create: {
                  id: groupID,
                },
              },
            },
          },
        ],
      },
    };

    // Create new assignment and questions in a single transaction
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
    assignmentID: number,
    groupID: string
  ): Promise<AdminAddAssignmentToGroupResponseDto> {
    // check if the assignment exists
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentID },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with ID ${assignmentID} not found.`
      );
    }

    const assignmentGroup = await this.prisma.assignmentGroup.findFirst({
      where: {
        assignmentId: assignmentID,
        groupId: groupID,
      },
    });

    if (assignmentGroup) {
      throw new BadRequestException(
        `Assignment with id '${assignmentID}' is already added to the group having id '${groupID}'`
      );
    }

    // Now, connect the assignment to the group or create the group if it doesn't exist
    await this.prisma.assignment.update({
      where: { id: assignmentID },
      data: {
        groups: {
          create: [
            {
              group: {
                connectOrCreate: {
                  where: {
                    id: groupID,
                  },
                  create: {
                    id: groupID,
                  },
                },
              },
            },
          ],
        },
      },
    });

    return {
      assignmentID: assignmentID,
      groupID: groupID,
      success: true,
    };
  }

  async createAssignment(
    createAssignmentRequestDto: AdminCreateAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    // Create a new Assignment and connect it to a Group either by finding an existing Group with the given groupID
    // or by creating a new Group with that groupID
    const assignment = await this.prisma.assignment.create({
      data: {
        name: createAssignmentRequestDto.name,
        type: createAssignmentRequestDto.type,
        groups: {
          create: [
            {
              group: {
                connectOrCreate: {
                  where: {
                    id: createAssignmentRequestDto.groupID,
                  },
                  create: {
                    id: createAssignmentRequestDto.groupID,
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
      throw new NotFoundException(`Assignment with ID ${id} not found.`);
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
    updateAssignmentDto: AdminUpdateAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    console.log(updateAssignmentDto);
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
    updateAssignmentDto: AdminReplaceAssignmentRequestDto
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
    // Delete all related records in AssignmentGroup table
    await this.prisma.assignmentGroup.deleteMany({
      where: { assignmentId: id },
    });

    const assignmentExists = await this.prisma.assignment.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!assignmentExists) {
      throw new NotFoundException(`Assignment with ID ${id} not found.`);
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
