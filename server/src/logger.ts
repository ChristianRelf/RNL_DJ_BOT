type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const ESC = String.fromCharCode(27);
const COLOR: Record<Level, string> = {
  debug: ESC + '[90m',
  info: ESC + '[36m',
  warn: ESC + '[33m',
  error: ESC + '[31m',
};
const RESET = ESC + '[0m';

let threshold = ORDER.info;

export function setLogLevel(level: Level): void {
  threshold = ORDER[level] ?? ORDER.info;
}

function emit(level: Level, scope: string, args: unknown[]): void {
  if (ORDER[level] < threshold) return;
  const ts = new Date().toISOString().slice(11, 23);
  const head = `${COLOR[level]}${ts} ${level.toUpperCase().padEnd(5)}${RESET} [${scope}]`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(head, ...args);
}

export function createLogger(scope: string) {
  return {
    debug: (...a: unknown[]) => emit('debug', scope, a),
    info: (...a: unknown[]) => emit('info', scope, a),
    warn: (...a: unknown[]) => emit('warn', scope, a),
    error: (...a: unknown[]) => emit('error', scope, a),
  };
}

export type Logger = ReturnType<typeof createLogger>;
