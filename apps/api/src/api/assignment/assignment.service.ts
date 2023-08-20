import { Injectable, NotFoundException } from "@nestjs/common";
import { User, UserRole } from "../../auth/interfaces/user.interface";
import { PrismaService } from "../../prisma.service";
import { BaseAssignmentResponseDto } from "./dto/base.assignment.response.dto";
import { CreateUpdateAssignmentRequestDto } from "./dto/create.update.assignment.request.dto";
import {
  AssignmentResponseDto,
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

    // If learner then get rid of irrelevant/sensitive fields like questions and displayOrder
    if (user.role === UserRole.LEARNER) {
      delete result["displayOrder"];
      return {
        ...result,
        success: true,
      } as LearnerGetAssignmentResponseDto;
    }

    return {
      ...result,
      success: true,
    } as GetAssignmentResponseDto;
  }

  async list(user: User): Promise<AssignmentResponseDto[]> {
    const results = await this.prisma.assignmentGroup.findMany({
      where: { groupId: user.groupID },
      include: {
        assignment: true,
      },
    });

    if (!results) {
      throw new NotFoundException(`Group with ID ${user.groupID} not found.`);
    }

    return results.map((result) => ({
      ...result.assignment,
    }));
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
