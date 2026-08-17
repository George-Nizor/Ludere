export class LudereMcpError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'LudereMcpError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function asLudereError(error, fallbackCode = 'INTERNAL_ERROR') {
  if (error instanceof LudereMcpError) return error;
  return new LudereMcpError(fallbackCode, error instanceof Error ? error.message : String(error));
}

export function invariant(condition, code, message, details = undefined) {
  if (!condition) throw new LudereMcpError(code, message, details);
}
