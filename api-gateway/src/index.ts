/**
 * API Gateway Worker
 *
 * Transparently intercepts requests and logs them.
 * Forwards to a configurable backend via service binding.
 *
 * Features:
 * - Request capture with body preview
 * - Circular in-memory buffer
 * - Real-time streaming via WebSocket + SSE
 * - SIEM streaming mode
 * - Service binding proxy to backend
 * - Hybrid encryption
 */

import type { LogEntry } from '../../shared/types';
import { LogBuffer } from '../../shared/buffer';
import { captureRequest } from '../../shared/capture';
import { createWebSocketStream, createSSEStream } from '../../shared/streaming';
import { hybridEncrypt } from '../../shared/crypto';

export interface Env {
  BACKEND: Fetcher;
  MAX_BODY_BYTES: string;
  SIEM_STREAMING_MODE: string;
  SIEM_ENDPOINT?: string;
  SIEM_API_KEY?: string;
  ENABLE_ENCRYPTION: string;
  ENCRYPTION_MODE: string;
  ENCRYPTION_PUBLIC_KEY?: string;
  MAX_BUFFER_SIZE?: string;
}

const logBuffer = new LogBuffer();

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
      return new Response(
        JSON.stringify({ message: 'Buffer cleared' }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Default: capture, log, forward to backend
    const maxBytes = parseInt(env.MAX_BODY_BYTES || '4000', 10);
    const logEntry = await captureRequest(request, maxBytes, requestId);

    // Add gateway-specific fields
    const gatewayEntry: LogEntry = {
      ...logEntry,
      originalUrl: request.url,
      forwardedTo: `backend:${url.pathname}${url.search}`,
    };

    ctx.waitUntil(processLogEntry(gatewayEntry, requestId, env));

    const backendResponse = await forwardToBackend(request, env, requestId);
    return backendResponse;
  },
};

async function forwardToBackend(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const backendUrl = `http://internal${url.pathname}${url.search}`;

  const backendRequest = new Request(backendUrl, request);
  backendRequest.headers.delete('host');

  try {
    const response = await env.BACKEND.fetch(backendRequest);
    return response;
  } catch (error) {
    console.error(`[${requestId}] Error forwarding to backend:`, error);
    return new Response(
      JSON.stringify({ error: 'Gateway error', requestId }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

async function processLogEntry(
  logEntry: LogEntry,
  requestId: string,
  env: Env,
): Promise<void> {
  try {
    logBuffer.add(logEntry);

    const mode = env.SIEM_STREAMING_MODE || 'buffer';

    if (mode === 'stream') {
      if (env.SIEM_ENDPOINT) {
        const success = await sendToSIEM(logEntry, env);
        if (!success) {
          console.error(`[DROPPED][${requestId}] SIEM send failed`);
        }
      } else {
        console.log(`[GATEWAY LOG][${requestId}] ${JSON.stringify(logEntry)}`);
      }
    } else {
      console.log(`[GATEWAY LOG][${requestId}] ${JSON.stringify(logEntry)}`);
    }
  } catch (error) {
    console.error(`[${requestId}] Logging error:`, error);
  }
}

async function sendToSIEM(logEntry: LogEntry, env: Env): Promise<boolean> {
  let payload = JSON.stringify(logEntry);

  if (env.ENABLE_ENCRYPTION === 'true' && env.ENCRYPTION_PUBLIC_KEY) {
    try {
      const encrypted = await hybridEncrypt(payload, env.ENCRYPTION_PUBLIC_KEY);
      payload = JSON.stringify(encrypted);
    } catch {
      console.log('[ENCRYPTION] Encryption requested but failed, sending plaintext');
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
    return response.ok;
  } catch (error) {
    console.error(`[SIEM ERROR] ${error}`);
    return false;
  }
}
