/** Compiled artifacts can satisfy an upload requirement, but are not source. */
const COMPILED_EXTENSION =
  /\.(?:exe|dll|sys|com|elf|so(?:\.\d+)*|dylib|o|a|lib|class|pyc|pyo|wasm|dex|pdb|bin)$/i;

// .obj is also a text-based 3D format, so its extension alone is not blocked.
// Inspect signatures before extension/MIME dispatch, including files renamed
// to look like source. CAFEBABE is shared by Java classes and fat Mach-O files.
const COMPILED_SIGNATURES = [
  "4d5a", // DOS/PE
  "7f454c46", // ELF
  "feedface",
  "cefaedfe",
  "feedfacf",
  "cffaedfe", // Mach-O
  "cafebabe",
  "bebafeca",
  "cafebabf",
  "bfbafeca", // Java / fat Mach-O
  "0061736d", // WebAssembly
  "6465780a", // Android DEX
  "4243c0de",
  "dec0170b", // LLVM bitcode
  "213c617263683e0a", // ar static library
];

export function isCompiledArtifact(buffer: Buffer, filename = ""): boolean {
  if (COMPILED_EXTENSION.test(filename)) return true;
  const header = buffer.subarray(0, 8).toString("hex");
  return COMPILED_SIGNATURES.some((signature) => header.startsWith(signature));
}

export function describeBinaryArtifact(filename: string, size: number) {
  return {
    text:
      `[BINARY ARTIFACT: ${JSON.stringify(filename)}]\n` +
      `Size: ${size} bytes.\n` +
      "The artifact is present. Its contents were not inspected as source code. " +
      "Presence can satisfy an artifact-upload requirement; it does not establish that the program works.",
    extractedText: "",
    encoding: "binary",
  };
}
