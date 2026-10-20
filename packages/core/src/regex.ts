/**
 * Regex port. `core` never imports a regex engine implementation: the caller
 * injects one (RE2 in production, FR-P3). This keeps core free of native modules.
 */

export interface CompiledPattern {
  test(value: string): boolean;
}

export interface RegexEngine {
  /** Compiles a pattern; throws {@link RegexCompileError} when it is unsupported or invalid. */
  compile(pattern: string): CompiledPattern;
}

export class RegexCompileError extends Error {
  /** Friendly name of the unsupported construct, e.g. "lookahead", when known. */
  readonly construct: string | undefined;

  constructor(message: string, construct?: string) {
    super(message);
    this.name = 'RegexCompileError';
    this.construct = construct;
  }
}

/** Maximum pattern length accepted in a schema (FR-P2). */
export const MAX_PATTERN_LENGTH = 500;

/** Full-match semantics (FR-P1): the pattern must match the entire trimmed value. */
export function wrapPattern(pattern: string): string {
  return `^(?:${pattern})$`;
}

/**
 * Compiles a schema pattern with full-match semantics.
 *
 * The raw pattern is compiled first so that unbalanced input such as `a)(b`
 * cannot slip through by being absorbed into the `^(?:…)$` wrapper.
 */
export function compileFullMatch(engine: RegexEngine, pattern: string): CompiledPattern {
  engine.compile(pattern);
  return engine.compile(wrapPattern(pattern));
}
