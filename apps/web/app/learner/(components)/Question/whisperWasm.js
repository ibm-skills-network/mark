export const loadWhisperModule = async () => {
  const response = await fetch("/whisper.wasm");
  const buffer = await response.arrayBuffer();

  const imports = {
    env: {
      memory: new WebAssembly.Memory({ initial: 256 }),
    },
  };

  const { instance } = await WebAssembly.instantiate(buffer, imports);
  return instance;
};

export const transcribeAudioBuffer = async (audioBuffer, wasmInstance) => {
  const { exports } = wasmInstance;

  const ptr = exports.malloc(audioBuffer.byteLength);
  const wasmMemory = new Uint8Array(
    exports.memory.buffer,
    ptr,
    audioBuffer.byteLength,
  );
  wasmMemory.set(new Uint8Array(audioBuffer));

  const outputPtr = exports.malloc(1024 * 10);
  const resultCode = exports.whisper_transcribe(
    ptr,
    audioBuffer.byteLength,
    outputPtr,
    10240,
  );

  if (resultCode !== 0) {
    throw new Error("Transcription failed with error code " + resultCode);
  }

  const memoryU8 = new Uint8Array(exports.memory.buffer);
  let output = "";
  for (let i = outputPtr; memoryU8[i] !== 0; i++) {
    output += String.fromCharCode(memoryU8[i]);
  }

  exports.free(ptr);
  exports.free(outputPtr);

  return JSON.parse(output);
};
