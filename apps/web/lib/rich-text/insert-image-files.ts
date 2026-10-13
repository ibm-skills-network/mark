import type { Editor } from "@tiptap/core";
import { TextSelection, type Transaction } from "@tiptap/pm/state";

export function imageFiles(transfer: DataTransfer | null): File[] {
  const files = Array.from(transfer?.files ?? []);
  if (!files.length) {
    for (const item of Array.from(transfer?.items ?? [])) {
      const file = item.kind === "file" ? item.getAsFile() : null;
      if (file) files.push(file);
    }
  }
  return files.filter((file) => file.type.startsWith("image/"));
}

const readImage = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Unable to read image"));
    reader.onerror = () => reject(new Error("Unable to read image"));
    reader.readAsDataURL(file);
  });

export async function insertImageFiles(
  editor: Editor,
  files: File[],
  { position, text = "" }: { position?: number; text?: string } = {},
): Promise<void> {
  let bookmark = (
    position === undefined
      ? editor.state.selection
      : TextSelection.create(editor.state.doc, position)
  ).getBookmark();
  let cancelled = false;
  const mapBookmark = ({ transaction }: { transaction: Transaction }) => {
    if (transaction.getMeta("preventUpdate")) cancelled = true;
    bookmark = bookmark.map(transaction.mapping);
  };
  editor.on("transaction", mapBookmark);
  try {
    const sources = await Promise.all(files.map(readImage));
    if (editor.isDestroyed || cancelled) return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setSelection(bookmark.resolve(tr.doc));
        return true;
      })
      .insertContent([
        ...(text ? [{ type: "text", text }] : []),
        ...sources.map((src) => ({ type: "image", attrs: { src } })),
      ])
      .run();
  } finally {
    editor.off("transaction", mapBookmark);
  }
}
