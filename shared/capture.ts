/**
 * Request capture module with Cloudflare metadata
 */

import type { LogEntry } from './types';

function extractHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

function extractCfData(request: Request): Record<string, unknown> | undefined {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
  if (!cf) return undefined;
  return {
    colo: cf.colo,
    country: cf.country,
    httpProtocol: cf.httpProtocol,
    tlsCipher: cf.tlsCipher,
    tlsVersion: cf.tlsVersion,
    asn: cf.asn,
    asOrganization: cf.asOrganization,
    city: cf.city,
    continent: cf.continent,
    latitude: cf.latitude,
    longitude: cf.longitude,
    postalCode: cf.postalCode,
    region: cf.region,
    timezone: cf.timezone,
  };
}

export async function captureRequest(
  request: Request,
  maxBytes: number,
  requestId: string,
): Promise<LogEntry> {
  const headers = extractHeaders(request);

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
    id: requestId,
    timestamp: new Date().toISOString(),
    requestId,
    url: request.url,
    method: request.method,
    headers,
    bodyPreview,
    bodyLength,
    cf: extractCfData(request),
  };
}
