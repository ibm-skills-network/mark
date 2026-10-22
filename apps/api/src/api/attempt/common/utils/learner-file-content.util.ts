/**
 * Upper bound on file content rebuilt from a parsed JSON value. Notebooks
 * learners submit run to about 1.4 MB; anything far past this is not a
 * notebook worth grading and only costs memory to carry through grading.
 */
export const MAX_COERCED_FILE_CONTENT_LENGTH = 20_000_000;

/**
 * Deepest nesting of objects and arrays accepted. A notebook nests about six
 * levels; this leaves room for any real JSON file while keeping a hostile
 * value from recursing the serializer to the stack limit.
 */
export const MAX_COERCED_FILE_CONTENT_DEPTH = 64;

export type LearnerFileContentRejection = "length" | "depth" | "cycle";

export class LearnerFileContentTooLargeError extends Error {
  /**
   * @param length characters of output counted before serializing stopped
   *   (the full length only when it finished)
   */
  constructor(
    readonly length: number,
    readonly reason: LearnerFileContentRejection = "length",
  ) {
    super("Learner file content is too large to process");
    this.name = "LearnerFileContentTooLargeError";
  }
}

export type LearnerFileContentType =
  | "string"
  | "undefined"
  | "null"
  | "object"
  | "array"
  | "number"
  | "boolean"
  | "other";

export interface NormalizedLearnerFileContent {
  content: string | undefined;
  originalType: LearnerFileContentType;
}

function contentTypeOf(value: unknown): LearnerFileContentType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
    case "undefined":
    case "object":
    case "number":
    case "boolean": {
      return typeof value as LearnerFileContentType;
    }
    default: {
      return "other";
    }
  }
}

// Characters JSON.stringify writes for one string, quotes included. Lone
// surrogates (escaped to six characters) are counted as one, so this never
// over-counts and the bound below never rejects what would have fit.
function jsonStringLength(value: string): number {
  let length = value.length + 2;
  for (let index = 0; index < value.length; index++) {
    // Code units are scanned; only BMP characters are ever escaped.
    const code = value.codePointAt(index) ?? 0;
    if (code === 0x22 || code === 0x5c) {
      length += 1;
    } else if (code < 0x20) {
      // \b \t \n \f \r have two-character escapes; the rest are \u00XX.
      length += code >= 0x08 && code <= 0x0d && code !== 0x0b ? 1 : 5;
    }
  }
  return length;
}

function primitiveJsonLength(value: unknown): number {
  switch (typeof value) {
    case "string": {
      return jsonStringLength(value);
    }
    case "number": {
      return Number.isFinite(value) ? String(value).length : 4;
    }
    case "boolean": {
      return value ? 4 : 5;
    }
    default: {
      // null, and undefined/functions/symbols inside arrays, become "null".
      return 4;
    }
  }
}

/** Whether `target` is `holder` or one of the holders above it. */
function isOnPath(
  target: object,
  holder: object,
  parentOf: WeakMap<object, object>,
): boolean {
  for (
    let node: object | undefined = holder;
    node !== undefined;
    node = parentOf.get(node)
  ) {
    if (node === target) return true;
  }
  return false;
}

/**
 * JSON.stringify with the length, depth and cycle bounds enforced while it
 * runs, so an oversized value is abandoned once the output passes the bound
 * instead of being fully built first. The replacer returns every value
 * unchanged, so the output is exactly JSON.stringify's.
 */
function boundedJsonStringify(value: object): string {
  // The holder each object was reached from; walking it back finds cycles.
  const parentOf = new WeakMap<object, object>();
  const depthOf = new WeakMap<object, number>();
  const holdersWithEntries = new WeakSet<object>();
  let length = 0;

  const serialized = JSON.stringify(
    value,
    function (this: object, key: string, child: unknown): unknown {
      const holderIsArray = Array.isArray(this);
      const omitted =
        child === undefined ||
        typeof child === "function" ||
        typeof child === "symbol";
      // An object drops omitted properties entirely; the root has no holder.
      const isRoot = depthOf.get(this) === undefined;
      if (!isRoot && !(omitted && !holderIsArray)) {
        if (holdersWithEntries.has(this)) length += 1;
        else holdersWithEntries.add(this);
        if (!holderIsArray) length += jsonStringLength(key) + 1;
      }

      if (typeof child === "object" && child !== null) {
        const depth = (depthOf.get(this) ?? 0) + 1;
        if (depth > MAX_COERCED_FILE_CONTENT_DEPTH) {
          throw new LearnerFileContentTooLargeError(length, "depth");
        }
        if (isOnPath(child, this, parentOf)) {
          throw new LearnerFileContentTooLargeError(length, "cycle");
        }
        parentOf.set(child, this);
        depthOf.set(child, depth);
        // Brackets; entries are counted as each one is reached.
        length += 2;
      } else if (!(omitted && !holderIsArray)) {
        length += primitiveJsonLength(child);
      }

      if (length > MAX_COERCED_FILE_CONTENT_LENGTH) {
        throw new LearnerFileContentTooLargeError(length, "length");
      }
      return child;
    },
  );
  // Only lone surrogates are under-counted above; the exact length decides.
  if (serialized.length > MAX_COERCED_FILE_CONTENT_LENGTH) {
    throw new LearnerFileContentTooLargeError(serialized.length, "length");
  }
  return serialized;
}

/**
 * File content is text everywhere downstream. A JSON file's text (a notebook,
 * a .json upload) can reach the server already parsed into an object, by the
 * request decoder or a client that sends it that way; serializing it again
 * recovers the file's JSON text, so the learner is graded on what they sent.
 */
export function normalizeLearnerFileContent(
  value: unknown,
): NormalizedLearnerFileContent {
  const originalType = contentTypeOf(value);
  switch (originalType) {
    case "string": {
      return { content: value as string, originalType };
    }
    case "undefined":
    case "null": {
      return { content: undefined, originalType };
    }
    case "object":
    case "array": {
      return {
        content: boundedJsonStringify(value as object),
        originalType,
      };
    }
    case "number":
    case "boolean": {
      return { content: String(value as number | boolean), originalType };
    }
    default: {
      return { content: undefined, originalType };
    }
  }
}
