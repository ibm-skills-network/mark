import {
  VersionComparison,
  VersionChangeDto,
  QuestionChangeDto,
} from "@/types/version-types";

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  rc?: number;
}

export interface VersionSuggestion {
  suggestedVersion: SemanticVersion;
  changeType: "major" | "minor" | "patch";
  reason: string;
  changes: {
    major: string[];
    minor: string[];
    patch: string[];
  };
}

export function parseSemanticVersion(version: string): SemanticVersion {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-rc(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid semantic version format: ${version}`);
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    rc: match[4] ? parseInt(match[4], 10) : undefined,
  };
}

export function formatSemanticVersion(version: SemanticVersion): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.rc ? `${base}-rc${version.rc}` : base;
}

export function removeRcSuffix(version: string): string {
  return version.replace(/-rc\d+$/, "");
}

export function addRcSuffix(version: string, rcNumber = 1): string {
  const cleanVersion = removeRcSuffix(version);
  return `${cleanVersion}-rc${rcNumber}`;
}

export function getNextRcVersion(currentVersion: string): string {
  const rcMatch = currentVersion.match(/-rc(\d+)$/);
  if (rcMatch) {
    const nextRc = parseInt(rcMatch[1], 10) + 1;
    return currentVersion.replace(/-rc\d+$/, `-rc${nextRc}`);
  }
  return addRcSuffix(currentVersion, 1);
}

export function analyzeChanges(
  comparison: VersionComparison,
): VersionSuggestion {
  const majorChanges: string[] = [];
  const minorChanges: string[] = [];
  const patchChanges: string[] = [];

  const majorChangeFields = [
    "graded",
    "displayOrder",
    "questionDisplay",
    "numAttempts",
  ];

  const minorChangeFields = [
    "passingGrade",
    "numberOfQuestionsPerAttempt",
    "timeLimit",
    "title",
  ];

  comparison.assignmentChanges.forEach((change) => {
    if (majorChangeFields.includes(change.field)) {
      majorChanges.push(`Assignment ${change.field} changed`);
    } else if (minorChangeFields.includes(change.field)) {
      minorChanges.push(`Assignment ${change.field} modified`);
    } else {
      patchChanges.push(`Assignment ${change.field} updated`);
    }
  });

  comparison.questionChanges.forEach((change) => {
    if (change.changeType === "added") {
      minorChanges.push(`Question ${change.displayOrder} added`);
    } else if (change.changeType === "removed") {
      majorChanges.push(`Question ${change.displayOrder} removed`);
    } else if (change.field === "type" || change.field === "totalPoints") {
      majorChanges.push(
        `Question ${change.displayOrder} ${change.field} changed`,
      );
    } else if (change.field === "question" || change.field === "choices") {
      minorChanges.push(
        `Question ${change.displayOrder} ${change.field} modified`,
      );
    } else {
      patchChanges.push(
        `Question ${change.displayOrder} ${change.field} updated`,
      );
    }
  });

  let changeType: "major" | "minor" | "patch";
  let reason: string;

  if (majorChanges.length > 0) {
    changeType = "major";
    reason = `Breaking changes detected: ${majorChanges.slice(0, 3).join(", ")}${majorChanges.length > 3 ? ` and ${majorChanges.length - 3} more` : ""}`;
  } else if (minorChanges.length > 0) {
    changeType = "minor";
    reason = `New features/content added: ${minorChanges.slice(0, 3).join(", ")}${minorChanges.length > 3 ? ` and ${minorChanges.length - 3} more` : ""}`;
  } else {
    changeType = "patch";
    reason = `Minor updates: ${patchChanges.slice(0, 3).join(", ")}${patchChanges.length > 3 ? ` and ${patchChanges.length - 3} more` : ""}`;
  }

  return {
    suggestedVersion: { major: 0, minor: 0, patch: 0 },
    changeType,
    reason,
    changes: {
      major: majorChanges,
      minor: minorChanges,
      patch: patchChanges,
    },
  };
}

export function suggestNextVersion(
  currentVersion: string,
  changes: VersionSuggestion,
  isDraft = false,
): SemanticVersion[] {
  const current = parseSemanticVersion(removeRcSuffix(currentVersion));
  const suggestions: SemanticVersion[] = [];

  const majorVersion = {
    major: current.major + 1,
    minor: 0,
    patch: 0,
    rc: isDraft ? 1 : undefined,
  };

  const minorVersion = {
    major: current.major,
    minor: current.minor + 1,
    patch: 0,
    rc: isDraft ? 1 : undefined,
  };

  const patchVersion = {
    major: current.major,
    minor: current.minor,
    patch: current.patch + 1,
    rc: isDraft ? 1 : undefined,
  };

  switch (changes.changeType) {
    case "major":
      suggestions.push(majorVersion, minorVersion, patchVersion);
      break;
    case "minor":
      suggestions.push(minorVersion, majorVersion, patchVersion);
      break;
    case "patch":
      suggestions.push(patchVersion, minorVersion, majorVersion);
      break;
  }

  return suggestions;
}

export function getLatestVersion(
  versions: Array<{ versionNumber?: string }>,
): SemanticVersion | null {
  if (!versions || versions.length === 0) return null;

  const semanticVersions = versions
    .map((v) => {
      try {
        return parseSemanticVersion(removeRcSuffix(v?.versionNumber));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (semanticVersions.length === 0) return null;

  return semanticVersions.reduce((latest, current) => {
    if (current.major > latest.major) return current;
    if (current.major === latest.major && current.minor > latest.minor)
      return current;
    if (
      current.major === latest.major &&
      current.minor === latest.minor &&
      current.patch > latest.patch
    )
      return current;
    return latest;
  });
}
