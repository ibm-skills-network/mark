import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

export interface ImagePolicyOptions {
  getImagePolicy?: () => { blockImages?: boolean; onImageBlocked?: () => void };
}

export const ImagePolicy = Extension.create<ImagePolicyOptions>({
  name: "imagePolicy",
  addOptions: () => ({ getImagePolicy: undefined }),
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, state) => {
          const policy = this.options.getImagePolicy?.();
          if (
            !policy?.blockImages ||
            !transactions.some((transaction) => transaction.docChanged)
          )
            return null;
          const positions: { position: number; size: number }[] = [];
          state.doc.descendants((node, position) => {
            if (node.type.name === "image")
              positions.push({ position, size: node.nodeSize });
          });
          if (!positions.length) return null;
          const tr = state.tr;
          for (const { position, size } of positions.reverse())
            tr.delete(position, position + size);
          policy.onImageBlocked?.();
          return tr;
        },
      }),
    ];
  },
});
