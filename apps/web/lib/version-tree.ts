import { parseSemanticVersion, SemanticVersion } from "./semantic-versioning";

export interface VersionNode {
  version: any;
  semanticVersion: SemanticVersion;
  children: VersionNode[];
  level: number;
  isExpanded?: boolean;
}

export interface VersionTree {
  major: number;
  versions: VersionNode[];
  isExpanded: boolean;
}

export function buildVersionTree(versions: any[]): VersionTree[] {
  const trees: Map<number, VersionTree> = new Map();
  const nodes: VersionNode[] = [];

  // Convert versions to nodes and parse semantic versions
  for (const version of versions) {
    try {
      const versionString = version.versionNumber?.toString() || "0.0.0";

      const semanticVersion = parseSemanticVersion(
        versionString.replace(/-rc\d+$/, ""),
      );

      const node: VersionNode = {
        version,
        semanticVersion,
        children: [],
        level: 0,
        isExpanded: true,
      };

      nodes.push(node);
    } catch (error) {
      console.warn(`Skipping invalid version: ${version.versionNumber}`, error);
    }
  }

  // Sort nodes by semantic version (newest first for display)
  nodes.sort((a, b) => {
    if (a.semanticVersion.major !== b.semanticVersion.major) {
      return b.semanticVersion.major - a.semanticVersion.major;
    }
    if (a.semanticVersion.minor !== b.semanticVersion.minor) {
      return b.semanticVersion.minor - a.semanticVersion.minor;
    }
    return b.semanticVersion.patch - a.semanticVersion.patch;
  });

  // Group by major version
  for (const node of nodes) {
    const majorVersion = node.semanticVersion.major;

    if (!trees.has(majorVersion)) {
      trees.set(majorVersion, {
        major: majorVersion,
        versions: [],
        isExpanded: true,
      });
    }

    const tree = trees.get(majorVersion)!;
    tree.versions.push(node);
  }

  // Sort trees by major version (newest first)
  const sortedTrees = Array.from(trees.values()).sort(
    (a, b) => b.major - a.major,
  );

  // Build hierarchy within each major version
  for (const tree of sortedTrees) {
    tree.versions = buildMinorVersionHierarchy(tree.versions);
  }

  return sortedTrees;
}

function buildMinorVersionHierarchy(versions: VersionNode[]): VersionNode[] {
  const minorGroups: Map<number, VersionNode[]> = new Map();

  // Group by minor version
  for (const node of versions) {
    const minor = node.semanticVersion.minor;
    if (!minorGroups.has(minor)) {
      minorGroups.set(minor, []);
    }
    minorGroups.get(minor)!.push(node);
  }

  const result: VersionNode[] = [];

  // Process each minor group
  for (const [_minor, minorVersions] of Array.from(minorGroups.entries())) {
    // Sort by patch version (newest first)
    minorVersions.sort(
      (a, b) => b.semanticVersion.patch - a.semanticVersion.patch,
    );

    if (minorVersions.length === 1) {
      // Single version in this minor group
      result.push(minorVersions[0]);
    } else {
      // Multiple patch versions - create hierarchy
      const [parent, ...children] = minorVersions;
      parent.children = children.map((child) => ({ ...child, level: 1 }));
      result.push(parent);
    }
  }

  return result.sort(
    (a, b) => b.semanticVersion.minor - a.semanticVersion.minor,
  );
}

export function flattenVersionTree(trees: VersionTree[]): {
  node: VersionNode;
  depth: number;
  isLast: boolean;
  parentExpanded: boolean;
}[] {
  const result: {
    node: VersionNode;
    depth: number;
    isLast: boolean;
    parentExpanded: boolean;
  }[] = [];

  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i];
    const isLastTree = i === trees.length - 1;

    for (let j = 0; j < tree.versions.length; j++) {
      const node = tree.versions[j];
      const isLastInTree = j === tree.versions.length - 1;

      result.push({
        node,
        depth: 0,
        isLast: isLastTree && isLastInTree,
        parentExpanded: tree.isExpanded,
      });

      // Add children if expanded
      if (node.isExpanded && node.children.length > 0) {
        for (let k = 0; k < node.children.length; k++) {
          const child = node.children[k];
          const isLastChild = k === node.children.length - 1;

          result.push({
            node: child,
            depth: 1,
            isLast: isLastTree && isLastInTree && isLastChild,
            parentExpanded: true,
          });
        }
      }
    }
  }

  return result;
}

export function getVersionPath(semanticVersion: SemanticVersion): string {
  return `${semanticVersion.major}.${semanticVersion.minor}.${semanticVersion.patch}`;
}

export function isReleaseCandidate(versionString: string): boolean {
  return /-rc\d+$/.test(versionString);
}

export function toggleNodeExpansion(
  trees: VersionTree[],
  targetVersion: SemanticVersion,
): VersionTree[] {
  return trees.map((tree) => ({
    ...tree,
    versions: tree.versions.map((node) => {
      if (
        node.semanticVersion.major === targetVersion.major &&
        node.semanticVersion.minor === targetVersion.minor &&
        node.semanticVersion.patch === targetVersion.patch
      ) {
        return { ...node, isExpanded: !node.isExpanded };
      }
      return node;
    }),
  }));
}

export function toggleTreeExpansion(
  trees: VersionTree[],
  majorVersion: number,
): VersionTree[] {
  return trees.map((tree) =>
    tree.major === majorVersion
      ? { ...tree, isExpanded: !tree.isExpanded }
      : tree,
  );
}
