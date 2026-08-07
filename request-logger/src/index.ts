/**
 * Request Logger Worker (Standalone)
 *
 * Captures inbound request headers and body preview.
 * ZERO persistent storage - memory only.
 *
 * Features:
 * - Request capture with body preview
 * - Circular in-memory buffer
 * - Real-time streaming via WebSocket + SSE
 * - SIEM streaming mode (HTTP POST to external endpoint)
 * - Console buffer mode with flush timer
 * - Upstream URL forwarding
 * - Hybrid encryption (RSA-OAEP + AES-GCM)
 */

import type { LogEntry } from '../../shared/types';
import { LogBuffer } from '../../shared/buffer';
import { captureRequest } from '../../shared/capture';
import { createWebSocketStream, createSSEStream } from '../../shared/streaming';
import { hybridEncrypt } from '../../shared/crypto';

export interface Env {
  UPSTREAM_URL?: string;
  SIEM_ENDPOINT?: string;
  SIEM_API_KEY?: string;
  ENCRYPTION_WORKER?: Fetcher;
  ENABLE_ENCRYPTION: string;
  ENCRYPTION_MODE: string;
  ENCRYPTION_PUBLIC_KEY: string;
  MAX_BODY_BYTES: string;
  SIEM_STREAMING_MODE: string;
  FLUSH_INTERVAL_MS: string;
  MAX_BUFFER_SIZE?: string;
}

// In-memory circular buffer
const logBuffer = new LogBuffer();

// Simple console flush timer (legacy buffer mode)
const pendingLogs: { entry: LogEntry; requestId: string }[] = [];
let flushTimer: number | null = null;

const stats = {
  captured: 0,
  sentToSiem: 0,
  dropped: 0,
  failedSiem: 0,
  flushedToConsole: 0,
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();

    // Streaming endpoints
    if (url.pathname === '/stream/ws') {
      const { response } = createWebSocketStream(logBuffer, {
        enableEncryption: env.ENABLE_ENCRYPTION === 'true',
        publicKey: env.ENCRYPTION_PUBLIC_KEY,
      });
      return response;
    }

    if (url.pathname === '/stream/sse') {
      return createSSEStream(logBuffer, {
        enableEncryption: env.ENABLE_ENCRYPTION === 'true',
        publicKey: env.ENCRYPTION_PUBLIC_KEY,
      });
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          bufferSize: logBuffer.size(),
          maxBufferSize: parseInt(env.MAX_BUFFER_SIZE ?? '1000', 10),
          encryptionEnabled: env.ENABLE_ENCRYPTION === 'true',
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Clear buffer
    if (url.pathname === '/clear' && request.method === 'POST') {
      logBuffer.clear();
      pendingLogs.length = 0;
      return new Response(
        JSON.stringify({ message: 'Buffer cleared' }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Default: capture and log request
    const maxBytes = parseInt(env.MAX_BODY_BYTES || '4000', 10);
    const logEntry = await captureRequest(request, maxBytes, requestId);

    ctx.waitUntil(processLogEntry(logEntry, requestId, env));

    // Forward to upstream or return success
    if (env.UPSTREAM_URL) {
      const upstreamUrl = env.UPSTREAM_URL + url.pathname + url.search;
      return fetch(new Request(upstreamUrl, request));
    }

    return new Response('OK', { status: 200 });
  },
};

async function processLogEntry(
  logEntry: LogEntry,
  requestId: string,
  env: Env,
): Promise<void> {
  try {
    stats.captured++;

    // Add to circular buffer (for real-time streaming)
    logBuffer.add(logEntry);

    const mode = env.SIEM_STREAMING_MODE || 'buffer';

    if (mode === 'stream') {
      if (env.SIEM_ENDPOINT) {
        const success = await sendToSIEM(logEntry, env);
        if (!success) {
          stats.dropped++;
          console.error(`[DROPPED][${requestId}] SIEM send failed - log lost`);
        }
      } else {
        const payload = await prepareSIEMPayload(logEntry, env);
        console.log(`[SIEM STUB][${requestId}] Would send to SIEM:`, payload);
      }
    } else {
      await bufferInMemory(logEntry, requestId, env);
    }
  } catch (error) {
    console.error(`[${requestId}] Logging error:`, error);
    stats.dropped++;
  }
}

async function prepareSIEMPayload(logEntry: LogEntry, env: Env): Promise<string> {
  let payload = JSON.stringify(logEntry);
  if (env.ENABLE_ENCRYPTION === 'true' && env.ENCRYPTION_PUBLIC_KEY) {
    try {
      const encrypted = await hybridEncrypt(payload, env.ENCRYPTION_PUBLIC_KEY);
      payload = JSON.stringify(encrypted);
    } catch (error) {
      console.error('Encryption failed:', error);
    }
  }
  return payload;
}

async function sendToSIEM(logEntry: LogEntry, env: Env): Promise<boolean> {
  let payload = JSON.stringify(logEntry);

  if (env.ENABLE_ENCRYPTION === 'true') {
    if (env.ENCRYPTION_MODE === 'inline' && env.ENCRYPTION_PUBLIC_KEY) {
      const encrypted = await hybridEncrypt(payload, env.ENCRYPTION_PUBLIC_KEY);
      payload = JSON.stringify(encrypted);
    } else if (env.ENCRYPTION_MODE === 'service' && env.ENCRYPTION_WORKER) {
      payload = await encryptViaService(payload, env);
    }
  }

  try {
    const response = await fetch(env.SIEM_ENDPOINT!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.SIEM_API_KEY && { Authorization: `Bearer ${env.SIEM_API_KEY}` }),
      },
      body: payload,
    });

    if (response.ok) {
      stats.sentToSiem++;
      return true;
    } else {
      stats.failedSiem++;
      console.error(`[SIEM ERROR] HTTP ${response.status}: ${await response.text()}`);
      return false;
    }
  } catch (error) {
    stats.failedSiem++;
    console.error(`[SIEM ERROR] Network error:`, error);
    return false;
  }
}

async function bufferInMemory(
  logEntry: LogEntry,
  requestId: string,
  env: Env,
): Promise<void> {
  let finalEntry = logEntry;

  if (env.ENABLE_ENCRYPTION === 'true' && env.ENCRYPTION_MODE === 'inline' && env.ENCRYPTION_PUBLIC_KEY) {
    const encrypted = await hybridEncrypt(JSON.stringify(logEntry), env.ENCRYPTION_PUBLIC_KEY);
    finalEntry = {
      ...logEntry,
      bodyPreview: '[ENCRYPTED]',
      headers: { 'x-encrypted-payload': JSON.stringify(encrypted) },
    };
  }

  pendingLogs.push({ entry: finalEntry, requestId });

  const flushInterval = parseInt(env.FLUSH_INTERVAL_MS || '5000', 10);
  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushToConsole();
    }, flushInterval) as unknown as number;
  }
}

function flushToConsole(): void {
  if (pendingLogs.length === 0) return;
  const batch = pendingLogs.splice(0, pendingLogs.length);
  for (const { entry, requestId } of batch) {
    console.log(`[LOG][${requestId}] ${JSON.stringify(entry)}`);
  }
  stats.flushedToConsole += batch.length;
  console.log(
    `[STATS] captured=${stats.captured} sentToSiem=${stats.sentToSiem} ` +
      `flushedToConsole=${stats.flushedToConsole} dropped=${stats.dropped} ` +
      `failedSiem=${stats.failedSiem}`,
  );
}

async function encryptViaService(plaintext: string, env: Env): Promise<string> {
  if (!env.ENCRYPTION_WORKER) return plaintext;
  try {
    const response = await env.ENCRYPTION_WORKER.fetch(
      new Request('http://internal/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plaintext }),
      }),
    );
    if (!response.ok) throw new Error(`Encryption worker returned ${response.status}`);
    const { ciphertext } = await response.json<{ ciphertext: string }>();
    return ciphertext;
  } catch (error) {
    console.error('Service encryption failed:', error);
    return plaintext;
  }
}
