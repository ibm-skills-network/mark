import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "src/database/prisma.service";
import { Logger } from "winston";

export type AssumableRole = "learner" | "author";

export interface AssumedSessionClaims {
  userId: string;
  role: AssumableRole;
  assignmentId: number;
  groupId: string;
}

/**
 * Resolves the session an admin needs to open an assignment as a learner or
 * an author. The gateway signs the result; this service only decides what it
 * may contain. The session is the admin's own identity, so anything they do
 * is recorded against them rather than against the assignment's authors.
 */
@Injectable()
export class AdminAssumeRoleService {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: AdminAssumeRoleService.name });
  }

  async assumeRole(
    adminEmail: string,
    assignmentId: number,
    role: AssumableRole,
  ): Promise<AssumedSessionClaims> {
    const userId = adminEmail.toLowerCase();

    // An existing course link is required: inventing a group would make the
    // access guard create a new AssignmentGroup row on first request.
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        groups: {
          select: { groupId: true },
          orderBy: { groupId: "asc" },
          take: 1,
        },
      },
    });

    if (!assignment) {
      this.logger.warn("admin_assume_role_denied: assignment not found", {
        admin_email: userId,
        assignment_id: assignmentId,
        role,
      });
      throw new NotFoundException("Assignment not found");
    }

    const groupId = assignment.groups[0]?.groupId;
    if (!groupId) {
      this.logger.warn("admin_assume_role_denied: assignment has no group", {
        admin_email: userId,
        assignment_id: assignmentId,
        role,
      });
      throw new NotFoundException("Assignment not found");
    }

    if (role === "author") {
      // Author drafts are gated on the AssignmentAuthor list, not the session.
      const existing = await this.prisma.assignmentAuthor.findUnique({
        where: { assignmentId_userId: { assignmentId, userId } },
        select: { id: true },
      });
      if (!existing) {
        await this.prisma.assignmentAuthor.upsert({
          where: { assignmentId_userId: { assignmentId, userId } },
          create: { assignmentId, userId },
          update: {},
        });
        this.logger.info("admin_assume_role_author_added", {
          admin_email: userId,
          assignment_id: assignmentId,
        });
      }
    }

    this.logger.info("admin_assume_role_granted", {
      admin_email: userId,
      assignment_id: assignmentId,
      group_id: groupId,
      role,
    });

    return { userId, role, assignmentId, groupId };
  }
}
