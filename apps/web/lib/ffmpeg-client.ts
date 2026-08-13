import { FFmpeg } from "@ffmpeg/ffmpeg";

let instance: FFmpeg | null = null;

/**
 * Returns the shared FFmpeg instance, constructing it on first use.
 *
 * FFmpeg must never be constructed at module scope: `@ffmpeg/ffmpeg` resolves
 * to a stub whose constructor throws ("ffmpeg.wasm does not support nodejs")
 * when evaluated in Node, and module scope runs during the server render of
 * any page that imports the component — killing the whole render. Only call
 * this from browser-only code paths (effects and event handlers).
 */
export function getFfmpeg(): FFmpeg {
  if (!instance) {
    instance = new FFmpeg();
  }
  return instance;
}
