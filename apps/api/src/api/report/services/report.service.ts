/* eslint-disable unicorn/no-null */
import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { ReportStatus, ReportType } from "@prisma/client";
import axios from "axios";
import * as natural from "natural";
import { NotificationsService } from "src/api/user/services/notification.service";
import { UserRole } from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "src/prisma.service";
import { ReportIssueDto } from "../types/report.types";
import { FloService } from "./flo.service";

@Injectable()
export class ReportsService {
  constructor(
    private readonly floService: FloService,
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async createGithubIssue(
    title: string,
    body: string,
    labels: string[] = [],
  ): Promise<{ number: number; [key: string]: any }> {
    const githubOwner = process.env.GITHUB_OWNER;
    const githubRepo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_APP_TOKEN;
    if (!githubOwner || !githubRepo || !token) {
      throw new InternalServerErrorException(
        "GitHub repository configuration or token missing",
      );
    }

    try {
      const response = await axios.post(
        `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues`,
        {
          title,
          body,
          labels,
        },
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
        },
      );

      return response.data as { number: number; [key: string]: any };
    } catch (error) {
      const error_ = axios.isAxiosError(error)
        ? new InternalServerErrorException(
            `Failed to create GitHub issue: ${error.message}`,
          )
        : new InternalServerErrorException(
            `Failed to create GitHub issue: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          );
      throw error_;
    }
  }

  private async checkGitHubIssueStatus(issueNumber: number): Promise<{
    state: string;
    status: ReportStatus;
    statusMessage: string;
    closureReason?: string;
  }> {
    const githubOwner = process.env.GITHUB_OWNER;
    const githubRepo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_APP_TOKEN;
    if (!githubOwner || !githubRepo || !token) {
      throw new InternalServerErrorException(
        "GitHub repository configuration or token missing",
      );
    }

    try {
      const response = await axios.get(
        `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues/${issueNumber}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
        },
      );

      const issue = response.data as {
        state: string;
        labels: Array<{ name: string }>;
        closed_at: string | null;
      };

      let status: ReportStatus = ReportStatus.OPEN;
      let statusMessage =
        "Your issue is currently open, developers didn't pick it up yet";
      let closureReason: string | undefined;

      if (issue.state === "closed") {
        const isDuplicate = issue.labels.some((label) =>
          label.name.toLowerCase().includes("duplicate"),
        );

        const isWontFix = issue.labels.some(
          (label) =>
            label.name.toLowerCase().includes("wontfix") ||
            label.name.toLowerCase().includes("won't fix") ||
            label.name.toLowerCase().includes("not planned"),
        );

        const isInvalid = issue.labels.some(
          (label) =>
            label.name.toLowerCase().includes("invalid") ||
            label.name.toLowerCase().includes("not reproducible"),
        );

        if (isDuplicate) {
          status = ReportStatus.CLOSED;
          closureReason = "duplicate";
          statusMessage =
            "This issue was closed as a duplicate of another issue.";
        } else if (isWontFix) {
          status = ReportStatus.CLOSED;
          closureReason = "wontfix";
          statusMessage =
            "This issue was closed as it won't be implemented or fixed.";
        } else if (isInvalid) {
          status = ReportStatus.CLOSED;
          closureReason = "invalid";
          statusMessage =
            "This issue was closed as it was deemed invalid or not reproducible.";
        } else {
          status = ReportStatus.RESOLVED;
          closureReason = "fixed";
          statusMessage = "This issue has been resolved.";
        }
      } else {
        const inProgressLabel = issue.labels.find(
          (label: { name: string }) =>
            label.name === "in progress" ||
            label.name === "in-progress" ||
            label.name === "working",
        );

        if (inProgressLabel) {
          status = ReportStatus.IN_PROGRESS;
          statusMessage = "Our team is actively working on this issue.";
        }
      }

      return {
        state: issue.state,
        status,
        statusMessage,
        closureReason,
      };
    } catch {
      return {
        state: "unknown",
        status: ReportStatus.OPEN,
        statusMessage: "Unable to retrieve current status.",
      };
    }
  }

  private mapIssueTypeToReportType(issueType: string): ReportType {
    switch (issueType.toLowerCase()) {
      case "bug":
      case "technical": {
        return ReportType.BUG;
      }

      case "feedback": {
        return ReportType.FEEDBACK;
      }

      case "suggestion": {
        return ReportType.SUGGESTION;
      }

      case "performance": {
        return ReportType.PERFORMANCE;
      }

      case "false_marking":
      case "false marking":
      case "grading": {
        return ReportType.FALSE_MARKING;
      }

      case "content": {
        return ReportType.FEEDBACK;
      }

      case "critical": {
        return ReportType.BUG;
      }

      default: {
        return ReportType.OTHER;
      }
    }
  }

  private calculateTextSimilarity(text1: string, text2: string): number {
    try {
      const tokenizer = new natural.WordTokenizer();
      const tokens1 = tokenizer.tokenize(text1.toLowerCase()) || [];
      const tokens2 = tokenizer.tokenize(text2.toLowerCase()) || [];

      const stopWords = new Set([
        "a",
        "an",
        "the",
        "and",
        "or",
        "but",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "in",
        "on",
        "at",
        "to",
        "for",
        "with",
      ]);

      const filteredTokens1 = tokens1.filter(
        (token) => token.length > 2 && !stopWords.has(token),
      );

      const filteredTokens2 = tokens2.filter(
        (token) => token.length > 2 && !stopWords.has(token),
      );

      if (filteredTokens1.length === 0 || filteredTokens2.length === 0) {
        return 0;
      }

      const tf1: Record<string, number> = {};
      const tf2: Record<string, number> = {};

      for (const token of filteredTokens1) {
        tf1[token] = (tf1[token] || 0) + 1;
      }

      for (const token of filteredTokens2) {
        tf2[token] = (tf2[token] || 0) + 1;
      }

      const uniqueTerms = new Set([...Object.keys(tf1), ...Object.keys(tf2)]);

      const vector1: number[] = [];
      const vector2: number[] = [];

      for (const term of uniqueTerms) {
        const idf = tf1[term] && tf2[term] ? 1 : 2;

        vector1.push(((tf1[term] || 0) / filteredTokens1.length) * idf);
        vector2.push(((tf2[term] || 0) / filteredTokens2.length) * idf);
      }

      let dotProduct = 0;
      let magnitude1 = 0;
      let magnitude2 = 0;

      for (const [index, element] of vector1.entries()) {
        dotProduct += element * vector2[index];
        magnitude1 += element * element;
        magnitude2 += vector2[index] * vector2[index];
      }

      magnitude1 = Math.sqrt(magnitude1);
      magnitude2 = Math.sqrt(magnitude2);

      if (magnitude1 === 0 || magnitude2 === 0) {
        return 0;
      }

      return dotProduct / (magnitude1 * magnitude2);
    } catch {
      return this.calculateSimpleSimilarity(text1, text2);
    }
  }

  private calculateSimpleSimilarity(text1: string, text2: string): number {
    const words1 = text1
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2);
    const words2 = text2
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2);

    const set1 = new Set(words1);
    const set2 = new Set(words2);

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  private async findSimilarReports(
    description: string,
    issueType: ReportType,
    assignmentId?: number,
    excludeReportId?: number,
  ): Promise<
    Array<{
      id: number;
      issueNumber?: number;
      description: string;
      assignmentId?: number;
      status: ReportStatus;
      similarity: number;
    }>
  > {
    const whereConditions: {
      issueType: ReportType;
      status: {
        in: ReportStatus[];
      };
      createdAt: {
        gte: Date;
      };
      id?: { not?: number };
      assignmentId?: number;
    } = {
      issueType: issueType,
      status: {
        in: [ReportStatus.OPEN, ReportStatus.IN_PROGRESS],
      },
      createdAt: {
        gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      },
    };

    if (excludeReportId) {
      whereConditions.id = { not: excludeReportId };
    }

    const limit = description.length > 100 ? 50 : 20;

    const potentialMatches = await this.prisma.report.findMany({
      where: whereConditions,
      select: {
        id: true,
        description: true,
        issueNumber: true,
        status: true,
        assignmentId: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
    });

    const scoredMatches = potentialMatches.map((report) => {
      let similarity = this.calculateTextSimilarity(
        description,
        report.description,
      );

      if (assignmentId && report.assignmentId === assignmentId) {
        similarity *= 1.2;
      }

      const ageInDays =
        (Date.now() - new Date(report.createdAt).getTime()) /
        (1000 * 3600 * 24);
      const recencyBoost = Math.max(0.8, 1 - (ageInDays / 90) * 0.2);
      similarity *= recencyBoost;

      return {
        ...report,
        similarity: Math.min(similarity, 1),
      };
    });

    return scoredMatches
      .filter((report) => report.similarity >= 0.4)
      .sort((a, b) => b.similarity - a.similarity);
  }

  async reportIssue(
    dto: ReportIssueDto,
    userSession?: {
      role?: UserRole;
      assignmentId?: number;
      attemptId?: number;
      userId?: string;
    },
  ): Promise<{
    message: string;
    issueNumber?: number;
    reportId?: number;
    similarReports?: Array<{
      id: number;
      issueNumber?: number;
      similarity: number;
      description: string;
      status: string;
    }>;
    isDuplicate?: boolean;
  }> {
    const { issueType, description, attemptId, severity } = dto;
    const assignmentId = userSession?.assignmentId;

    if (!issueType) {
      throw new InternalServerErrorException("issueType is required");
    }

    const isProduction = process.env.NODE_ENV === "production";
    const role = userSession?.role || "Author";
    let issueSeverity: "info" | "warning" | "error" | "critical" =
      severity || "info";

    if (!severity) {
      if (issueType === "technical") issueSeverity = "error";
      if (issueType === "bug") issueSeverity = "error";
      if (issueType === "critical") issueSeverity = "critical";
      if (issueType === "grading") issueSeverity = "warning";
    }
    // check if the user reported more than 5 issues in the last 24 hours
    const recentReports = await this.prisma.report.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
        reporterId: userSession?.userId,
      },
      select: {
        id: true,
      },
    });
    if (recentReports.length > 5) {
      return {
        message:
          "You have reported too many issues in the last 24 hours. Please try again later.",
      };
    }

    const mappedIssueType = this.mapIssueTypeToReportType(issueType);

    const similarReports = await this.findSimilarReports(
      description,
      mappedIssueType,
      assignmentId,
    );

    const potentialDuplicate = similarReports.find((r) => r.similarity > 0.85);
    const highSimilarityReport = similarReports.find((r) => r.similarity > 0.7);

    const issueTitle = `[MARK CHAT] [
${isProduction ? "PROD" : "DEV"}] [${role}] ${issueSeverity.toUpperCase()} ${
      issueType.charAt(0).toUpperCase() + issueType.slice(1)
    } Assignment ${assignmentId || "N/A"} - ${
      role === "learner" ? `Attempt ${attemptId}` : ""
    }
    : ${description.slice(0, 50)}...`;

    let issueBody = `
## Issue Report from Mark Chat

**Issue Type:** ${issueType}
**Reported By:** ${role || "Unknown"}
**Assignment ID:** ${assignmentId || "N/A"}
**Attempt ID:** ${attemptId || "N/A"}
**Time Reported:** ${new Date().toISOString()}
**Severity:** ${issueSeverity}
**Environment:** ${isProduction ? "Production" : "Development"}

### Description
${description}
`;

    if (similarReports.length > 0) {
      issueBody += `\n\n### Similar Issues\n`;
      for (const report of similarReports.slice(0, 3)) {
        const similarityPercentage = Math.round(report.similarity * 100);
        issueBody += `- Issue #${
          report.issueNumber || report.id
        } (${similarityPercentage}% similar)\n`;
      }
    }

    issueBody += `\n---\n*This issue was automatically reported through the Mark Chat feature.*`;

    if (potentialDuplicate) {
      issueBody += `\n\n⚠️ **Potential Duplicate** ⚠️\nThis issue appears to be a duplicate of Issue #${
        potentialDuplicate.issueNumber || potentialDuplicate.id
      } (${Math.round(potentialDuplicate.similarity * 100)}% similar)`;
    }

    try {
      let issue: { number: number; [key: string]: any } | undefined;
      let parentIssueNumber: number | undefined;
      let isDuplicate = false;

      if (potentialDuplicate?.issueNumber) {
        isDuplicate = true;
        parentIssueNumber = potentialDuplicate.issueNumber;

        const githubOwner = process.env.GITHUB_OWNER;
        const githubRepo = process.env.GITHUB_REPO;
        const token = process.env.GITHUB_APP_TOKEN;

        if (!githubOwner || !githubRepo || !token) {
          throw new InternalServerErrorException(
            "GitHub repository configuration or token missing",
          );
        }

        const commentBody = `
## Duplicate Report Detected

Another user has reported a nearly identical issue:

**Similarity Score:** ${Math.round(potentialDuplicate.similarity * 100)}%
**Reported By:** ${role || "Unknown"}
**Assignment ID:** ${assignmentId || "N/A"}
**Attempt ID:** ${attemptId || "N/A"}
**Time Reported:** ${new Date().toISOString()}

### Description from new report
${description}
`;

        await axios.post(
          `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues/${parentIssueNumber}/comments`,
          { body: commentBody },
          {
            headers: {
              Authorization: `token ${token}`,
              Accept: "application/vnd.github.v3+json",
            },
          },
        );

        const issueResponse = await axios.get(
          `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues/${parentIssueNumber}`,
          {
            headers: {
              Authorization: `token ${token}`,
              Accept: "application/vnd.github.v3+json",
            },
          },
        );

        issue = issueResponse.data as {
          number: number;
          state: string;
          labels: Array<{ name: string }>;
          closed_at?: string | null;
        };

        let parentClosureReason = "duplicate";

        if (issue.state === "closed") {
          const { status, closureReason } =
            await this.checkGitHubIssueStatus(parentIssueNumber);
          if (closureReason) {
            parentClosureReason = closureReason;
          }
        }
      } else if (highSimilarityReport?.issueNumber) {
        const labels = ["chat-report", "related-issue"];
        if (issueType === "technical" || issueType === "bug")
          labels.push("bug");
        if (issueType === "content") labels.push("content");
        if (issueType === "grading") labels.push("grading");
        if (role) labels.push(role);

        issueBody += `\n\n### Related Issue\nThis appears to be related to Issue #${
          highSimilarityReport.issueNumber
        } (${Math.round(highSimilarityReport.similarity * 100)}% similar)`;

        issue = await this.createGithubIssue(issueTitle, issueBody, labels);

        const githubOwner = process.env.GITHUB_OWNER;
        const githubRepo = process.env.GITHUB_REPO;
        const token = process.env.GITHUB_APP_TOKEN;

        if (githubOwner && githubRepo && token) {
          const relationComment = `
## Related Issue Created

A new related issue has been created: #${issue.number}

**Similarity Score:** ${Math.round(highSimilarityReport.similarity * 100)}%
**Issue Type:** ${issueType}
`;

          await axios.post(
            `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues/${highSimilarityReport.issueNumber}/comments`,
            { body: relationComment },
            {
              headers: {
                Authorization: `token ${token}`,
                Accept: "application/vnd.github.v3+json",
              },
            },
          );
        }
      } else {
        const labels = ["chat-report"];
        if (issueType === "technical" || issueType === "bug")
          labels.push("bug");
        if (issueType === "content") labels.push("content");
        if (issueType === "grading") labels.push("grading");
        if (role) labels.push(role);

        issue = await this.createGithubIssue(issueTitle, issueBody, labels);
      }

      let reportStatus: ReportStatus = ReportStatus.OPEN;
      let statusMessage = "Your issue has been reported and is being reviewed.";

      if (isDuplicate && potentialDuplicate) {
        const parentReport = await this.prisma.report.findUnique({
          where: { id: potentialDuplicate.id },
          select: { status: true, statusMessage: true, closureReason: true },
        });

        if (
          parentReport &&
          (parentReport.status === ReportStatus.RESOLVED ||
            parentReport.status === ReportStatus.CLOSED)
        ) {
          reportStatus = parentReport.status;
          statusMessage =
            parentReport.closureReason === "wontfix"
              ? "This issue was closed as it won't be implemented or fixed."
              : parentReport.closureReason === "invalid"
                ? "This issue was closed as it was deemed invalid or not reproducible."
                : parentReport.closureReason === "duplicate"
                  ? "This issue was closed as a duplicate of another issue."
                  : "This issue was resolved.";
        }
      }

      const reportData: {
        duplicateOfReportId: number | null;
        reporterId: string;
        assignmentId: number | null;
        attemptId: number | null;
        issueType: ReportType;
        description: string;
        author: boolean;
        status: ReportStatus;
        issueNumber?: number;
        statusMessage: string;
        relatedToReportId?: number | null;
        similarityScore?: number | null;
        closureReason?: string | null;
      } = {
        reporterId: userSession?.userId || "anonymous",
        assignmentId: typeof assignmentId === "number" ? assignmentId : null,
        attemptId: typeof attemptId === "number" ? attemptId : null,
        issueType: mappedIssueType,
        description: description,
        author: role?.toLowerCase() === "author",
        status: reportStatus,
        issueNumber: issue.number,
        statusMessage: statusMessage,
        duplicateOfReportId: null,
        relatedToReportId: null,
        similarityScore: null,
        closureReason: null,
      };

      if (potentialDuplicate) {
        reportData.duplicateOfReportId = potentialDuplicate.id;
        reportData.similarityScore = potentialDuplicate.similarity;

        if (
          reportStatus === ReportStatus.CLOSED ||
          reportStatus === ReportStatus.RESOLVED
        ) {
          const parentReport = await this.prisma.report.findUnique({
            where: { id: potentialDuplicate.id },
            select: { closureReason: true },
          });

          if (parentReport?.closureReason) {
            reportData.closureReason = parentReport.closureReason;
          }
        }
      } else if (highSimilarityReport) {
        reportData.relatedToReportId = highSimilarityReport.id;
        reportData.similarityScore = highSimilarityReport.similarity;
      }

      const report = await this.prisma.report.create({ data: reportData });

      await this.floService.sendError(issueTitle, description, {
        severity: issueSeverity,
        tags: ["mark", "chat", "report", role || "user", issueType],
        assignmentId,
        attemptId,
        github_issue: issue.number,
        report_id: report.id,
        is_duplicate: isDuplicate,
      });

      let message = `Thank you for your report. Issue #${issue.number} has been created and our team will review it soon. You can check the status of this issue anytime by asking me about your reported issues.`;

      if (isDuplicate) {
        message = `Thank you for your report. We found that this is likely a duplicate of an existing issue (#${parentIssueNumber}). Your report has been linked to the existing issue and will be handled together. You can check the status anytime by asking about your reported issues.`;

        if (
          reportStatus === ReportStatus.RESOLVED ||
          reportStatus === ReportStatus.CLOSED
        ) {
          message += ` Note that the existing issue has already been ${
            reportStatus === ReportStatus.RESOLVED ? "resolved" : "closed"
          }.`;
        }
      } else if (highSimilarityReport) {
        message = `Thank you for your report. Issue #${issue.number} has been created and linked to a similar existing issue (#${highSimilarityReport.issueNumber}). Our team will review both issues together. You can check the status anytime by asking about your reported issues.`;
      } else if (similarReports.length > 0) {
        message = `Thank you for your report. Issue #${
          issue.number
        } has been created and our team will review it soon. We found ${
          similarReports.length
        } similar ${
          similarReports.length === 1 ? "issue" : "issues"
        } that might be related. You can check the status anytime by asking about your reported issues.`;
      }

      return {
        message,
        issueNumber: issue?.number,
        reportId: report.id,
        similarReports:
          similarReports.length > 0
            ? similarReports.slice(0, 3).map((r) => ({
                id: r.id,
                issueNumber: r.issueNumber,
                similarity: r.similarity,
                description: r.description,
                status: r.status.toString(),
              }))
            : undefined,
        isDuplicate,
      };
    } catch {
      try {
        const reportData: {
          duplicateOfReportId: number | null;
          reporterId: string;
          assignmentId: number | null;
          attemptId: number | null;
          issueType: ReportType;
          description: string;
          author: boolean;
          status: ReportStatus;
          issueNumber?: number;
          statusMessage: string;
          relatedToReportId?: number | null;
          similarityScore?: number | null;
        } = {
          reporterId: userSession?.userId || "anonymous",
          assignmentId: assignmentId,
          attemptId: attemptId,
          issueType: mappedIssueType,
          description: `${description}\n\nNote: GitHub issue creation failed.`,
          author: role?.toLowerCase() === "author",
          status: ReportStatus.OPEN,
          statusMessage:
            "Your issue has been reported but there was a problem creating a GitHub issue.",
          issueNumber: null,
          duplicateOfReportId: null,
          relatedToReportId: null,
          similarityScore: null,
        };

        if (potentialDuplicate) {
          reportData.duplicateOfReportId = potentialDuplicate.id;
          reportData.similarityScore = potentialDuplicate.similarity;
        } else if (highSimilarityReport) {
          reportData.relatedToReportId = highSimilarityReport.id;
          reportData.similarityScore = highSimilarityReport.similarity;
        }

        const report = await this.prisma.report.create({ data: reportData });

        return {
          message:
            "Your report has been saved. However, we encountered an issue with our tracking system. Your feedback is still important to us - we'll follow up as soon as possible.",
          reportId: report.id,
          similarReports:
            similarReports.length > 0
              ? similarReports.slice(0, 3).map((r) => ({
                  id: r.id,
                  issueNumber: r.issueNumber,
                  similarity: r.similarity,
                  description: r.description,
                  status: r.status.toString(),
                }))
              : undefined,
          isDuplicate: potentialDuplicate !== undefined,
        };
      } catch (error) {
        // Handle any errors that occur during the fallback report creation
        console.error("Error creating fallback report:", error);
      }

      return {
        message:
          "We encountered an issue while submitting your report. Your feedback is still important to us - please try again later.",
      };
    }
  }

  async getReportsForAssignment(assignmentId: number) {
    const reports = await this.prisma.report.findMany({
      where: {
        assignmentId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    for (const report of reports) {
      if (report.duplicateOfReportId || report.relatedToReportId) {
        const relatedId =
          report.duplicateOfReportId || report.relatedToReportId;
        const relatedReport = await this.prisma.report.findUnique({
          where: { id: relatedId },
          select: {
            id: true,
            issueNumber: true,
            description: true,
            status: true,
          },
        });

        if (relatedReport) {
          report.relatedToReportId = relatedReport.id;
        }
      }
    }

    return reports;
  }

  async getSimilarReports(reportId: number) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        description: true,
        issueType: true,
        assignmentId: true,
        duplicateOfReportId: true,
        relatedToReportId: true,
      },
    });

    if (!report) {
      throw new NotFoundException(`Report with ID ${reportId} not found`);
    }

    const directlyRelated = await this.prisma.report.findMany({
      where: {
        OR: [
          { id: report.duplicateOfReportId },
          { id: report.relatedToReportId },
          { duplicateOfReportId: reportId },
          { relatedToReportId: reportId },
        ],
      },
      select: {
        id: true,
        issueNumber: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        duplicateOfReportId: true,
        relatedToReportId: true,
        similarityScore: true,
      },
    });

    if (directlyRelated.length > 0) {
      return directlyRelated.map((related) => ({
        ...related,
        relationshipType:
          related.id === report.duplicateOfReportId
            ? "parent"
            : related.id === report.relatedToReportId
              ? "related"
              : related.duplicateOfReportId === reportId
                ? "duplicate"
                : "related",
      }));
    }

    const similarReports = await this.findSimilarReports(
      report.description,
      report.issueType,
      report.assignmentId,
      reportId,
    );

    return similarReports.map((similar) => ({
      ...similar,
      relationshipType: "similar",
    }));
  }

  async getReportsForUser(userId: string) {
    const reports = await this.prisma.report.findMany({
      where: {
        reporterId: userId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const updatedReports = await Promise.all(
      reports.map(async (report) => {
        if (report.issueNumber) {
          try {
            const { status, statusMessage, developerComment, closureReason } =
              await this.syncGitHubIssueStatus(report.issueNumber);
            if (status !== report.status) {
              await this.createStatusChangeNotification(
                report.id,
                status,
                statusMessage,
                closureReason,
              );
            }
            if (
              status !== report.status ||
              developerComment ||
              closureReason !== report.closureReason
            ) {
              const updates: {
                status: ReportStatus;
                statusMessage: string;
                updatedAt: Date;
                comments?: string;
                resolution?: string;
                closureReason?: string;
              } = {
                status,
                statusMessage,
                updatedAt: new Date(),
              };

              if (developerComment) {
                updates.comments = developerComment;
              }

              if (closureReason) {
                updates.closureReason = closureReason;
              }

              await this.prisma.report.update({
                where: { id: report.id },
                data: updates,
              });

              report.status = status;
              report.statusMessage = statusMessage;
              report.closureReason = closureReason;

              if (developerComment) {
                report.comments = developerComment;
              }
            }
          } catch (error) {
            console.error(
              `Error syncing GitHub issue status for report ID ${report.id}:`,
              error,
            );
          }
        }

        if (report.duplicateOfReportId) {
          const parentReport = await this.prisma.report.findUnique({
            where: { id: report.duplicateOfReportId },
            select: {
              id: true,
              issueNumber: true,
              status: true,
              statusMessage: true,
              closureReason: true,
            },
          });

          if (parentReport) {
            report.duplicateOfReportId = parentReport.id;

            if (parentReport.status !== report.status) {
              let statusMessage = report.statusMessage;

              if (
                parentReport.status === ReportStatus.RESOLVED ||
                parentReport.status === ReportStatus.CLOSED
              ) {
                statusMessage = `This issue was marked as a duplicate of issue #${
                  parentReport.issueNumber
                } which has been ${
                  parentReport.status === ReportStatus.RESOLVED
                    ? "resolved"
                    : "closed"
                }.`;

                if (parentReport.closureReason) {
                  await this.prisma.report.update({
                    where: { id: report.id },
                    data: {
                      status: parentReport.status,
                      statusMessage,
                      closureReason: parentReport.closureReason,
                      updatedAt: new Date(),
                    },
                  });

                  report.status = parentReport.status;
                  report.statusMessage = statusMessage;
                  report.closureReason = parentReport.closureReason;
                } else {
                  await this.prisma.report.update({
                    where: { id: report.id },
                    data: {
                      status: parentReport.status,
                      statusMessage,
                      updatedAt: new Date(),
                    },
                  });

                  report.status = parentReport.status;
                  report.statusMessage = statusMessage;
                }
              }
            }
          }
        }

        return report;
      }),
    );

    return updatedReports;
  }

  async getReportDetailsForUser(reportId: number, userId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException(`Report with ID ${reportId} not found`);
    }

    if (report.reporterId !== userId) {
      throw new NotFoundException(`Report with ID ${reportId} not found`);
    }

    if (report.issueNumber) {
      try {
        const { status, statusMessage, developerComment, closureReason } =
          await this.syncGitHubIssueStatus(report.issueNumber);

        if (
          status !== report.status ||
          developerComment ||
          closureReason !== report.closureReason
        ) {
          const updates: {
            status: ReportStatus;
            statusMessage: string;
            updatedAt: Date;
            comments?: string;
            resolution?: string;
            closureReason?: string;
          } = {
            status,
            statusMessage,
            updatedAt: new Date(),
          };

          if (developerComment) {
            updates.comments = developerComment;
          }

          if (closureReason) {
            updates.closureReason = closureReason;
          }

          await this.prisma.report.update({
            where: { id: report.id },
            data: updates,
          });

          report.status = status;
          report.statusMessage = statusMessage;
          report.closureReason = closureReason;

          if (developerComment) {
            report.comments = developerComment;
          }
        }
      } catch (error) {
        console.error(
          `Error syncing GitHub issue status for report ID ${report.id}:`,
          error,
        );
      }
    }

    const relatedReports = await this.getSimilarReports(reportId);

    let duplicateInfo = null;
    if (report.duplicateOfReportId) {
      const parentReport = await this.prisma.report.findUnique({
        where: { id: report.duplicateOfReportId },
        select: {
          id: true,
          issueNumber: true,
          status: true,
          statusMessage: true,
          description: true,
          closureReason: true,
        },
      });

      if (parentReport) {
        duplicateInfo = {
          isDuplicate: true,
          originalReport: parentReport,
          similarityScore: report.similarityScore,
        };

        if (
          parentReport.status !== report.status &&
          (parentReport.status === ReportStatus.RESOLVED ||
            parentReport.status === ReportStatus.CLOSED)
        ) {
          const statusMessage = `This issue was marked as a duplicate of issue #${
            parentReport.issueNumber
          } which has been ${
            parentReport.status === ReportStatus.RESOLVED
              ? "resolved"
              : "closed"
          }.`;

          const updateData: {
            status: ReportStatus;
            statusMessage: string;
            updatedAt: Date;
            comments?: string;
            resolution?: string;
            closureReason?: string;
          } = {
            status: parentReport.status,
            statusMessage,
            updatedAt: new Date(),
          };

          if (parentReport.closureReason) {
            updateData.closureReason = parentReport.closureReason;
          }

          await this.prisma.report.update({
            where: { id: report.id },
            data: updateData,
          });

          report.status = parentReport.status;
          report.statusMessage = statusMessage;

          if (parentReport.closureReason) {
            report.closureReason = parentReport.closureReason;
          }
        }
      }
    }

    const duplicates = await this.prisma.report.findMany({
      where: {
        duplicateOfReportId: report.id,
      },
      select: {
        id: true,
        issueNumber: true,
        description: true,
        createdAt: true,
        similarityScore: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return {
      id: report.id,
      issueType: report.issueType,
      description: report.description,
      status: report.status,
      statusMessage: report.statusMessage,
      created: report.createdAt,
      updated: report.updatedAt,
      issueNumber: report.issueNumber,
      developerComment: report.comments,
      resolution: report.resolution,
      closureReason: report.closureReason,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      duplicateInfo,
      duplicates: duplicates.length > 0 ? duplicates : undefined,
      relatedReports: relatedReports.length > 0 ? relatedReports : undefined,
    };
  }

  async syncGitHubIssueStatus(issueNumber: number): Promise<{
    status: ReportStatus;
    statusMessage: string;
    developerComment?: string;
    closureReason?: string;
  }> {
    const githubOwner = process.env.GITHUB_OWNER;
    const githubRepo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_APP_TOKEN;

    if (!githubOwner || !githubRepo || !token) {
      throw new InternalServerErrorException(
        "GitHub repository configuration or token missing",
      );
    }

    try {
      const issueResponse = await axios.get(
        `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues/${issueNumber}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
        },
      );

      const issue = issueResponse.data as {
        state: string;
        labels: Array<{ name: string }>;
        closed_at: string | null;
        body: string;
      };

      let developerComment: string | undefined;
      let closureReason: string | undefined;

      if (issue.state === "closed" && issue.closed_at) {
        const isDuplicate = issue.labels.some((label) =>
          label.name.toLowerCase().includes("duplicate"),
        );

        const isWontFix = issue.labels.some(
          (label) =>
            label.name.toLowerCase().includes("wontfix") ||
            label.name.toLowerCase().includes("won't fix") ||
            label.name.toLowerCase().includes("not planned"),
        );

        const isInvalid = issue.labels.some(
          (label) =>
            label.name.toLowerCase().includes("invalid") ||
            label.name.toLowerCase().includes("not reproducible"),
        );

        if (isDuplicate) {
          closureReason = "duplicate";
        } else if (isWontFix) {
          closureReason = "wontfix";
        } else if (isInvalid) {
          closureReason = "invalid";
        } else {
          closureReason = "fixed";
        }

        const commentsResponse = await axios.get(
          `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues/${issueNumber}/comments`,
          {
            headers: {
              Authorization: `token ${token}`,
              Accept: "application/vnd.github.v3+json",
            },
          },
        );

        const comments = commentsResponse.data as Array<{
          body: string;
          created_at: string;
          user: { login: string };
        }>;

        const sortedComments = comments.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );

        const closingComment = sortedComments.find((comment) => {
          const isBeforeClosure =
            new Date(comment.created_at) <= new Date(issue.closed_at);
          const mentionsClosureReason =
            (closureReason === "duplicate" &&
              comment.body.toLowerCase().includes("duplicate")) ||
            (closureReason === "wontfix" &&
              (comment.body.toLowerCase().includes("won't fix") ||
                comment.body.toLowerCase().includes("wontfix") ||
                comment.body.toLowerCase().includes("not planned"))) ||
            (closureReason === "invalid" &&
              (comment.body.toLowerCase().includes("invalid") ||
                comment.body.toLowerCase().includes("not reproducible")));

          return (
            isBeforeClosure && (comments.length === 1 || mentionsClosureReason)
          );
        });

        if (closingComment) {
          developerComment = closingComment.body;
        }
      }

      let status: ReportStatus = ReportStatus.OPEN;
      let statusMessage =
        "Your issue is currently open, developers didn't pick it up yet";

      if (issue.state === "closed") {
        if (closureReason === "fixed" || !closureReason) {
          status = ReportStatus.RESOLVED;
          statusMessage = "This issue was resolved by our team.";
        } else {
          status = ReportStatus.CLOSED;
          statusMessage =
            closureReason === "duplicate"
              ? "This issue was closed as a duplicate of another issue."
              : closureReason === "wontfix"
                ? "This issue was closed as it won't be implemented or fixed."
                : "This issue was closed as it was deemed invalid or not reproducible.";

          if (developerComment) {
            statusMessage += ` Developer comment: ${developerComment.slice(
              0,
              100,
            )}${developerComment.length > 100 ? "..." : ""}`;
          }
        }
      } else {
        const inProgressLabel = issue.labels.find(
          (label: { name: string }) =>
            label.name === "in progress" ||
            label.name === "in-progress" ||
            label.name === "working",
        );

        if (inProgressLabel) {
          status = ReportStatus.IN_PROGRESS;
          statusMessage = "Our team is actively working on this issue.";
        }
      }

      const reports = await this.prisma.report.findMany({
        where: { issueNumber },
      });

      if (reports.length > 0) {
        await Promise.all(
          reports.map(async (report) => {
            const updateData = {
              status,
              statusMessage,
              updatedAt: new Date(),
              resolution: report.resolution,
              closureReason: report.closureReason,
              comments: report.comments,
            };

            if (developerComment) {
              updateData.comments = developerComment;
            }

            if (closureReason) {
              updateData.closureReason = closureReason;
            }

            if (report.status !== status) {
              await this.createStatusChangeNotification(
                report.id,
                status,
                statusMessage,
                closureReason,
              );
            }

            await this.prisma.report.update({
              where: { id: report.id },
              data: updateData,
            });

            if (
              (status === ReportStatus.RESOLVED ||
                status === ReportStatus.CLOSED) &&
              report.id
            ) {
              await this.updateDuplicateReportsStatus(
                report.id,
                status,
                statusMessage,
                closureReason,
              );
            }
          }),
        );
      }

      return {
        status,
        statusMessage,
        developerComment,
        closureReason,
      };
    } catch {
      return {
        status: ReportStatus.OPEN,
        statusMessage: "Unable to retrieve current status.",
      };
    }
  }

  private async updateDuplicateReportsStatus(
    parentReportId: number,
    status: ReportStatus,
    statusMessage: string,
    closureReason?: string,
  ) {
    const duplicateReports = await this.prisma.report.findMany({
      where: {
        duplicateOfReportId: parentReportId,
        status: {
          notIn: [ReportStatus.RESOLVED, ReportStatus.CLOSED],
        },
      },
    });

    for (const report of duplicateReports) {
      const parentReport = await this.prisma.report.findUnique({
        where: { id: parentReportId },
        select: { issueNumber: true },
      });

      const updatedStatusMessage = parentReport?.issueNumber
        ? `This issue was marked as a duplicate of issue #${
            parentReport.issueNumber
          } which has been ${
            status === ReportStatus.RESOLVED ? "resolved" : "closed"
          }.`
        : statusMessage;

      const updateData: {
        status: ReportStatus;
        statusMessage: string;
        updatedAt: Date;
        comments?: string;
        resolution?: string;
        closureReason?: string;
      } = {
        status,
        statusMessage: updatedStatusMessage,
        updatedAt: new Date(),
      };

      if (closureReason) {
        updateData.closureReason = closureReason;
      }

      await this.prisma.report.update({
        where: { id: report.id },
        data: updateData,
      });

      await this.updateDuplicateReportsStatus(
        report.id,
        status,
        updatedStatusMessage,
        closureReason,
      );
    }
  }

  async updateReportStatus(
    reportId: number,
    status: ReportStatus,
    statusMessage?: string,
    resolution?: string,
    userComment?: string,
  ) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException(`Report with ID ${reportId} not found`);
    }

    let updatedResolution = resolution;
    if (userComment) {
      updatedResolution = updatedResolution
        ? `${updatedResolution}\n\n**User Comment:** ${userComment}`
        : `**User Comment:** ${userComment}`;
    }

    let closureReason: string | undefined;
    if (status === ReportStatus.RESOLVED) {
      closureReason = "fixed";
    } else if (status === ReportStatus.CLOSED) {
      const combinedText = `${statusMessage || ""} ${
        resolution || ""
      }`.toLowerCase();
      if (combinedText.includes("duplicate")) {
        closureReason = "duplicate";
      } else if (
        combinedText.includes("won't fix") ||
        combinedText.includes("not planned")
      ) {
        closureReason = "wontfix";
      } else if (
        combinedText.includes("invalid") ||
        combinedText.includes("not reproducible")
      ) {
        closureReason = "invalid";
      } else {
        closureReason = "fixed";
      }
    }

    const updateData: {
      status: ReportStatus;
      statusMessage: string;
      updatedAt: Date;
      comments?: string;
      resolution?: string;
      closureReason?: string;
    } = {
      status,
      statusMessage: statusMessage || this.getDefaultStatusMessage(status),
      updatedAt: new Date(),
    };

    if (status === ReportStatus.RESOLVED || status === ReportStatus.CLOSED) {
      updateData.resolution = updatedResolution || report.resolution;

      if (closureReason) {
        updateData.closureReason = closureReason;
      }
    }
    const updatedReport = await this.prisma.report.update({
      where: { id: reportId },
      data: updateData,
    });

    await this.createStatusChangeNotification(
      reportId,
      status,
      updateData.statusMessage,
      closureReason,
    );

    if (report.issueNumber) {
      try {
        const githubOwner = process.env.GITHUB_OWNER;
        const githubRepo = process.env.GITHUB_REPO;
        const token = process.env.GITHUB_APP_TOKEN;

        if (githubOwner && githubRepo && token) {
          let updatedBody = report.description;

          if (userComment) {
            updatedBody += `\n\n---\n**User Comment:** ${userComment}`;
          }

          if (
            updatedResolution &&
            (status === ReportStatus.RESOLVED || status === ReportStatus.CLOSED)
          ) {
            updatedBody += `\n\n---\n**Resolution:** ${updatedResolution}`;
          }

          if (
            status === ReportStatus.RESOLVED ||
            status === ReportStatus.CLOSED
          ) {
            const labels = [];
            if (closureReason === "duplicate") labels.push("duplicate");
            if (closureReason === "wontfix") labels.push("wontfix");
            if (closureReason === "invalid") labels.push("invalid");

            await axios.patch(
              `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues/${report.issueNumber}`,
              {
                state: "closed",
                body: updatedBody,
                ...(labels.length > 0 ? { labels } : {}),
              },
              {
                headers: {
                  Authorization: `token ${token}`,
                  Accept: "application/vnd.github.v3+json",
                },
              },
            );

            const commentMessage =
              closureReason === "duplicate"
                ? "This issue is being closed as a duplicate."
                : closureReason === "wontfix"
                  ? "This issue is being closed as it won't be fixed or implemented."
                  : closureReason === "invalid"
                    ? "This issue is being closed as it was deemed invalid or not reproducible."
                    : "This issue has been resolved.";

            await axios.post(
              `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues/${report.issueNumber}/comments`,
              {
                body: `**Status Update:** ${commentMessage} ${
                  resolution ? `\n\n**Resolution:** ${resolution}` : ""
                }`,
              },
              {
                headers: {
                  Authorization: `token ${token}`,
                  Accept: "application/vnd.github.v3+json",
                },
              },
            );
          } else {
            await axios.patch(
              `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues/${report.issueNumber}`,
              {
                body: updatedBody,
              },
              {
                headers: {
                  Authorization: `token ${token}`,
                  Accept: "application/vnd.github.v3+json",
                },
              },
            );

            if (status === ReportStatus.IN_PROGRESS) {
              const issueResponse = await axios.get(
                `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues/${report.issueNumber}`,
                {
                  headers: {
                    Authorization: `token ${token}`,
                    Accept: "application/vnd.github.v3+json",
                  },
                },
              );

              const issueData = issueResponse.data as {
                labels: Array<{ name: string }>;
              };
              const currentLabels = Array.isArray(issueData.labels)
                ? issueData.labels.map((label: { name: string }) => label.name)
                : [];
              if (!currentLabels.includes("in-progress")) {
                await axios.patch(
                  `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues/${report.issueNumber}`,
                  {
                    labels: [...currentLabels, "in-progress"],
                  },
                  {
                    headers: {
                      Authorization: `token ${token}`,
                      Accept: "application/vnd.github.v3+json",
                    },
                  },
                );
              }

              await axios.post(
                `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues/${report.issueNumber}/comments`,
                {
                  body: `**Status Update:** ${
                    statusMessage || this.getDefaultStatusMessage(status)
                  }`,
                },
                {
                  headers: {
                    Authorization: `token ${token}`,
                    Accept: "application/vnd.github.v3+json",
                  },
                },
              );

              if (resolution) {
                await axios.post(
                  `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues/${report.issueNumber}/comments`,
                  {
                    body: `**Resolution:** ${resolution}`,
                  },
                  {
                    headers: {
                      Authorization: `token ${token}`,
                      Accept: "application/vnd.github.v3+json",
                    },
                  },
                );
              }
            }
          }
        }
      } catch (error) {
        console.error(
          `Error updating GitHub issue #${report.issueNumber}:`,
          error,
        );
      }
    }

    if (status === ReportStatus.RESOLVED || status === ReportStatus.CLOSED) {
      await this.updateDuplicateReportsStatus(
        reportId,
        status,
        statusMessage || this.getDefaultStatusMessage(status),
        closureReason,
      );

      if (report.duplicateOfReportId) {
        const parentReport = await this.prisma.report.findUnique({
          where: { id: report.duplicateOfReportId },
          select: { status: true },
        });

        if (
          parentReport &&
          (parentReport.status === ReportStatus.OPEN ||
            parentReport.status === ReportStatus.IN_PROGRESS) &&
          closureReason === "fixed"
        ) {
          await this.updateReportStatus(
            report.duplicateOfReportId,
            status,
            `This issue has been resolved as part of resolving a duplicate issue.`,
            resolution,
          );
        }
      }
    }

    return updatedReport;
  }

  async addCommentToReport(
    reportId: number,
    userId: string,
    comment: string,
  ): Promise<{ message: string; report: any }> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException(`Report with ID ${reportId} not found`);
    }

    if (report.reporterId !== userId) {
      throw new NotFoundException(`Report with ID ${reportId} not found`);
    }

    const updatedResolution = report.resolution
      ? `${
          report.resolution
        }\n\n**Comment added ${new Date().toISOString()}:**\n${comment}`
      : `**Comment added ${new Date().toISOString()}:**\n${comment}`;

    const updatedReport = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        resolution: updatedResolution,
        updatedAt: new Date(),
      },
    });

    if (report.issueNumber) {
      try {
        const githubOwner = process.env.GITHUB_OWNER;
        const githubRepo = process.env.GITHUB_REPO;
        const token = process.env.GITHUB_APP_TOKEN;

        if (githubOwner && githubRepo && token) {
          await axios.post(
            `https://api.github.com/repos/${githubOwner}/${githubRepo}/issues/${report.issueNumber}/comments`,
            {
              body: `**User Comment:**\n${comment}`,
            },
            {
              headers: {
                Authorization: `token ${token}`,
                Accept: "application/vnd.github.v3+json",
              },
            },
          );
        }
      } catch (error) {
        console.error(
          `Error adding comment to GitHub issue #${report.issueNumber}:`,
          error,
        );
      }
    }

    return {
      message: "Your comment has been added to the report.",
      report: updatedReport,
    };
  }

  private async createStatusChangeNotification(
    reportId: number,
    newStatus: ReportStatus,
    statusMessage: string,
    closureReason?: string,
  ): Promise<void> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: {
        reporterId: true,
        issueNumber: true,
        status: true,
        description: true,
        issueType: true,
      },
    });

    if (!report || report.status === newStatus) return;

    const statusText =
      newStatus === ReportStatus.RESOLVED
        ? "Resolved"
        : newStatus === ReportStatus.CLOSED
          ? "Closed"
          : newStatus === ReportStatus.IN_PROGRESS
            ? "In Progress"
            : "Updated";

    const reasonText = closureReason
      ? closureReason === "fixed"
        ? " (Issue Fixed)"
        : closureReason === "wontfix"
          ? " (Won't Fix)"
          : closureReason === "duplicate"
            ? " (Marked as Duplicate)"
            : closureReason === "invalid"
              ? " (Not Reproducible/Invalid)"
              : ""
      : "";

    await this.notificationsService.createNotification(
      report.reporterId,
      "ISSUE_STATUS_CHANGE",
      `Issue #${
        report.issueNumber || reportId
      } Status: ${statusText}${reasonText}`,
      statusMessage || this.getDefaultStatusMessage(newStatus),
      {
        reportId,
        oldStatus: report.status,
        newStatus,
        issueNumber: report.issueNumber,
        statusMessage,
        closureReason,
      },
    );
  }
  /**
   * Track issue status changes and notify users
   */
  async trackStatusChangesAndNotify(
    reportId: number,
    newStatus: ReportStatus,
    statusMessage: string,
    closureReason?: string,
  ): Promise<void> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: {
        reporterId: true,
        issueNumber: true,
        status: true,
        statusMessage: true,
        description: true,
        issueType: true,
        closureReason: true,
      },
    });

    if (!report) return;

    if (report.status !== newStatus || report.closureReason !== closureReason) {
      const user = await this.prisma.userCredential.findUnique({
        where: { userId: report.reporterId },
      });

      if (!user?.userId) return;

      await this.prisma.userNotification.create({
        data: {
          userId: report.reporterId,
          type: "ISSUE_STATUS_CHANGE",
          title: `Issue #${report.issueNumber} Status Update`,
          message: `Your reported issue has been updated to ${newStatus}${
            closureReason ? ` (${closureReason})` : ""
          }.`,
          metadata: JSON.stringify({
            reportId,
            oldStatus: report.status,
            newStatus,
            issueNumber: report.issueNumber,
            statusMessage,
          }),
          read: false,
        },
      });
    }
  }

  private getDefaultStatusMessage(status: ReportStatus): string {
    switch (status) {
      case ReportStatus.OPEN: {
        return "Your issue has been reported and is being reviewed.";
      }
      case ReportStatus.IN_PROGRESS: {
        return "Our team is actively working on this issue.";
      }
      case ReportStatus.RESOLVED: {
        return "This issue has been resolved. Please let us know if you need further assistance.";
      }
      case ReportStatus.CLOSED: {
        return "This issue has been closed without further action.";
      }
      default: {
        return "The status of this issue has been updated.";
      }
    }
  }

  async sendUserFeedback(
    title: string,
    description: string,
    rating: string,
    userEmail?: string,
    portalName?: string,
    userId?: string,
    assignmentId?: number,
  ): Promise<{ message: string; reportId?: number }> {
    try {
      await this.floService.sendFeedback(title, description, {
        rating,
        userEmail,
        portalName: portalName || "Mark AI Assistant",
      });

      const issueTitle = `[MARK CHAT] User Feedback: ${title}`;
      const issueBody = `
## User Feedback Report
**Feedback Type:** ${title}
**Rating:** ${rating}
**Reported By:** ${userEmail || "Anonymous"}
**Time Reported:** ${new Date().toISOString()}
### Description
${description}
---
*This feedback was automatically reported through the Mark Chat feature.*
`;

      const labels = ["feedback"];
      if (title === "bug") labels.push("bug");
      if (title === "content") labels.push("content");
      if (title === "grading") labels.push("grading");
      if (title === "technical") labels.push("technical");
      if (title === "critical") labels.push("critical");
      if (title === "feature") labels.push("feature");
      if (title === "other") labels.push("other");

      const issue = await this.createGithubIssue(issueTitle, issueBody, labels);

      let report: {
        id: number;
        status: ReportStatus;
        statusMessage: string;
      } | null;

      if (assignmentId) {
        report = await this.prisma.report.create({
          data: {
            reporterId: userId || "anonymous",
            assignmentId,
            issueType: ReportType.FEEDBACK,
            description: `Rating: ${rating}\n\n${description}`,
            author: false,
            status: ReportStatus.OPEN,
            issueNumber: issue.number,
            statusMessage:
              "Your feedback has been received and is being reviewed.",
          },
        });
      }

      return {
        message: `Thank you for your feedback! Issue #${
          issue.number
        } has been created and our team will review it soon.${
          report
            ? " You can check the status of this feedback anytime by asking me about your reported issues."
            : ""
        }`,
        reportId: report?.id,
      };
    } catch {
      if (assignmentId && userId) {
        try {
          const report = await this.prisma.report.create({
            data: {
              reporterId: userId,
              assignmentId,
              issueType: ReportType.FEEDBACK,
              description: `Rating: ${rating}\n\n${description}\n\nNote: GitHub issue creation failed.`,
              author: false,
              status: ReportStatus.OPEN,
              statusMessage:
                "Your feedback has been received, but there was a problem creating a GitHub issue.",
            },
          });

          return {
            message:
              "Your feedback has been saved. Thank you for helping us improve!",
            reportId: report.id,
          };
        } catch (error) {
          console.error("Error saving feedback report to the database:", error);
        }
      }

      return {
        message:
          "We encountered an issue while submitting your feedback. Please try again later.",
      };
    }
  }
}
