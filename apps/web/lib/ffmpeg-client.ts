// Vendored copy of @ffmpeg/ffmpeg: the published build does not compile under
// Turbopack in Next 16.4+ (see lib/vendor/ffmpeg/README.md).
import { FFmpeg } from "./vendor/ffmpeg/classes.js";

export type { FFmpeg };

let instance: FFmpeg | null = null;

/**
 * Returns the shared FFmpeg instance, constructing it on first use.
 *
 * FFmpeg must never be constructed at module scope: module scope runs during
 * the server render of any page that imports the component, and the package
 * build (unlike this vendored copy) resolves to a stub whose constructor throws
 * ("ffmpeg.wasm does not support nodejs") in Node. Only call this from
 * browser-only code paths (effects and event handlers).
 */
export function getFfmpeg(): FFmpeg {
  if (!instance) {
    instance = new FFmpeg();
  }
  return instance;
}
