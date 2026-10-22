import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import {
  artifactFormatCapabilities,
  canonicalArtifactExtensions,
} from "backend-contracts";
import { Roles } from "../../../auth/role/roles.global.guard";
import { UserRole } from "../../../auth/interfaces/user.session.interface";
import { PARSER_LIMITS } from "./parser/isolated-artifact-parser";

/** Inventory remains explicit even while the production upload rollout is off.
 * Clients must not treat available parser variants as permission to submit. */
@Controller({ path: "artifacts/capabilities", version: "2" })
@Roles(UserRole.LEARNER, UserRole.AUTHOR, UserRole.ADMIN)
export class ArtifactCapabilitiesController {
  @Get()
  getCapabilities(@Query("assignmentId") assignmentId?: string) {
    if (
      assignmentId !== undefined &&
      (!/^[1-9]\d*$/.test(assignmentId) ||
        !Number.isSafeInteger(Number(assignmentId)))
    )
      throw new BadRequestException("Invalid assignment identity.");
    // This returns public configuration only, never assignment or learner data.
    const rolloutEnabled =
      assignmentId !== undefined &&
      (process.env.ARTIFACT_PREVIEW_ASSIGNMENT_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .includes(assignmentId);
    return {
      schemaVersion: 1,
      rolloutEnabled,
      gradeable: false,
      limits: {
        inputBytes: PARSER_LIMITS.inputBytes,
        expandedBytes: PARSER_LIMITS.expandedBytes,
        outputBytes: PARSER_LIMITS.outputBytes,
        pages: PARSER_LIMITS.pages,
        timeoutMs: PARSER_LIMITS.timeoutMs,
      },
      formats: artifactFormatCapabilities.map((format) => ({
        ...format,
        extensions: [...format.extensions],
        canonicalExtensions: [...canonicalArtifactExtensions[format.format]],
        canonicalAccepted:
          rolloutEnabled &&
          (format.format === "url" ||
            canonicalArtifactExtensions[format.format].length > 0),
        extractable:
          rolloutEnabled &&
          (format.format === "url" ||
            canonicalArtifactExtensions[format.format].length > 0),
        evidence: [...format.evidence],
        limitations: [...format.limitations],
      })),
    };
  }
}
