import { Injectable } from "@nestjs/common";
import { Assignment, AssignmentAttempt } from "@prisma/client";
import { PrismaService } from "src/prisma.service";
import { RegradingRequestDto } from "../assignment/attempt/dto/assignment-attempt/feedback.request.dto";

@Injectable()
export class AdminRepository {
  constructor(private prisma: PrismaService) {}

  async findAssignmentById(id: number) {
    return this.prisma.assignment.findUnique({
      where: { id },
      include: {
        questions: {
          where: { isDeleted: false },
          include: {
            variants: {
              where: { isDeleted: false },
            },
          },
        },
      },
    });
  }
  async findAssignmentByGroupId(groupId: string) {
    return this.prisma.assignment.findMany({
      where: {
        groups: {
          some: {
            groupId,
          },
        },
      },
      include: {
        questions: {
          where: { isDeleted: false },
          include: {
            variants: {
              where: { isDeleted: false },
            },
          },
        },
      },
    });
  }

  async findAllAssignments() {
    return this.prisma.assignment.findMany({
      orderBy: {
        updatedAt: "desc",
      },
    });
  }

  async createAssignment(data: Assignment) {
    return this.prisma.assignment.create({
      data,
    });
  }

  async updateAssignment(id: number, data: Assignment) {
    return this.prisma.assignment.update({
      where: { id },
      data,
    });
  }

  async deleteAssignment(id: number) {
    return this.prisma.assignment.delete({
      where: { id },
    });
  }

  async findGroupById(id: string) {
    return this.prisma.group.findUnique({
      where: { id },
    });
  }

  async createGroup(id: string) {
    return this.prisma.group.create({
      data: { id },
    });
  }

  async createAssignmentGroup(assignmentId: number, groupId: string) {
    return this.prisma.assignmentGroup.create({
      data: {
        assignmentId,
        groupId,
      },
    });
  }

  async findAllFlaggedSubmissions() {
    return this.prisma.regradingRequest.findMany({
      where: {
        regradingStatus: "PENDING",
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findRegradingRequestById(id: number) {
    return this.prisma.regradingRequest.findUnique({
      where: { id },
    });
  }

  async updateRegradingRequest(id: number, data: RegradingRequestDto) {
    return this.prisma.regradingRequest.update({
      where: { id },
      data,
    });
  }

  async findAllRegradingRequests() {
    return this.prisma.regradingRequest.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findAssignmentAttemptById(id: number) {
    return this.prisma.assignmentAttempt.findUnique({
      where: { id },
    });
  }

  async updateAssignmentAttempt(id: number, data: AssignmentAttempt) {
    return this.prisma.assignmentAttempt.update({
      where: { id },
      data,
    });
  }

  async findAttemptsByAssignmentId(assignmentId: number) {
    return this.prisma.assignmentAttempt.findMany({
      where: {
        assignmentId,
        submitted: true,
      },
      include: {
        questionResponses: true,
      },
    });
  }
}
