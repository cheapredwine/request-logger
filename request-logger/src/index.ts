/**
 * Request Logger Worker
 *
 * Captures inbound request headers and body preview.
 * ZERO persistent storage - memory only.
 *
 * DATA LOSS RISKS (memory-only architecture):
 * - Worker restart: All pending logs lost
 * - Worker eviction: Cloudflare kills idle workers
 * - SIEM down: If streaming enabled but SIEM unavailable, logs dropped
 * - OOM: Too many pending logs can kill the worker
 *
 * MITIGATION:
 * - ENABLE_SIEM_STREAMING=true: Sends logs immediately (minimal loss window)
 * - FLUSH_INTERVAL_MS: How often to flush memory buffer (lower = less loss)
 * - Monitor "[DROPPED]" log lines in wrangler tail
 */

export interface Env {
  // Upstream URL to forward requests to
  UPSTREAM_URL?: string;

  // SIEM endpoint for real-time streaming
  SIEM_ENDPOINT?: string;
  SIEM_API_KEY?: string;

  // Optional: Service binding to external encryption worker
  ENCRYPTION_WORKER?: Fetcher;

  // Configuration
  ENABLE_ENCRYPTION: string;
  ENCRYPTION_MODE: string; // 'inline' | 'service' | 'off'
  ENCRYPTION_PUBLIC_KEY: string;
  MAX_BODY_BYTES: string;

  /**
   * SIEM Streaming Mode
   * - 'stream': Send to SIEM immediately (lowest loss risk, higher latency)
   * - 'buffer': Buffer in memory, flush to console (higher loss risk, no external dependency)
   */
  SIEM_STREAMING_MODE: string; // 'stream' | 'buffer'

  /**
   * How often to flush memory buffer to console (in milliseconds)
   * Only used when SIEM_STREAMING_MODE='buffer'
   * Lower = less data loss on crash, higher CPU overhead
   * Default: 5000 (5 seconds)
   */
  FLUSH_INTERVAL_MS: string;
}

export interface LogEntry {
  timestamp: string;
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyPreview: string;
  bodyLength: number;
}

// In-memory only - lost on worker restart/crash
const pendingLogs: { entry: LogEntry; requestId: string }[] = [];
let flushTimer: number | null = null;

// Statistics for monitoring
const stats = {
  captured: 0,
  sentToSiem: 0,
  dropped: 0,
  failedSiem: 0,
  flushedToConsole: 0,
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestId = crypto.randomUUID();

    // CRITICAL: Capture request data BEFORE returning response
    // The request body stream closes once we send the response
    const logEntry = await captureRequest(request, env, requestId);

    // Process logging asynchronously (don't block response)
    ctx.waitUntil(processLogEntry(logEntry, requestId, env));

    // Forward to upstream or return success
    if (env.UPSTREAM_URL) {
      const url = new URL(request.url);
      const upstreamUrl = env.UPSTREAM_URL + url.pathname + url.search;
      return fetch(new Request(upstreamUrl, request));
    }

    return new Response('OK', { status: 200 });
  },
};

async function processLogEntry(
  logEntry: LogEntry,
  requestId: string,
  env: Env
): Promise<void> {
  try {
    stats.captured++;

    const mode = env.SIEM_STREAMING_MODE || 'buffer';

    if (mode === 'stream') {
      if (env.SIEM_ENDPOINT) {
        // Mode 1: Stream to SIEM immediately
        // PROS: Minimal loss window (~ms), reliable delivery (if SIEM up)
        // CONS: Adds latency to request, requires SIEM to be available
        const success = await sendToSIEM(logEntry, env);
        if (!success) {
          stats.dropped++;
          console.error(`[DROPPED][${requestId}] SIEM send failed - log lost`);
        }
      } else {
        // DRY RUN: No SIEM endpoint configured - log what WOULD be sent
        // This is useful for testing/debugging without a real SIEM
        const payload = await prepareSIEMPayload(logEntry, env);
        console.log(`[SIEM STUB][${requestId}] Would send to SIEM:`);
        console.log(payload);
      }
    } else {
      // Mode 2: Buffer in memory, flush periodically
      // PROS: No external dependency, fast (no network call)
      // CONS: Lost on worker crash/restart, up to FLUSH_INTERVAL_MS delay
      await bufferInMemory(logEntry, requestId, env);
    }
  } catch (error) {
    console.error(`[${requestId}] Logging error:`, error);
    stats.dropped++;
  }
}

/**
 * Prepare payload for SIEM (for dry-run mode)
 */
async function prepareSIEMPayload(logEntry: LogEntry, env: Env): Promise<string> {
  let payload = JSON.stringify(logEntry);

  // Encrypt if enabled
  if (env.ENABLE_ENCRYPTION === 'true') {
    if (env.ENCRYPTION_MODE === 'inline' && env.ENCRYPTION_PUBLIC_KEY) {
      try {
        const encrypted = await hybridEncrypt(payload, env.ENCRYPTION_PUBLIC_KEY);
        payload = JSON.stringify(encrypted);
      } catch (error) {
        console.error('Encryption failed:', error);
        // Fall back to plaintext
      }
    }
  }

  return payload;
}

async function captureRequest(
  request: Request,
  env: Env,
  requestId: string
): Promise<LogEntry> {
  const maxBytes = parseInt(env.MAX_BODY_BYTES || '400', 10);

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let bodyPreview = '';
  let bodyLength = 0;

  try {
    const clonedRequest = request.clone();
    const bodyBuffer = await clonedRequest.arrayBuffer();
    bodyLength = bodyBuffer.byteLength;
    const previewBuffer = bodyBuffer.slice(0, maxBytes);

    try {
      const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
      bodyPreview = decoder.decode(previewBuffer);
    } catch {
      bodyPreview = `[BASE64]: ${btoa(String.fromCharCode(...new Uint8Array(previewBuffer)))}`;
    }

    if (bodyLength > maxBytes) {
      bodyPreview += `... [truncated, total: ${bodyLength} bytes]`;
    }
  } catch (error) {
    bodyPreview = `[Error reading body: ${error}]`;
  }

  return {
    timestamp: new Date().toISOString(),
    requestId,
    url: request.url,
    method: request.method,
    headers,
    bodyPreview,
    bodyLength,
  };
}

/**
 * Send log to SIEM endpoint immediately
 * Returns true on success, false on failure (log is dropped)
 */
async function sendToSIEM(logEntry: LogEntry, env: Env): Promise<boolean> {
  let payload = JSON.stringify(logEntry);

  // Encrypt if enabled
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
        ...(env.SIEM_API_KEY && { 'Authorization': `Bearer ${env.SIEM_API_KEY}` }),
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
    console.error(`[SIEM ERROR] Network error: ${error}`);
    return false;
  }
}

async function bufferInMemory(
  logEntry: LogEntry,
  requestId: string,
  env: Env
): Promise<void> {
  // Encrypt if enabled
  let finalEntry = logEntry;

  if (env.ENABLE_ENCRYPTION === 'true') {
    if (env.ENCRYPTION_MODE === 'inline' && env.ENCRYPTION_PUBLIC_KEY) {
      const encrypted = await hybridEncrypt(
        JSON.stringify(logEntry),
        env.ENCRYPTION_PUBLIC_KEY
      );
      // Store encrypted version
      finalEntry = {
        ...logEntry,
        bodyPreview: '[ENCRYPTED]',
        headers: { 'x-encrypted-payload': JSON.stringify(encrypted) },
      };
    }
  }

  pendingLogs.push({ entry: finalEntry, requestId });

  // Schedule flush to console (memory only, never disk)
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

  // Emit stats summary periodically
  console.log(
    `[STATS] captured=${stats.captured} sentToSiem=${stats.sentToSiem} ` +
    `flushedToConsole=${stats.flushedToConsole} dropped=${stats.dropped} ` +
    `failedSiem=${stats.failedSiem}`
  );
}

async function hybridEncrypt(
  plaintext: string,
  publicKeyPem: string
): Promise<{
  ciphertext: string;
  encryptedKey: string;
  iv: string;
  algorithm: string;
}> {
  const aesKey = (await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt']
  )) as CryptoKey;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const encryptedData = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    data
  );

  const exportedKey = (await crypto.subtle.exportKey('raw', aesKey)) as ArrayBuffer;
  const publicKey = await importPublicKey(publicKeyPem);
  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    exportedKey
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encryptedData))),
    encryptedKey: btoa(String.fromCharCode(...new Uint8Array(encryptedKey))),
    iv: btoa(String.fromCharCode(...iv)),
    algorithm: 'RSA-OAEP-AES256-GCM',
  };
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  const base64 = pem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '');

  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }

  return crypto.subtle.importKey(
    'spki',
    buffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
}

async function encryptViaService(plaintext: string, env: Env): Promise<string> {
  if (!env.ENCRYPTION_WORKER) {
    return plaintext;
  }

  try {
    const response = await env.ENCRYPTION_WORKER.fetch(
      new Request('http://internal/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plaintext }),
      })
    );

    if (!response.ok) {
      throw new Error(`Encryption worker returned ${response.status}`);
    }

    const { ciphertext } = await response.json<{ ciphertext: string }>();
    return ciphertext;
  } catch (error) {
    console.error('Service encryption failed:', error);
    return plaintext;
  }
}
