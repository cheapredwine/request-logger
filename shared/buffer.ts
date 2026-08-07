/**
 * In-memory circular buffer for log entries with client subscription
 * CRITICAL: No persistent storage - all data lost on worker restart
 */

import type { LogEntry, LoggerOptions } from './types';

export class LogBuffer {
  private buffer: LogEntry[] = [];
  private options: Partial<LoggerOptions>;
  private clients: Set<(entry: LogEntry) => void> = new Set();

  constructor(options: Partial<LoggerOptions> = {}) {
    this.options = {
      maxBufferSize: options.maxBufferSize ?? 1000,
      ...options,
    };
  }

  add(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > (this.options.maxBufferSize ?? 1000)) {
      this.buffer.shift();
    }
    this.broadcast(entry);
  }

  getAll(): readonly LogEntry[] {
    return this.buffer;
  }

  getRecent(count: number): readonly LogEntry[] {
    return this.buffer.slice(-Math.min(count, this.buffer.length));
  }

  size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
  }

  subscribe(callback: (entry: LogEntry) => void): () => void {
    this.clients.add(callback);
    return () => {
      this.clients.delete(callback);
    };
  }

  private broadcast(entry: LogEntry): void {
    for (const client of this.clients) {
      try {
        client(entry);
      } catch (err) {
        console.error('[buffer] Error broadcasting to client:', err);
      }
    }
  }
}

export const globalBuffer = new LogBuffer();
