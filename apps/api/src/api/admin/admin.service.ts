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
    groupId: string,
  ): Promise<BaseAssignmentResponseDto> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: id },
      include: { questions: true },
    });

    if (!assignment) {
      throw new NotFoundException(`Assignment with Id ${id} not found.`);
    }

    // Prepare data for new assignment (excluding id)
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

  // Method to get flagged submissions
  async getFlaggedSubmissions() {
    return this.prisma.regradingRequest.findMany({
      where: {
        regradingStatus: 'PENDING',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // Method to dismiss a flagged submission
  async dismissFlaggedSubmission(id: number) {
    return this.prisma.regradingRequest.update({
      where: { id },
      data: {
        regradingStatus: 'REJECTED',
      },
    });
  }

  // Method to get regrading requests
  async getRegradingRequests() {
    return this.prisma.regradingRequest.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // Method to approve a regrading request
  async approveRegradingRequest(id: number, newGrade: number) {
    const request = await this.prisma.regradingRequest.findUnique({
      where: { id },
    });

    if (!request) {
      throw new Error(`Regrading request with ID ${id} not found`);
    }

    // Update the regrading request status
    await this.prisma.regradingRequest.update({
      where: { id },
      data: {
        regradingStatus: 'APPROVED',
      },
    });

    // Update the assignment attempt grade
    await this.prisma.assignmentAttempt.update({
      where: { id: request.attemptId },
      data: {
        grade: newGrade / 100, // Convert percentage to decimal
      },
    });

    return { success: true };
  }

  // Method to reject a regrading request
  async rejectRegradingRequest(id: number, reason: string) {
    const request = await this.prisma.regradingRequest.findUnique({
      where: { id },
    });

    if (!request) {
      throw new Error(`Regrading request with ID ${id} not found`);
    }

    // Update the regrading request status
    await this.prisma.regradingRequest.update({
      where: { id },
      data: {
        regradingStatus: 'REJECTED',
        regradingReason: reason,
      },
    });

    return { success: true };
  }
  async addAssignmentToGroup(
    assignmentId: number,
    groupId: string,
  ): Promise<AdminAddAssignmentToGroupResponseDto> {
    // check if the assignment exists
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
      // Assignment is already connected to the group so should return success
      return {
        assignmentId: assignmentId,
        groupId: groupId,
        success: true,
      };
    }

    // Now, connect the assignment to the group or create the group if it doesn't exist
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

  // Method to get analytics for an assignment
  async getAssignmentAnalytics(assignmentId: number) {
    // Check if the assignment exists
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        questions: {
          where: { isDeleted: false },
        },
      },
    });

    if (!assignment) {
      throw new Error(`Assignment with ID ${assignmentId} not found`);
    }

    // Get all attempts for this assignment
    const attempts = await this.prisma.assignmentAttempt.findMany({
      where: {
        assignmentId,
        submitted: true,
      },
      include: {
        questionResponses: true,
      },
    });

    // Calculate average score
    const totalGrades = attempts.reduce((sum, attempt) => sum + (attempt.grade || 0), 0);
    const averageScore = attempts.length > 0 ? (totalGrades / attempts.length) * 100 : 0;

    // Calculate median score
    const grades = attempts.map(attempt => attempt.grade || 0).sort((a, b) => a - b);
    const medianIndex = Math.floor(grades.length / 2);
    const medianScore = grades.length > 0 
      ? (grades.length % 2 === 0 
          ? ((grades[medianIndex - 1] + grades[medianIndex]) / 2) 
          : grades[medianIndex]) * 100
      : 0;

    // Calculate completion rate
    const totalAttempts = attempts.length;
    const completedAttempts = attempts.filter(attempt => attempt.submitted).length;
    const completionRate = totalAttempts > 0 ? (completedAttempts / totalAttempts) * 100 : 0;

    // Calculate average completion time
    const completionTimes = attempts.map(attempt => {
      if (attempt.createdAt && attempt.expiresAt) {
        return new Date(attempt.expiresAt).getTime() - new Date(attempt.createdAt).getTime();
      }
      return 0;
    }).filter(time => time > 0);
    
    const avgTimeMs = completionTimes.length > 0 
      ? completionTimes.reduce((sum, time) => sum + time, 0) / completionTimes.length 
      : 0;
    const averageCompletionTime = Math.round(avgTimeMs / (1000 * 60)); // Convert to minutes

    // Calculate score distribution
    const scoreRanges = ['0-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80', '81-90', '91-100'];
    const scoreDistribution = scoreRanges.map(range => {
      const [min, max] = range.split('-').map(Number);
      const count = grades.filter(grade => {
        const score = grade * 100;
        return score >= min && score <= max;
      }).length;
      return { range, count };
    });

    // Calculate question breakdown
    const questionBreakdown = assignment.questions.map(question => {
      const responses = attempts.flatMap(attempt => 
        attempt.questionResponses.filter(response => response.questionId === question.id)
      );
      
      const totalPoints = responses.reduce((sum, response) => sum + response.points, 0);
      const averageScore = responses.length > 0 
        ? (totalPoints / (responses.length * question.totalPoints)) * 100 
        : 0;
      
      const incorrectResponses = responses.filter(response => 
        response.points < question.totalPoints
      );
      const incorrectRate = responses.length > 0 
        ? (incorrectResponses.length / responses.length) * 100 
        : 0;
      
      return {
        questionId: question.id,
        averageScore,
        incorrectRate,
      };
    });

    return {
      averageScore,
      medianScore,
      completionRate,
      totalAttempts,
      averageCompletionTime,
      scoreDistribution,
      questionBreakdown,
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
