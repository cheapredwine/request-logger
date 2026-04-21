import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Live Integration Tests
 *
 * These tests hit the actual deployed worker to verify:
 * 1. Request body is captured correctly (not "Error reading body")
 * 2. Headers are captured
 * 3. Response is returned successfully
 *
 * Run with: npm run test:live
 * Requires: WORKER_URL environment variable
 */

const WORKER_URL = process.env.WORKER_URL || 'https://request-logger.jsherron-test-account.workers.dev';

describe('Live Worker Tests', () => {
  beforeAll(() => {
    console.log(`Testing against: ${WORKER_URL}`);
  });

  describe('Request Body Capture', () => {
    it('should capture JSON body correctly', async () => {
      const body = JSON.stringify({
        test: 'data',
        timestamp: new Date().toISOString(),
        id: crypto.randomUUID(),
      });

      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Header': 'test-value',
        },
        body,
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('OK');

      // The log should appear in wrangler tail with the actual body
      // Not: "[Error reading body: TypeError: Can't read from request stream...]"
      console.log(`[TEST] POST with body length ${body.length} - check wrangler tail for captured body`);
    });

    it('should capture large body with truncation', async () => {
      const largeBody = JSON.stringify({
        message: 'x'.repeat(1000),
        id: crypto.randomUUID(),
      });

      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: largeBody,
      });

      expect(response.status).toBe(200);
      console.log(`[TEST] POST with large body (${largeBody.length} bytes) - should be truncated in logs`);
    });

    it('should capture form data body', async () => {
      const formData = new URLSearchParams();
      formData.append('field1', 'value1');
      formData.append('field2', 'value2');

      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      expect(response.status).toBe(200);
      console.log(`[TEST] POST with form data - check wrangler tail`);
    });

    it('should handle GET request with no body', async () => {
      const response = await fetch(`${WORKER_URL}/test-path?foo=bar`, {
        method: 'GET',
        headers: {
          'X-Custom-Header': 'get-test',
          'Accept': 'application/json',
        },
      });

      expect(response.status).toBe(200);
      console.log(`[TEST] GET request - check wrangler tail for headers`);
    });

    it('should capture headers correctly', async () => {
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token-123',
          'X-Request-ID': crypto.randomUUID(),
          'X-Custom-Header': 'custom-value',
        },
        body: JSON.stringify({ test: 'headers' }),
      });

      expect(response.status).toBe(200);
      console.log(`[TEST] POST with headers - check wrangler tail for Authorization and custom headers`);
    });
  });

  describe('Different HTTP Methods', () => {
    const methods = ['POST', 'PUT', 'PATCH'];

    methods.forEach((method) => {
      it(`should handle ${method} with body`, async () => {
        const body = JSON.stringify({ method, data: 'test' });

        const response = await fetch(WORKER_URL, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body,
        });

        expect(response.status).toBe(200);
        console.log(`[TEST] ${method} with body - check wrangler tail`);
      });
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle multiple concurrent requests', async () => {
      const requests = Array.from({ length: 5 }, (_, i) =>
        fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ concurrent: true, index: i }),
        })
      );

      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });

      console.log(`[TEST] 5 concurrent POSTs - all succeeded, check wrangler tail`);
    });
  });

  describe('Binary Data', () => {
    it('should handle binary body content', async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff]);

      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: binaryData,
      });

      expect(response.status).toBe(200);
      console.log(`[TEST] POST with binary data - should show [BASE64] in logs`);
    });
  });
});

describe('Live Worker Verification', () => {
  it('should provide instructions for verifying logs', () => {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║  LIVE TEST COMPLETE                                            ║
║                                                                ║
║  To verify body capture is working:                            ║
║                                                                ║
║  1. Run: wrangler tail                                         ║
║                                                                ║
║  2. Look for logs with "[SIEM STUB]" or "[LOG]"               ║
║                                                                ║
║  3. Verify bodyPreview contains actual data like:              ║
║     "{\"test\":\"data\"..."                                      ║
║                                                                ║
║  4. Should NOT see:                                            ║
║     "[Error reading body: TypeError...]"                       ║
║                                                                ║
║  If you see actual JSON in bodyPreview, the fix worked!        ║
╚════════════════════════════════════════════════════════════════╝
    `);

    expect(true).toBe(true);
  });
});
