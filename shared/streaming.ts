/**
 * Streaming module for real-time log delivery
 * Supports WebSocket and Server-Sent Events (SSE)
 */

import type { LogEntry, LoggerOptions } from './types';
import { LogBuffer } from './buffer';
import { hybridEncrypt } from './crypto';

export function createWebSocketStream(
  buffer: LogBuffer,
  options: { enableEncryption?: boolean; publicKey?: string },
): { response: Response; cleanup: () => void } {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  let unsubscribe: (() => void) | null = null;
  server.accept();

  const recent = buffer.getRecent(100);
  if (recent.length > 0) {
    Promise.all(
      recent.map(async (entry) => {
        const payload = await formatForDelivery(entry, options);
        return payload;
      }),
    ).then((history) => {
      server.send(JSON.stringify({ type: 'history', data: history }));
    });
  }

  unsubscribe = buffer.subscribe(async (entry) => {
    try {
      const payload = await formatForDelivery(entry, options);
      server.send(JSON.stringify({ type: 'log', data: payload }));
    } catch (err) {
      console.error('[streaming] Error sending to WebSocket:', err);
    }
  });

  server.addEventListener('close', () => {
    if (unsubscribe) unsubscribe();
  });
  server.addEventListener('error', () => {
    if (unsubscribe) unsubscribe();
  });

  return {
    response: new Response(null, { status: 101, webSocket: client }),
    cleanup: () => {
      if (unsubscribe) unsubscribe();
      server.close();
    },
  };
}

export function createSSEStream(
  buffer: LogBuffer,
  options: { enableEncryption?: boolean; publicKey?: string },
): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('retry: 1000\n\n'));

      const recent = buffer.getRecent(100);
      for (const entry of recent) {
        formatForDelivery(entry, options).then((payload) => {
          const event = `event: log\ndata: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(encoder.encode(event));
        });
      }

      unsubscribe = buffer.subscribe(async (entry) => {
        try {
          const payload = await formatForDelivery(entry, options);
          const event = `event: log\ndata: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(encoder.encode(event));
        } catch (err) {
          console.error('[streaming] Error sending SSE:', err);
        }
      });
    },
    cancel() {
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

async function formatForDelivery(
  entry: LogEntry,
  options: { enableEncryption?: boolean; publicKey?: string },
): Promise<unknown> {
  if (options.enableEncryption && options.publicKey) {
    try {
      const encrypted = await hybridEncrypt(JSON.stringify(entry), options.publicKey);
      return { encrypted: true, ...encrypted };
    } catch {
      // fall through to plaintext
    }
  }
  return entry;
}
