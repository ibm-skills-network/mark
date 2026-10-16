type Path = (string | number)[];

// Replace selected string tokens without reserializing numbers or unrelated JSON.
export function mapJsonStrings(
  source: string,
  transform: (value: string, path: Path) => string,
): string {
  let position = 0;
  const edits: { start: number; end: number; value: string }[] = [];
  const whitespace = () => {
    while (/[\t\n\r ]/.test(source[position] ?? "") && position < source.length)
      position++;
  };
  const string = (): { value: string; start: number; end: number } => {
    const start = position++;
    let escaped = false;
    while (position < source.length) {
      const character = source[position++];
      if (character === '"' && !escaped) {
        const value: unknown = JSON.parse(source.slice(start, position));
        if (typeof value !== "string") throw new Error("invalid-json");
        return { value, start, end: position };
      }
      escaped = character === "\\" && !escaped;
    }
    throw new Error("invalid-json");
  };
  const value = (path: Path, depth: number): void => {
    if (depth > 64) throw new Error("json-depth-limit");
    whitespace();
    const character = source[position];
    if (character === '"') {
      const token = string();
      const replacement = transform(token.value, path);
      if (replacement !== token.value)
        edits.push({ ...token, value: JSON.stringify(replacement) });
    } else if (character === "{" || character === "[") {
      const object = character === "{";
      const end = object ? "}" : "]";
      const keys = new Set<string>();
      position++;
      whitespace();
      let index = 0;
      if (source[position] !== end) {
        for (;;) {
          let key: string | number = index++;
          if (object) {
            whitespace();
            if (source[position] !== '"') throw new Error("invalid-json");
            key = string().value;
            if (keys.has(key)) throw new Error("duplicate-json-key");
            keys.add(key);
            whitespace();
            if (source[position++] !== ":") throw new Error("invalid-json");
          }
          value([...path, key], depth + 1);
          whitespace();
          if (source[position] === end) break;
          if (source[position++] !== ",") throw new Error("invalid-json");
        }
      }
      position++;
    } else {
      const token =
        /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[Ee][+-]?\d+)?)/.exec(
          source.slice(position),
        );
      if (!token) throw new Error("invalid-json");
      position += token[0].length;
    }
  };
  value([], 0);
  whitespace();
  if (position !== source.length) throw new Error("invalid-json");
  let result = source;
  for (const edit of edits.reverse())
    result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  return result;
}

export function transformEnvelope(
  source: string,
  transform: (value: string) => string,
  kind: "html" | "draft",
  depth = 0,
): string {
  if (depth > 5) throw new Error("envelope-depth-limit");
  const trimmed = source.trim();
  if (trimmed.startsWith('"')) {
    const decoded: unknown = JSON.parse(source);
    if (typeof decoded !== "string") throw new Error("invalid-envelope");
    const result = transformEnvelope(decoded, transform, kind, depth + 1);
    return result === decoded ? source : JSON.stringify(result);
  }
  if (kind === "html") {
    if (/^[[{]/.test(trimmed)) {
      const leaves: string[] = [];
      try {
        mapJsonStrings(source, (value) => {
          leaves.push(value);
          return value;
        });
      } catch {
        return transform(source);
      }
      if (leaves.some((value) => transform(value) !== value))
        throw new Error("structured-text-response");
      return source;
    }
    return transform(source);
  }
  if (!trimmed.startsWith("[")) throw new Error("unknown-draft-shape");
  return mapJsonStrings(source, (value, path) => {
    const question =
      path.length === 2 &&
      typeof path[0] === "number" &&
      path[1] === "question";
    const variant =
      path.length === 4 &&
      typeof path[0] === "number" &&
      path[1] === "variants" &&
      typeof path[2] === "number" &&
      path[3] === "variantContent";
    if (question || variant) return transform(value);
    // Inventory unexplained legacy HTML instead of changing arbitrary JSON leaves.
    if (transform(value) !== value) throw new Error("unknown-draft-html-path");
    return value;
  });
}
