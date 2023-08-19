import { Injectable, NotFoundException } from "@nestjs/common";
import { User, UserRole } from "../../auth/interfaces/user.interface";
import { PrismaService } from "../../prisma.service";
import { BaseAssignmentResponseDto } from "./dto/base.assignment.response.dto";
import { CreateUpdateAssignmentRequestDto } from "./dto/create.update.assignment.request.dto";
import {
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "./dto/get.assignment.response.dto";

@Injectable()
export class AssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: User): Promise<BaseAssignmentResponseDto> {
    // Create a new Assignment and connect it to a Group either by finding an existing Group with the given groupID
    // or by creating a new Group with that groupID
    const assignment = await this.prisma.assignment.create({
      data: {
        groups: {
          create: [
            {
              group: {
                connectOrCreate: {
                  where: {
                    id: user.groupID,
                  },
                  create: {
                    id: user.groupID,
                  },
                },
              },
            },
          ],
        },
      },
    });

    // Return the response
    return {
      id: assignment.id,
      success: true,
    };
  }

  async findOne(
    id: number,
    user: User
  ): Promise<GetAssignmentResponseDto | LearnerGetAssignmentResponseDto> {
    const includeQuestions = user.role !== UserRole.LEARNER;

    const result = await this.prisma.assignment.findUnique({
      where: { id },
      include: { questions: includeQuestions },
    });

    if (!result) {
      throw new NotFoundException(`Assignment with ID ${id} not found.`);
    }

    if (user.role === UserRole.LEARNER) {
      delete result["displayOrder"];
      return {
        ...result,
        success: true,
      } as LearnerGetAssignmentResponseDto;
    }

    // In case of Admin or Author, you might want to include the displayOrder and questions
    return {
      ...result,
      success: true,
    } as GetAssignmentResponseDto;
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

  async clone(id: number, user: User): Promise<BaseAssignmentResponseDto> {
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
                  id: user.groupID,
                },
                create: {
                  id: user.groupID,
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

  // private methods

  private createEmptyDto(): CreateUpdateAssignmentRequestDto {
    // Not including groupID as that should remain same to reflect correct ownership
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
