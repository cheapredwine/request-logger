/**
 * API Gateway Worker
 *
 * Transparently intercepts requests to gateway.jsherron.com/api/*
 * Logs them, then forwards to a configurable backend.
 *
 * Architecture:
 * Client → gateway.jsherron.com/api/* → This Worker → [LOGGED] → BACKEND (configurable)
 */

export interface Env {
  // Service binding to backend
  // Change wrangler.toml [[services]] to point to different backends
  BACKEND: Fetcher;

  // Configuration
  MAX_BODY_BYTES: string;
  SIEM_STREAMING_MODE: string;
  SIEM_ENDPOINT?: string;
  SIEM_API_KEY?: string;
  LOG_PATH_PREFIX: string;
  SKIP_PATHS: string;

  // Encryption
  ENABLE_ENCRYPTION: string;
  ENCRYPTION_MODE: string;
  ENCRYPTION_PUBLIC_KEY?: string;
}

export interface LogEntry {
  timestamp: string;
  requestId: string;
  originalUrl: string;
  forwardedTo: string;
  method: string;
  headers: Record<string, string>;
  bodyPreview: string;
  bodyLength: number;
  logged: boolean;
  skipReason?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);

    // Check if this path should be logged
    const shouldLog = shouldLogPath(url.pathname, env);

    // Capture request data BEFORE any async operations
    // (Service binding fetch is async, so we must capture first)
    const logEntry = await captureRequest(request, env, requestId, shouldLog);

    // Log asynchronously if needed
    if (shouldLog.log) {
      ctx.waitUntil(processLogEntry(logEntry, requestId, env));
    }

    // Forward to configured backend
    const backendResponse = await forwardToBackend(request, env, requestId);
    return backendResponse;
  },
};

interface LogDecision {
  log: boolean;
  reason?: string;
}

/**
 * Forward request to configured backend via service binding
 * Change the service name in wrangler.toml to switch backends
 */
async function forwardToBackend(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  const backendPath = mapToBackendEndpoint(request.method);
  const backendUrl = `http://internal${backendPath}`;

  const backendRequest = new Request(backendUrl, request);
  backendRequest.headers.delete('host');

  try {
    const response = await env.BACKEND.fetch(backendRequest);
    return response;
  } catch (error) {
    console.error(`[${requestId}] Error forwarding to backend:`, error);
    return new Response(
      JSON.stringify({ error: 'Gateway error', requestId }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Map HTTP methods to backend endpoints
 * This is useful for services like httpbin/flarebin that have method-specific endpoints
 */
function mapToBackendEndpoint(method: string): string {
  // Map HTTP methods to common endpoints
  // Override this logic or make it configurable as needed
  const methodEndpoints: Record<string, string> = {
    'GET': '/get',
    'POST': '/post',
    'PUT': '/put',
    'PATCH': '/patch',
    'DELETE': '/delete',
  };

  return methodEndpoints[method] || `/${method.toLowerCase()}`;
}

function shouldLogPath(pathname: string, env: Env): LogDecision {
  const prefix = env.LOG_PATH_PREFIX || '/api/';

  // Must match the prefix
  if (!pathname.startsWith(prefix)) {
    return { log: false, reason: 'path_prefix_mismatch' };
  }

  // Check skip paths
  const skipPaths = env.SKIP_PATHS ? env.SKIP_PATHS.split(',') : [];
  for (const skipPath of skipPaths) {
    if (pathname === skipPath || pathname.startsWith(skipPath + '/')) {
      return { log: false, reason: `path_excluded:${skipPath}` };
    }
  }

  return { log: true };
}

async function captureRequest(
  request: Request,
  env: Env,
  requestId: string,
  shouldLog: LogDecision
): Promise<LogEntry> {
  const url = new URL(request.url);
  const maxBytes = parseInt(env.MAX_BODY_BYTES || '400', 10);

  // Capture headers
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Capture body preview (only if logging)
  let bodyPreview = '';
  let bodyLength = 0;

  if (shouldLog.log) {
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
  }

  // Determine where we're forwarding to
  const backendPath = mapToBackendEndpoint(request.method);

  return {
    timestamp: new Date().toISOString(),
    requestId,
    originalUrl: request.url,
    forwardedTo: `backend:${backendPath}`,
    method: request.method,
    headers,
    bodyPreview,
    bodyLength,
    logged: shouldLog.log,
    skipReason: shouldLog.reason,
  };
}

async function processLogEntry(
  logEntry: LogEntry,
  requestId: string,
  env: Env
): Promise<void> {
  try {
    const mode = env.SIEM_STREAMING_MODE || 'buffer';

    if (mode === 'stream') {
      if (env.SIEM_ENDPOINT) {
        const success = await sendToSIEM(logEntry, env);
        if (!success) {
          console.error(`[DROPPED][${requestId}] SIEM send failed`);
        }
      } else {
        // Dry-run mode
        const payload = await prepareSIEMPayload(logEntry, env);
        console.log(`[GATEWAY LOG][${requestId}] ${payload}`);
      }
    } else {
      // Buffer mode - just log to console
      console.log(`[GATEWAY LOG][${requestId}] ${JSON.stringify(logEntry)}`);
    }
  } catch (error) {
    console.error(`[${requestId}] Logging error:`, error);
  }
}

async function sendToSIEM(logEntry: LogEntry, env: Env): Promise<boolean> {
  let payload = JSON.stringify(logEntry);

  // Encrypt if enabled
  if (env.ENABLE_ENCRYPTION === 'true' && env.ENCRYPTION_PUBLIC_KEY) {
    // Encryption implementation would go here
    // For now, just log that encryption is requested
    console.log(`[ENCRYPTION] Encryption requested but not implemented in gateway`);
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

    return response.ok;
  } catch (error) {
    console.error(`[SIEM ERROR] ${error}`);
    return false;
  }
}

async function prepareSIEMPayload(logEntry: LogEntry, env: Env): Promise<string> {
  let payload = JSON.stringify(logEntry);

  // Add encryption here if needed
  if (env.ENABLE_ENCRYPTION === 'true') {
    // Encryption logic
  }

  return payload;
}
