import { EventEmitter } from 'node:events';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = {
  level: LogLevel;
  message: string;
  at: number;
};

class LogBus extends EventEmitter {
  emitLog(level: LogLevel, message: string): void {
    const entry: LogEntry = { level, message, at: Date.now() };
    this.emit('log', entry);
    if (level === 'error' || level === 'warn') {
      // eslint-disable-next-line no-console
      console.error(`[pgaze ${level}] ${message}`);
    }
  }
}

export const logBus = new LogBus();

export function logWarn(message: string): void {
  logBus.emitLog('warn', message);
}

export function logError(message: string): void {
  logBus.emitLog('error', message);
}

export function logInfo(message: string): void {
  logBus.emitLog('info', message);
}
