/**
 * Unified types for request logger shared module
 */

export interface LogEntry {
  id: string;
  timestamp: string; // ISO string
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyPreview: string;
  bodyLength: number;
  cf?: Record<string, unknown>;
  originalUrl?: string;
  forwardedTo?: string;
}

export interface LoggerOptions {
  maxBufferSize: number;
  maxBodyBytes: number;
  enableEncryption: boolean;
  publicKey?: string;
  siemEndpoint?: string;
  siemApiKey?: string;
  siemStreamingMode: 'stream' | 'buffer';
  flushIntervalMs: number;
}

export interface EncryptedLog {
  encrypted: boolean;
  data: string;
  keyId?: string;
  iv?: string;
  encryptedKey?: string;
}
