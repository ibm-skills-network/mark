/* eslint-disable unicorn/switch-case-braces */
/**
 * Enum for Skills Network programs
 * These values are used for NATS messaging configuration
 */
export enum Program {
  TEAM = "team",
  PORTALS = "portals",
  LABS = "labs",
  FACULTY = "faculty",
}

/**
 * Get a user-friendly name for a program
 */
export function getProgramName(program: Program): string {
  switch (program) {
    case Program.TEAM:
      return "Skills Network Team";
    case Program.PORTALS:
      return "Skills Network Portals";
    case Program.LABS:
      return "Skills Network Labs";
    case Program.FACULTY:
      return "Faculty";
    default:
      return "Unknown Program";
  }
}

/**
 * Check if a program name is valid
 */
export function isValidProgram(program: string): boolean {
  return Object.values(Program).includes(program as Program);
}

/**
 * Get the program enum value from a string
 */
export function getProgramFromString(program: string): Program | null {
  if (isValidProgram(program)) {
    return program as Program;
  }
  return;
}
